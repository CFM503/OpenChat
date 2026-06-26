// ============================================================================
// Model Router Gateway
// Supports OpenAI-compatible, Ollama, and custom model endpoints
// ============================================================================

import type { ModelConfig, ModelProvider, ChatMessage } from './types';

/**
 * Normalizes an endpoint URL for OpenAI-compatible providers.
 *
 * Rules:
 *  - Strips trailing slashes
 *  - If URL already ends with /chat/completions → keep as-is
 *  - If URL ends with /v1 or /v1/ → append /chat/completions
 *  - Otherwise → append /v1/chat/completions
 *
 * Only applies to 'openai' and 'custom' providers. Ollama has its own path.
 *
 * Examples:
 *   https://api.example.com/v1           → https://api.example.com/v1/chat/completions
 *   https://api.example.com/v1/          → https://api.example.com/v1/chat/completions
 *   https://api.example.com              → https://api.example.com/v1/chat/completions
 *   https://api.example.com/             → https://api.example.com/v1/chat/completions
 *   https://api.example.com/v1/chat/completions  → (unchanged)
 *   https://api.example.com/v1/chat/completions/ → (trailing slash removed)
 */
export function normalizeEndpoint(url: string): string {
  // Trim whitespace and trailing slashes
  let normalized = url.trim().replace(/\/+$/, '');

  // Already ends with /chat/completions — done
  if (normalized.endsWith('/chat/completions')) {
    return normalized;
  }

  // Ends with /v1 — just append /chat/completions
  if (normalized.endsWith('/v1')) {
    return normalized + '/chat/completions';
  }

  // Check if URL has a path with API version prefix (e.g., /v1beta, /v1alpha, /v1beta/openai)
  try {
    const parsed = new URL(normalized);
    const p = parsed.pathname.replace(/\/+$/, '');
    if (/^\/v\d+/.test(p)) {
      return normalized + '/chat/completions';
    }
    // Other non-root paths (e.g., Ollama /api/generate) — don't modify
    if (p !== '' && p !== '/') {
      return normalized;
    }
  } catch {
    // Not a valid URL, proceed with normalization
  }

  // Bare domain → append full /v1/chat/completions
  return normalized + '/v1/chat/completions';
}

/**
 * Default model configurations
 */
export const DEFAULT_MODELS: ModelConfig[] = [
  {
    id: 'gpt-4o',
    name: 'GPT-4o (OpenAI)',
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    apiKey: '',
    model: 'gpt-4o',
    maxTokens: 4096,
    temperature: 0.7,
    isDefault: true,
  },
  {
    id: 'ollama-llama3',
    name: 'Llama 3 (Ollama Local)',
    provider: 'ollama',
    endpoint: 'http://localhost:11434/api/chat',
    model: 'llama3',
    maxTokens: 4096,
    temperature: 0.7,
    isDefault: false,
  },
];

/**
 * Registry of all configured models
 */
export class ModelRouter {
  private models: Map<string, ModelConfig> = new Map();

  constructor(initialModels?: ModelConfig[]) {
    const models = initialModels ?? DEFAULT_MODELS;
    for (const model of models) {
      this.models.set(model.id, model);
    }
  }

  /**
   * Add or update a model configuration.
   */
  addModel(config: ModelConfig): void {
    if (config.isDefault) {
      // Clear other defaults for this provider
      for (const [, m] of this.models) {
        if (m.provider === config.provider) {
          m.isDefault = false;
        }
      }
    }
    this.models.set(config.id, config);
  }

  /**
   * Remove a model by ID.
   */
  removeModel(id: string): boolean {
    return this.models.delete(id);
  }

  /**
   * Get a model config by ID.
   */
  getModel(id: string): ModelConfig | undefined {
    return this.models.get(id);
  }

  /**
   * Get all registered models.
   */
  getAllModels(): ModelConfig[] {
    return Array.from(this.models.values());
  }

  /**
   * Get the default model for a given provider, or overall default.
   */
  getDefaultModel(provider?: ModelProvider): ModelConfig | undefined {
    if (provider) {
      return this.getAllModels().find(m => m.provider === provider && m.isDefault);
    }
    return this.getAllModels().find(m => m.isDefault);
  }

  /**
   * Route a request — builds the appropriate fetch config for a given model.
   */
  buildRequest(
    modelId: string,
    messages: ChatMessage[],
    stream: boolean = true
  ): { url: string; init: RequestInit } | null {
    const config = this.models.get(modelId);
    if (!config) return null;

    switch (config.provider) {
      case 'openai':
        return this.buildOpenAIRequest(config, messages, stream);
      case 'ollama':
        return this.buildOllamaRequest(config, messages, stream);
      case 'custom':
        return this.buildCustomRequest(config, messages, stream);
      default:
        return null;
    }
  }

  private mapMessagesForOpenAI(messages: ChatMessage[]) {
    return messages.map(m => {
      const images = m.attachments?.filter(a => a.type.startsWith('image/')) || [];
      const texts = m.attachments?.filter(a => !a.type.startsWith('image/')) || [];

      let textContent = m.content;
      if (texts.length > 0) {
        textContent += texts
          .map(a => `\n\n---\nAttachment: ${a.name}\n\`\`\`\n${a.content}\n\`\`\``)
          .join('');
      }

      // Use multimodal content blocks for images (OpenAI vision format)
      if (images.length > 0) {
        const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
          { type: 'text', text: textContent },
        ];
        for (const img of images) {
          parts.push({
            type: 'image_url',
            image_url: { url: img.content },
          });
        }
        return { role: m.role, content: parts };
      }

      return {
        role: m.role,
        content: textContent,
      };
    });
  }

  private mapMessagesForOllama(messages: ChatMessage[]) {
    return messages.map(m => {
      const images = m.attachments?.filter(a => a.type.startsWith('image/')) || [];
      const texts = m.attachments?.filter(a => !a.type.startsWith('image/')) || [];

      let textContent = m.content;
      if (texts.length > 0) {
        textContent += texts
          .map(a => `\n\n---\nAttachment: ${a.name}\n\`\`\`\n${a.content}\n\`\`\``)
          .join('');
      }

      // Ollama uses top-level "images" array with raw base64
      if (images.length > 0) {
        const base64Images = images
          .map(a => {
            const dataUrl = a.content;
            // Strip data:image/xxx;base64, prefix
            if (dataUrl.startsWith('data:')) {
              return dataUrl.split(',')[1];
            }
            return dataUrl;
          })
          .filter(Boolean);

        return {
          role: m.role,
          content: textContent,
          ...(base64Images.length > 0 && { images: base64Images }),
        };
      }

      return {
        role: m.role,
        content: textContent,
      };
    });
  }

  private buildOpenAIRequest(
    config: ModelConfig,
    messages: ChatMessage[],
    stream: boolean
  ): { url: string; init: RequestInit } {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    return {
      url: normalizeEndpoint(config.endpoint),
      init: {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config.model,
          messages: this.mapMessagesForOpenAI(messages),
          max_tokens: config.maxTokens,
          temperature: config.temperature,
          stream,
        }),
      },
    };
  }

  private buildOllamaRequest(
    config: ModelConfig,
    messages: ChatMessage[],
    stream: boolean
  ): { url: string; init: RequestInit } {
    return {
      url: config.endpoint,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          messages: this.mapMessagesForOllama(messages),
          stream,
          options: {
            num_predict: config.maxTokens,
            temperature: config.temperature,
          },
        }),
      },
    };
  }

  private buildCustomRequest(
    config: ModelConfig,
    messages: ChatMessage[],
    stream: boolean
  ): { url: string; init: RequestInit } {
    // Custom provider uses OpenAI-compatible format by default
    return this.buildOpenAIRequest(config, messages, stream);
  }

  /**
   * Validate a model config.
   */
  static validateConfig(config: Partial<ModelConfig>): string[] {
    const errors: string[] = [];
    if (!config.id || config.id.trim().length === 0) {
      errors.push('Model ID is required');
    }
    if (!config.name || config.name.trim().length === 0) {
      errors.push('Model name is required');
    }
    if (!config.provider) {
      errors.push('Provider is required');
    }
    if (!config.endpoint || config.endpoint.trim().length === 0) {
      errors.push('Endpoint URL is required');
    }
    if (config.provider === 'openai' && (!config.apiKey || config.apiKey.trim().length === 0)) {
      errors.push('API key is required for OpenAI provider');
    }
    if (!config.model || config.model.trim().length === 0) {
      errors.push('Model identifier is required');
    }
    if (config.maxTokens !== undefined && (config.maxTokens < 1 || config.maxTokens > 128000)) {
      errors.push('Max tokens must be between 1 and 128000');
    }
    if (config.temperature !== undefined && (config.temperature < 0 || config.temperature > 2)) {
      errors.push('Temperature must be between 0 and 2');
    }
    return errors;
  }
}
