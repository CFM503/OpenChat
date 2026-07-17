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
 */
function extractOpenAiDeltaPieces(delta: Record<string, any>): StreamChunk[] {
  const out: StreamChunk[] = [];
  if (!delta || typeof delta !== 'object') return out;

  // ── Reasoning / CoT (many CN + global gateways) ───────────────────
  const thinkCandidates = [
    delta.reasoning_content,
    delta.reasoning,
    delta.reasoning_text,
    delta.thinking,
    delta.thought,
  ];
  for (const t of thinkCandidates) {
    if (typeof t === 'string' && t.length > 0) {
      out.push({ type: 'thinking', content: t });
    } else if (t && typeof t === 'object') {
      // OpenRouter-style: { content: "..." } or array of details
      if (typeof (t as any).content === 'string' && (t as any).content) {
        out.push({ type: 'thinking', content: (t as any).content });
      } else if (Array.isArray(t)) {
        for (const part of t) {
          const text =
            typeof part === 'string'
              ? part
              : part?.text || part?.content || part?.thinking || '';
          if (text) out.push({ type: 'thinking', content: String(text) });
        }
      }
    }
  }
  if (Array.isArray(delta.reasoning_details)) {
    for (const part of delta.reasoning_details) {
      const text = part?.text || part?.content || part?.summary || '';
      if (text) out.push({ type: 'thinking', content: String(text) });
    }
  }

  // ── Visible answer content ────────────────────────────────────────
  const c = delta.content;
  if (typeof c === 'string' && c.length > 0) {
    out.push({ type: 'content', content: c });
  } else if (Array.isArray(c)) {
    // Multimodal / typed blocks (OpenAI, some Claude-compat proxies)
    for (const block of c) {
      if (!block) continue;
      if (typeof block === 'string' && block) {
        out.push({ type: 'content', content: block });
        continue;
      }
      const bType = block.type || '';
      if (
        bType === 'thinking' ||
        bType === 'reasoning' ||
        bType === 'reasoning_content' ||
        bType === 'thought'
      ) {
        const t = block.thinking || block.text || block.content || '';
        if (t) out.push({ type: 'thinking', content: String(t) });
      } else if (bType === 'text' || bType === 'output_text' || block.text) {
        const t = block.text || block.content || '';
        if (t) out.push({ type: 'content', content: String(t) });
      } else if (typeof block.content === 'string' && block.content) {
        out.push({ type: 'content', content: block.content });
      }
    }
  }

  // ── Tool calls ────────────────────────────────────────────────────
  if (delta.tool_calls?.length) {
    out.push({ type: 'tool_call', content: '', toolCalls: delta.tool_calls });
  }

  return out;
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
            // Prefer delta (streaming); some gateways only fill message on last chunk
            const choice = parsed.choices?.[0];
            const delta = choice?.delta ?? choice?.message;
            if (!delta) continue;

            for (const piece of extractOpenAiDeltaPieces(delta)) {
              yield piece;
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
