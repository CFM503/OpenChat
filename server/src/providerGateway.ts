// ============================================================================
// ProviderGateway — Unified multi-provider LLM routing
// Supports OpenAI-compatible, Ollama, and custom endpoints
// ============================================================================

import { ProxyAgent } from 'undici';
import type { ConfigManager, ModelConfig } from './configManager.js';

export interface StreamChunk {
  type: 'content' | 'thinking' | 'tool_call';
  content: string;
  toolCalls?: ToolCallDelta[];
  finishReason?: string;
}

export interface ToolCallDelta {
  index: number;
  id?: string;
  name?: string;
  arguments?: string;
}

export interface CompletionParams {
  modelId?: string;
  messages: Record<string, any>[];
  tools?: Array<{ type: 'function'; function: any }>;
  signal?: AbortSignal;
}

export class ProviderGateway {
  private config: ConfigManager;
  private cachedProxyUrl: string | undefined;
  private proxyAgent: ProxyAgent | undefined;

  constructor(config: ConfigManager) {
    this.config = config;
  }

  /**
   * Get a ProxyAgent if proxyUrl is configured. Recreates the agent when the URL changes.
   */
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

  /**
   * Get the active model config.
   */
  getActiveModel(modelId?: string): ModelConfig | undefined {
    const cfg = this.config.load();
    if (modelId) {
      return cfg.models?.find(m => m.id === modelId);
    }
    if (cfg.activeModelId) {
      return cfg.models?.find(m => m.id === cfg.activeModelId);
    }
    return cfg.models?.find(m => m.isDefault) ?? cfg.models?.[0];
  }

  /**
   * Check if the model has valid credentials for real API calls.
   */
  canMakeRequest(modelId?: string): boolean {
    const model = this.getActiveModel(modelId);
    if (!model) return false;
    if (model.provider === 'ollama') return true;
    // Allow requests without API key (LM Studio, local proxies, etc.)
    return !!(model.endpoint && model.endpoint.trim().length > 0);
  }

  /**
   * Stream a completion from the active provider.
   * Yields StreamChunk events as they arrive.
   */
  async *streamCompletion(params: CompletionParams): AsyncGenerator<StreamChunk> {
    const model = this.getActiveModel(params.modelId);
    if (!model) throw new Error('No active model configured');

    if (model.provider === 'ollama') {
      yield* this.streamOllama(model, params);
    } else {
      yield* this.streamOpenAICompatible(model, params);
    }
  }

  private async *streamOpenAICompatible(
    model: ModelConfig,
    params: CompletionParams,
  ): AsyncGenerator<StreamChunk> {
    const url = normalizeEndpoint(model.endpoint);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (model.apiKey) {
      headers['Authorization'] = `Bearer ${model.apiKey}`;
    }

    const body: Record<string, any> = {
      model: model.model,
      messages: params.messages,
      max_tokens: model.maxTokens,
      temperature: model.temperature,
      stream: true,
    };

    if (params.tools?.length) {
      body.tools = params.tools;
      body.tool_choice = 'auto';
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: params.signal,
      ...(this.getProxyDispatcher() ? { dispatcher: this.proxyAgent! } : {}),
    } as any);

    if (!resp.ok) {
      const errBody = await resp.text();
      const sanitized = errBody.replace(/sk-[a-zA-Z0-9_-]{20,}/g, 'sk-***');
      // Provide helpful hints for common errors
      let hint = '';
      if (resp.status === 500) {
        hint = ' — model may have run out of context. Try reducing Max Tokens in model settings.';
      } else if (resp.status === 404) {
        hint = ' — check model name and endpoint URL.';
      } else if (resp.status === 401 || resp.status === 403) {
        hint = ' — check API key.';
      }
      throw new Error(`Provider error (${resp.status})${hint}: ${sanitized.substring(0, 500)}`);
    }

    if (!resp.body) {
      const text = await resp.text();
      yield { type: 'content', content: text };
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
            if (delta.reasoning_content) {
              yield { type: 'thinking', content: delta.reasoning_content };
            }
            if (delta.tool_calls) {
              yield { type: 'tool_call', content: '', toolCalls: delta.tool_calls };
            }

            const finishReason = parsed.choices?.[0]?.finish_reason;
            if (finishReason) {
              yield { type: 'content', content: '', finishReason };
            }
          } catch {
            // M-2: Log malformed JSON instead of silently swallowing
            console.warn('[provider] Skipping malformed SSE JSON:', trimmed.slice(0, 100));
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async *streamOllama(
    model: ModelConfig,
    params: CompletionParams,
  ): AsyncGenerator<StreamChunk> {
    // Convert multimodal content blocks to Ollama format (images as raw base64 array)
    const messages = params.messages.map(m => {
      if (Array.isArray(m.content)) {
        const textParts: string[] = [];
        const images: string[] = [];
        for (const block of m.content) {
          if (block.type === 'text' && block.text) {
            textParts.push(block.text);
          } else if (block.type === 'image_url' && block.image_url?.url) {
            const url = block.image_url.url;
            const idx = url.indexOf(';base64,');
            images.push(idx >= 0 ? url.slice(idx + 8) : url);
          }
        }
        return { role: m.role, content: textParts.join('\n'), images };
      }
      return m;
    });

    const body: Record<string, any> = {
      model: model.model,
      messages,
      stream: true,
      options: {
        num_predict: model.maxTokens,
        temperature: model.temperature,
      },
    };

    const resp = await fetch(model.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: params.signal,
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
            // M-2: Log malformed JSON instead of silently swallowing
            console.warn('[ollama] Skipping malformed JSON:', trimmed.slice(0, 100));
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

/**
 * Normalize endpoint URL to include /chat/completions path.
 * M-15: Handle endpoints that already contain API path segments.
 */
function normalizeEndpoint(url: string): string {
  let normalized = url.trim().replace(/\/+$/, '');
  // Already a complete chat completions URL
  if (normalized.endsWith('/chat/completions')) return normalized;
  // Already has /v1 suffix
  if (normalized.endsWith('/v1')) return normalized + '/chat/completions';
  try {
    const parsed = new URL(normalized);
    const p = parsed.pathname.replace(/\/+$/, '');
    // API version prefix → append /chat/completions (e.g., /v1beta, /v1alpha, /v1/proxy)
    if (/^\/v\d+/.test(p)) {
      return normalized + '/chat/completions';
    }
    // Complete endpoint path (Ollama /api/generate, /api/chat, etc.) → don't modify
    if (p !== '' && p !== '/') {
      return normalized;
    }
  } catch {
    // Not a valid URL, proceed with normalization
  }
  // Bare domain → append /v1/chat/completions
  return normalized + '/v1/chat/completions';
}
