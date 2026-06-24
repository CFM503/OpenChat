// ============================================================================
// Model Router Gateway
// Supports OpenAI-compatible, Ollama, and custom model endpoints
// ============================================================================

import type { ModelConfig, ModelProvider, ChatMessage } from './types';

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
      url: config.endpoint,
      init: {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config.model,
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
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
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
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
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    return {
      url: config.endpoint,
      init: {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config.model,
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
          max_tokens: config.maxTokens,
          temperature: config.temperature,
          stream,
        }),
      },
    };
  }

  /**
   * Validate a model config.
   */
  validateConfig(config: Partial<ModelConfig>): string[] {
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
