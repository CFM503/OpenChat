// ============================================================================
// ProviderGateway — Unified multi-provider LLM routing
// Supports OpenAI-compatible, Ollama, and custom endpoints
// ============================================================================

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
  messages: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: any[] }>;
  tools?: Array<{ type: 'function'; function: any }>;
  signal?: AbortSignal;
}

export class ProviderGateway {
  private config: ConfigManager;

  constructor(config: ConfigManager) {
    this.config = config;
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
    return !!(model.apiKey && model.apiKey.trim().length > 0);
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
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`Provider error (${resp.status}): ${errBody}`);
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
            // Skip malformed JSON
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
    const body: Record<string, any> = {
      model: model.model,
      messages: params.messages,
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
    });

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
            // Skip malformed
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
 */
function normalizeEndpoint(url: string): string {
  let normalized = url.trim().replace(/\/+$/, '');
  if (normalized.endsWith('/chat/completions')) return normalized;
  if (normalized.endsWith('/v1')) return normalized + '/chat/completions';
  return normalized + '/v1/chat/completions';
}
