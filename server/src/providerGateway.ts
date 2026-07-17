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
    });

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
            const delta = parsed.choices?.[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
              yield { type: 'content', content: delta.content };
            }
            // OpenAI-style reasoning / DeepSeek reasoner
            if (delta.reasoning_content) {
              yield { type: 'thinking', content: delta.reasoning_content };
            }
            if (delta.reasoning) {
              yield { type: 'thinking', content: typeof delta.reasoning === 'string' ? delta.reasoning : JSON.stringify(delta.reasoning) };
            }
            if (delta.tool_calls) {
              yield { type: 'tool_call', content: '', toolCalls: delta.tool_calls };
            }

            const finishReason = parsed.choices?.[0]?.finish_reason;
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
