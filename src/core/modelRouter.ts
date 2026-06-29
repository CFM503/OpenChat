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
  let normalized = url.trim().replace(/\/+$/, '');

  if (normalized.endsWith('/chat/completions')) return normalized;
  if (normalized.endsWith('/v1')) return normalized + '/chat/completions';

  try {
    const parsed = new URL(normalized);
    const p = parsed.pathname.replace(/\/+$/, '');
    if (/\/openai$/i.test(p)) return normalized + '/chat/completions';
    if (/^\/v\d+\w*$/.test(p)) return normalized + '/openai/chat/completions';
    if (/^\/v\d+\w*\/openai/.test(p)) return normalized + '/chat/completions';
    if (p !== '' && p !== '/') return normalized;
  } catch {
    // Not a valid URL, proceed with normalization
  }

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
    maxTokens: 131072,
    temperature: 0.7,
    isDefault: true,
  },
  {
    id: 'ollama-llama3',
    name: 'Llama 3 (Ollama Local)',
    provider: 'ollama',
    endpoint: 'http://localhost:11434/api/chat',
    model: 'llama3',
    maxTokens: 131072,
    temperature: 0.7,
    isDefault: false,
  },
];

/**
 * Provider presets for quick model configuration
 */
export interface ProviderPreset {
  id: string;
  name: string;
  icon: string;
  provider: 'openai' | 'ollama' | 'custom';
  endpoint: string;
  model: string;
  needsApiKey: boolean;
  apiKeyPlaceholder?: string;
  modelsEndpoint?: string; // For auto-detect
  helpUrl?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    icon: '🟢',
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    needsApiKey: true,
    apiKeyPlaceholder: 'sk-...',
    helpUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'google',
    name: 'Google Gemini',
    icon: '🔵',
    provider: 'custom',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    needsApiKey: true,
    apiKeyPlaceholder: 'AIza...',
    helpUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    icon: '🟠',
    provider: 'custom',
    endpoint: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-20250514',
    needsApiKey: true,
    apiKeyPlaceholder: 'sk-ant-...',
    helpUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    icon: '🟣',
    provider: 'custom',
    endpoint: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    needsApiKey: true,
    apiKeyPlaceholder: 'sk-...',
    helpUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'groq',
    name: 'Groq',
    icon: '⚡',
    provider: 'custom',
    endpoint: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    needsApiKey: true,
    apiKeyPlaceholder: 'gsk_...',
    helpUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'mistral',
    name: 'Mistral',
    icon: '🔶',
    provider: 'custom',
    endpoint: 'https://api.mistral.ai/v1',
    model: 'mistral-large-latest',
    needsApiKey: true,
    helpUrl: 'https://console.mistral.ai/api-keys',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    icon: '🔀',
    provider: 'custom',
    endpoint: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-sonnet-4',
    needsApiKey: true,
    apiKeyPlaceholder: 'sk-or-...',
    helpUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'mimo',
    name: 'Xiaomi MiMo',
    icon: '🟤',
    provider: 'custom',
    endpoint: 'https://mimo.mi.com/v1',
    model: 'mimo-v2.5-pro',
    needsApiKey: true,
    helpUrl: 'https://mimo.mi.com',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    icon: '🏠',
    provider: 'custom',
    endpoint: 'http://localhost:1234/v1',
    model: '',
    needsApiKey: false,
    modelsEndpoint: 'http://localhost:1234/v1/models',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    icon: '🦙',
    provider: 'ollama',
    endpoint: 'http://localhost:11434/api/chat',
    model: '',
    needsApiKey: false,
    modelsEndpoint: 'http://localhost:11434/api/tags',
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
    // API key is optional for all providers (local proxy, LM Studio, etc.)
    if (!config.model || config.model.trim().length === 0) {
      errors.push('Model identifier is required');
    }
    if (config.maxTokens !== undefined && (config.maxTokens < 4096 || config.maxTokens > 1000000)) {
      errors.push('Max tokens must be a multiple of 4096, between 4096 and 1,000,000');
    }
    if (config.maxTokens !== undefined && config.maxTokens % 4096 !== 0) {
      errors.push('Max tokens must be a multiple of 4096');
    }
    if (config.temperature !== undefined && (config.temperature < 0 || config.temperature > 2)) {
      errors.push('Temperature must be between 0 and 2');
    }
    return errors;
  }
}
