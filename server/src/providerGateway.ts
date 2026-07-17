// ============================================================================
// ProviderGateway — Multi-provider LLM routing with dialect adapters
// ============================================================================

import { ProxyAgent } from 'undici';
import type { ConfigManager } from './configManager.js';
import type { ModelConfig } from './providers/modelTypes.js';
import { buildCompletionRequest } from './providers/requestAdapter.js';
import { resolveModelCaps } from './providers/resolveCaps.js';

interface StreamChunk {
  type: 'content' | 'thinking' | 'tool_call';
  content: string;
  toolCalls?: ToolCallDelta[];
  finishReason?: string;
}

/**
 * Normalize OpenAI-compatible stream deltas from many vendors.
 * Handles string content, multimodal arrays, and various reasoning fields.
 *
 * IMPORTANT: Gateways often mirror the same token into multiple aliases
 * (`reasoning_content` + `reasoning` + `thinking`). Taking all of them
 * produces "OkayOkay,, the the user user" doubled text. Use only the first
 * non-empty thinking source and the first content source per delta.
 */
export function extractOpenAiDeltaPieces(delta: Record<string, any>): StreamChunk[] {
  const out: StreamChunk[] = [];
  if (!delta || typeof delta !== 'object') return out;

  const thinkingText = firstThinkingText(delta);
  const contentText = firstContentText(delta);

  // Same payload mirrored into both fields → emit once as content (user-visible)
  // if it looks like normal answer; else once as thinking.
  if (thinkingText && contentText && thinkingText === contentText) {
    out.push({ type: 'content', content: contentText });
  } else {
    if (thinkingText) out.push({ type: 'thinking', content: thinkingText });
    if (contentText) out.push({ type: 'content', content: contentText });
  }

  const normalizedTools = normalizeOpenAiToolCalls(delta.tool_calls);
  if (normalizedTools.length) {
    out.push({ type: 'tool_call', content: '', toolCalls: normalizedTools });
  }

  return out;
}

/**
 * OpenAI streams tool calls as:
 *   { index, id, function: { name, arguments } }
 * Some gateways flatten to { name, arguments }. Normalize to a single shape
 * the agent loop can accumulate (name/arguments at top level).
 */
export function normalizeOpenAiToolCalls(raw: unknown): ToolCallDelta[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const out: ToolCallDelta[] = [];
  for (let i = 0; i < raw.length; i++) {
    const tc = raw[i];
    if (!tc || typeof tc !== 'object') continue;
    const fn = (tc as any).function;
    const name =
      (typeof (tc as any).name === 'string' && (tc as any).name) ||
      (typeof fn?.name === 'string' && fn.name) ||
      '';
    const argsRaw =
      (tc as any).arguments ??
      fn?.arguments ??
      (tc as any).args ??
      '';
    const args =
      typeof argsRaw === 'string'
        ? argsRaw
        : argsRaw != null
          ? JSON.stringify(argsRaw)
          : '';
    out.push({
      index: typeof (tc as any).index === 'number' ? (tc as any).index : i,
      id: typeof (tc as any).id === 'string' ? (tc as any).id : undefined,
      name: name || undefined,
      arguments: args || undefined,
    });
  }
  return out;
}

function firstThinkingText(delta: Record<string, any>): string {
  const tryOne = (t: unknown): string => {
    if (typeof t === 'string' && t.length > 0) return t;
    if (t && typeof t === 'object' && !Array.isArray(t)) {
      const c = (t as any).content ?? (t as any).text ?? (t as any).thinking;
      if (typeof c === 'string' && c) return c;
    }
    if (Array.isArray(t)) {
      const parts: string[] = [];
      for (const part of t) {
        if (typeof part === 'string' && part) parts.push(part);
        else if (part?.text) parts.push(String(part.text));
        else if (part?.content) parts.push(String(part.content));
        else if (part?.thinking) parts.push(String(part.thinking));
        else if (part?.summary) parts.push(String(part.summary));
      }
      return parts.join('');
    }
    return '';
  };

  // Priority order — stop at first non-empty (do not concatenate aliases)
  const candidates = [
    delta.reasoning_content,
    delta.reasoning,
    delta.reasoning_text,
    delta.thinking,
    delta.thought,
    delta.reasoning_details,
  ];
  for (const c of candidates) {
    const text = tryOne(c);
    if (text) return text;
  }

  // content array may contain typed thinking blocks only
  if (Array.isArray(delta.content)) {
    const parts: string[] = [];
    for (const block of delta.content) {
      const bType = block?.type || '';
      if (
        bType === 'thinking' ||
        bType === 'reasoning' ||
        bType === 'reasoning_content' ||
        bType === 'thought'
      ) {
        const t = block.thinking || block.text || block.content || '';
        if (t) parts.push(String(t));
      }
    }
    if (parts.length) return parts.join('');
  }
  return '';
}

function firstContentText(delta: Record<string, any>): string {
  const c = delta.content;
  if (typeof c === 'string' && c.length > 0) return c;
  if (Array.isArray(c)) {
    const parts: string[] = [];
    for (const block of c) {
      if (!block) continue;
      if (typeof block === 'string' && block) {
        parts.push(block);
        continue;
      }
      const bType = block.type || '';
      if (
        bType === 'thinking' ||
        bType === 'reasoning' ||
        bType === 'reasoning_content' ||
        bType === 'thought'
      ) {
        continue; // handled as thinking
      }
      if (bType === 'text' || bType === 'output_text' || block.text) {
        const t = block.text || block.content || '';
        if (t) parts.push(String(t));
      } else if (typeof block.content === 'string' && block.content) {
        parts.push(block.content);
      }
    }
    return parts.join('');
  }
  return '';
}

interface ToolCallDelta {
  index: number;
  id?: string;
  name?: string;
  arguments?: string;
}

interface CompletionParams {
  modelId?: string;
  messages: Record<string, any>[];
  tools?: Array<{ type: 'function'; function: any }>;
  signal?: AbortSignal;
  /** false = disable deep thinking / CoT when provider supports it */
  enableThinking?: boolean;
}

export class ProviderGateway {
  /** Exposed for agentLoop agentRouting lookups */
  readonly config: ConfigManager;
  private cachedProxyUrl: string | undefined;
  private proxyAgent: ProxyAgent | undefined;

  constructor(config: ConfigManager) {
    this.config = config;
  }

  private getProxyDispatcher(): ProxyAgent | undefined {
    const cfg = this.config.load();
    if (!cfg.proxyEnabled) {
      this.proxyAgent = undefined;
      this.cachedProxyUrl = undefined;
      return undefined;
    }
    const url = cfg.proxyUrl?.trim();
    if (!url) {
      this.proxyAgent = undefined;
      this.cachedProxyUrl = undefined;
      return undefined;
    }
    if (url !== this.cachedProxyUrl) {
      this.proxyAgent = new ProxyAgent(url);
      this.cachedProxyUrl = url;
      console.log(`[proxy] Using proxy: ${url}`);
    }
    return this.proxyAgent;
  }

  getActiveModel(modelId?: string): ModelConfig | undefined {
    const cfg = this.config.load();
    let model: ModelConfig | undefined;
    if (modelId) {
      model = cfg.models?.find(m => m.id === modelId);
    } else if (cfg.activeModelId) {
      model = cfg.models?.find(m => m.id === cfg.activeModelId);
    } else {
      model = cfg.models?.find(m => m.isDefault) ?? cfg.models?.[0];
    }
    // Apply global default context strategy if model omits it
    if (model && !model.contextStrategy && cfg.defaultContextStrategy) {
      return { ...model, contextStrategy: cfg.defaultContextStrategy };
    }
    return model;
  }

  canMakeRequest(modelId?: string): boolean {
    const model = this.getActiveModel(modelId);
    if (!model) return false;
    if (model.provider === 'ollama') return true;
    return !!(model.endpoint && model.endpoint.trim().length > 0);
  }

  async *streamCompletion(params: CompletionParams): AsyncGenerator<StreamChunk> {
    const model = this.getActiveModel(params.modelId);
    if (!model) throw new Error('No active model configured');

    const caps = resolveModelCaps(model);
    // Filter tools if model doesn't support them
    const tools =
      caps.supportsTools && params.tools?.length ? params.tools : undefined;

    const built = buildCompletionRequest(model, {
      messages: params.messages,
      tools,
      stream: true,
      enableThinking: params.enableThinking,
    });

    // Always forward thinking chunks to agentLoop (for empty-content fallback).
    // UI hide / promote is decided there — never drop reasoning stream here or
    // "thinking off" becomes total silence when the model only emits CoT.
    if (built.apiStyle === 'ollama') {
      yield* this.streamNdjson(built, params.signal, 'ollama');
      return;
    }
    if (built.apiStyle === 'anthropic') {
      yield* this.streamAnthropropic(built, params.signal);
      return;
    }
    yield* this.streamOpenAISse(built, params.signal);
  }

  private async *streamOpenAISse(
    built: { url: string; headers: Record<string, string>; body: Record<string, unknown> },
    signal?: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    const resp = await fetch(built.url, {
      method: 'POST',
      headers: built.headers,
      body: JSON.stringify(built.body),
      signal,
      ...(this.getProxyDispatcher() ? { dispatcher: this.proxyAgent! } : {}),
    } as any);

    if (!resp.ok) {
      const errBody = await resp.text();
      const sanitized = errBody.replace(/sk-[a-zA-Z0-9_-]{20,}/g, 'sk-***');
      let hint = '';
      if (resp.status === 500) {
        hint = ' — try reducing Max Tokens or switch context strategy to minimal.';
      } else if (resp.status === 404) {
        hint = ' — check model name and endpoint URL.';
      } else if (resp.status === 401 || resp.status === 403) {
        hint = ' — check API key / auth style.';
      } else if (resp.status === 400 && sanitized.includes('max_tokens')) {
        hint = ' — this model may need max_completion_tokens (set Token Param in model settings).';
      } else if (resp.status === 400 && sanitized.toLowerCase().includes('temperature')) {
        hint = ' — disable temperature for this reasoning model.';
      }
      throw new Error(`Provider error (${resp.status})${hint}: ${sanitized.substring(0, 500)}`);
    }

    if (!resp.body) {
      yield { type: 'content', content: await resp.text() };
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const parsed = JSON.parse(trimmed.slice(6));
            const choice = parsed.choices?.[0];
            if (!choice) continue;

            // Streaming tokens live on delta; some gateways put final tool_calls on message
            if (choice.delta) {
              for (const piece of extractOpenAiDeltaPieces(choice.delta)) {
                yield piece;
              }
            }
            if (choice.message) {
              for (const piece of extractOpenAiDeltaPieces(choice.message)) {
                // Avoid duplicating full assistant text when both delta and message exist
                if (choice.delta && piece.type !== 'tool_call') continue;
                yield piece;
              }
            }

            const finishReason = choice?.finish_reason;
            if (finishReason) {
              yield { type: 'content', content: '', finishReason };
            }
          } catch {
            console.warn('[provider] Skipping malformed SSE JSON:', trimmed.slice(0, 100));
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async *streamNdjson(
    built: { url: string; headers: Record<string, string>; body: Record<string, unknown> },
    signal?: AbortSignal,
    _kind?: string,
  ): AsyncGenerator<StreamChunk> {
    const resp = await fetch(built.url, {
      method: 'POST',
      headers: built.headers,
      body: JSON.stringify(built.body),
      signal,
      ...(this.getProxyDispatcher() ? { dispatcher: this.proxyAgent! } : {}),
    } as any);

    if (!resp.ok) {
      throw new Error(`Ollama error (${resp.status}): ${await resp.text()}`);
    }

    if (!resp.body) {
      yield { type: 'content', content: await resp.text() };
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.message?.content) {
              yield { type: 'content', content: parsed.message.content };
            }
            if (parsed.done === true) {
              yield { type: 'content', content: '', finishReason: 'stop' };
            }
          } catch {
            console.warn('[ollama] Skipping malformed JSON:', trimmed.slice(0, 100));
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /** Anthropic SSE: event: content_block_delta / message_delta */
  private async *streamAnthropropic(
    built: { url: string; headers: Record<string, string>; body: Record<string, unknown> },
    signal?: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    const resp = await fetch(built.url, {
      method: 'POST',
      headers: built.headers,
      body: JSON.stringify(built.body),
      signal,
      ...(this.getProxyDispatcher() ? { dispatcher: this.proxyAgent! } : {}),
    } as any);

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`Anthropic error (${resp.status}): ${errBody.substring(0, 500)}`);
    }

    if (!resp.body) {
      yield { type: 'content', content: await resp.text() };
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    // Track tool_use blocks by index
    const toolBlocks = new Map<number, { id: string; name: string; arguments: string }>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;
          try {
            const ev = JSON.parse(data);
            if (ev.type === 'content_block_delta') {
              if (ev.delta?.type === 'text_delta' && ev.delta.text) {
                yield { type: 'content', content: ev.delta.text };
              }
              if (ev.delta?.type === 'thinking_delta' && ev.delta.thinking) {
                yield { type: 'thinking', content: ev.delta.thinking };
              }
              if (ev.delta?.type === 'input_json_delta' && ev.delta.partial_json != null) {
                const idx = ev.index ?? 0;
                const block = toolBlocks.get(idx);
                if (block) {
                  block.arguments += ev.delta.partial_json;
                  yield {
                    type: 'tool_call',
                    content: '',
                    toolCalls: [{
                      index: idx,
                      id: block.id,
                      name: block.name,
                      arguments: ev.delta.partial_json,
                    }],
                  };
                }
              }
            }
            if (ev.type === 'content_block_start') {
              if (ev.content_block?.type === 'tool_use') {
                const idx = ev.index ?? 0;
                toolBlocks.set(idx, {
                  id: ev.content_block.id,
                  name: ev.content_block.name,
                  arguments: '',
                });
                yield {
                  type: 'tool_call',
                  content: '',
                  toolCalls: [{
                    index: idx,
                    id: ev.content_block.id,
                    name: ev.content_block.name,
                    arguments: '',
                  }],
                };
              }
            }
            if (ev.type === 'message_delta' && ev.delta?.stop_reason) {
              yield { type: 'content', content: '', finishReason: ev.delta.stop_reason };
            }
          } catch {
            // skip
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
