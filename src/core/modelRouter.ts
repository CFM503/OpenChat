// ============================================================================
// Model Router Gateway
// Supports OpenAI-compatible, Ollama, and custom model endpoints
// ============================================================================

import type { ModelConfig, ModelProvider, ChatMessage, ContextStrategy, TokenParamStyle, ApiStyle } from './types';

/**
 * Normalizes an endpoint URL for OpenAI-compatible providers.
 *
 * Rules:
 *  - Strips trailing slashes
 *  - If URL already ends with /chat/completions → keep as-is
 *  - If URL ends with /v1 → append /chat/completions
 *  - If path is /v1beta or /v1alpha → append /openai/chat/completions (Gemini)
 *  - If path ends with /openai → append /chat/completions
 *  - Bare domain → append /v1/chat/completions
 *
 * Examples:
 *   https://api.example.com/v1           → .../v1/chat/completions
 *   https://api.example.com              → .../v1/chat/completions
 *   .../v1beta/openai                    → .../v1beta/openai/chat/completions
 *   .../v1beta                           → .../v1beta/openai/chat/completions
 */
export function normalizeEndpoint(url: string): string {
  let normalized = url.trim().replace(/\/+$/, '');
  if (normalized.endsWith('/chat/completions')) return normalized;
  if (normalized.endsWith('/v1')) return normalized + '/chat/completions';
  try {
    const parsed = new URL(normalized);
    const p = parsed.pathname.replace(/\/+$/, '');
    // Ends with /openai (e.g. Gemini OpenAI-compat shim)
    if (/\/openai$/i.test(p)) {
      return normalized + '/chat/completions';
    }
    // API version prefix only (e.g. /v1beta, /v1alpha) → Gemini-style path
    if (/^\/v\d+\w*$/.test(p)) {
      return normalized + '/openai/chat/completions';
    }
    // Already has /v1beta/openai or similar sub-path
    if (/^\/v\d+\w*\/openai/.test(p)) {
      return normalized + '/chat/completions';
    }
    // Non-root path that looks like a complete API path (Ollama, etc.)
    if (p !== '' && p !== '/' && /\/(api|v\d+)/.test(p) && !p.endsWith('/v1')) {
      // Keep Ollama-style paths; still append chat completions for bare /v1 already handled
      if (/\/(generate|chat|tags)$/.test(p)) return normalized;
    }
  } catch {
    // Not a valid URL — fall through
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
 * Provider presets for quick model configuration (global + China)
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
  modelsEndpoint?: string;
  helpUrl?: string;
  region?: 'global' | 'cn' | 'local';
  /** Defaults applied when adding from this preset */
  defaults?: Partial<ModelConfig>;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  // ── Global ────────────────────────────────────────────────────────
  {
    id: 'openai',
    name: 'OpenAI',
    icon: '🟢',
    region: 'global',
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    needsApiKey: true,
    apiKeyPlaceholder: 'sk-...',
    helpUrl: 'https://platform.openai.com/api-keys',
    defaults: { contextWindow: 128000, tokenParam: 'max_tokens', contextStrategy: 'balanced' },
  },
  {
    id: 'openai-o3',
    name: 'OpenAI o3 / reasoning',
    icon: '🧠',
    region: 'global',
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    model: 'o3-mini',
    needsApiKey: true,
    apiKeyPlaceholder: 'sk-...',
    defaults: {
      tokenParam: 'max_completion_tokens',
      supportsTemperature: false,
      reasoningMode: 'enabled',
      contextWindow: 200000,
      contextStrategy: 'balanced',
    },
  },
  {
    id: 'google',
    name: 'Google Gemini',
    icon: '🔵',
    region: 'global',
    provider: 'custom',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    needsApiKey: true,
    apiKeyPlaceholder: 'AIza...',
    helpUrl: 'https://aistudio.google.com/apikey',
    defaults: { contextWindow: 128000, supportsVision: true },
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    icon: '🟠',
    region: 'global',
    provider: 'custom',
    endpoint: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-20250514',
    needsApiKey: true,
    apiKeyPlaceholder: 'sk-ant-...',
    helpUrl: 'https://console.anthropic.com/settings/keys',
    defaults: {
      apiStyle: 'anthropic',
      authStyle: 'anthropic-x-api-key',
      contextWindow: 200000,
      tokenParam: 'max_tokens',
    },
  },
  {
    id: 'groq',
    name: 'Groq',
    icon: '⚡',
    region: 'global',
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
    region: 'global',
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
    region: 'global',
    provider: 'custom',
    endpoint: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-sonnet-4',
    needsApiKey: true,
    apiKeyPlaceholder: 'sk-or-...',
    helpUrl: 'https://openrouter.ai/keys',
    defaults: {
      extraHeaders: { 'HTTP-Referer': 'https://github.com/openchat', 'X-Title': 'OpenChat' },
    },
  },
  // ── China ─────────────────────────────────────────────────────────
  {
    id: 'deepseek',
    name: 'DeepSeek',
    icon: '🟣',
    region: 'cn',
    provider: 'custom',
    endpoint: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    needsApiKey: true,
    apiKeyPlaceholder: 'sk-...',
    helpUrl: 'https://platform.deepseek.com/api_keys',
    defaults: { contextWindow: 64000, contextStrategy: 'balanced' },
  },
  {
    id: 'deepseek-r1',
    name: 'DeepSeek Reasoner',
    icon: '🟣',
    region: 'cn',
    provider: 'custom',
    endpoint: 'https://api.deepseek.com/v1',
    model: 'deepseek-reasoner',
    needsApiKey: true,
    defaults: {
      reasoningMode: 'enabled',
      supportsTemperature: false,
      contextWindow: 64000,
    },
  },
  {
    id: 'qwen',
    name: '通义千问 Qwen',
    icon: '🟦',
    region: 'cn',
    provider: 'custom',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    needsApiKey: true,
    apiKeyPlaceholder: 'sk-...',
    helpUrl: 'https://dashscope.console.aliyun.com/',
    defaults: { contextWindow: 128000 },
  },
  {
    id: 'moonshot',
    name: 'Moonshot Kimi',
    icon: '🌙',
    region: 'cn',
    provider: 'custom',
    endpoint: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-128k',
    needsApiKey: true,
    helpUrl: 'https://platform.moonshot.cn/',
    defaults: { contextWindow: 128000 },
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    icon: '⬛',
    region: 'cn',
    provider: 'custom',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    needsApiKey: true,
    helpUrl: 'https://open.bigmodel.cn/',
    defaults: { contextWindow: 128000 },
  },
  {
    id: 'doubao',
    name: '豆包 Doubao',
    icon: '🟡',
    region: 'cn',
    provider: 'custom',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-pro-32k',
    needsApiKey: true,
    helpUrl: 'https://console.volcengine.com/ark',
    defaults: { contextWindow: 32000 },
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow 硅基流动',
    icon: '💠',
    region: 'cn',
    provider: 'custom',
    endpoint: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
    needsApiKey: true,
    helpUrl: 'https://cloud.siliconflow.cn/',
    defaults: { contextWindow: 64000 },
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    icon: '🔴',
    region: 'cn',
    provider: 'custom',
    endpoint: 'https://api.minimax.chat/v1',
    model: 'MiniMax-Text-01',
    needsApiKey: true,
    helpUrl: 'https://platform.minimaxi.com/',
    defaults: { contextWindow: 245000 },
  },
  {
    id: 'baichuan',
    name: '百川 Baichuan',
    icon: '⚪',
    region: 'cn',
    provider: 'custom',
    endpoint: 'https://api.baichuan-ai.com/v1',
    model: 'Baichuan4',
    needsApiKey: true,
    helpUrl: 'https://platform.baichuan-ai.com/',
  },
  {
    id: 'yi',
    name: '零一万物 Yi',
    icon: '1️⃣',
    region: 'cn',
    provider: 'custom',
    endpoint: 'https://api.lingyiwanwu.com/v1',
    model: 'yi-large',
    needsApiKey: true,
    helpUrl: 'https://platform.lingyiwanwu.com/',
  },
  {
    id: 'mimo',
    name: 'Xiaomi MiMo',
    icon: '🟤',
    region: 'cn',
    provider: 'custom',
    endpoint: 'https://mimo.mi.com/v1',
    model: 'mimo-v2.5-pro',
    needsApiKey: true,
    helpUrl: 'https://mimo.mi.com',
    defaults: { contextWindow: 128000 },
  },
  {
    id: 'stepfun',
    name: '阶跃星辰 StepFun',
    icon: '🪜',
    region: 'cn',
    provider: 'custom',
    endpoint: 'https://api.stepfun.com/v1',
    model: 'step-2-16k',
    needsApiKey: true,
    helpUrl: 'https://platform.stepfun.com/',
  },
  // ── Local ─────────────────────────────────────────────────────────
  {
    id: 'lmstudio',
    name: 'LM Studio',
    icon: '🏠',
    region: 'local',
    provider: 'custom',
    endpoint: 'http://localhost:1234/v1',
    model: '',
    needsApiKey: false,
    modelsEndpoint: 'http://localhost:1234/v1/models',
    defaults: { contextStrategy: 'minimal', contextWindow: 32000 },
  },
  {
    id: 'ollama',
    name: 'Ollama',
    icon: '🦙',
    region: 'local',
    provider: 'ollama',
    endpoint: 'http://localhost:11434/api/chat',
    model: '',
    needsApiKey: false,
    modelsEndpoint: 'http://localhost:11434/api/tags',
    defaults: { apiStyle: 'ollama', tokenParam: 'num_predict', contextWindow: 32000 },
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

  private mapAttachments(m: ChatMessage) {
    const images = m.attachments?.filter(a => a.type.startsWith('image/')) || [];
    const texts = m.attachments?.filter(a => !a.type.startsWith('image/')) || [];
    let textContent = m.content;
    if (texts.length > 0) {
      textContent += texts
        .map(a => `\n\n---\nAttachment: ${a.name}\n\`\`\`\n${a.content}\n\`\`\``)
        .join('');
    }
    return { textContent, images };
  }

  private mapMessagesForOpenAI(messages: ChatMessage[]) {
    return messages.map(m => {
      const { textContent, images } = this.mapAttachments(m);
      if (images.length > 0) {
        const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
          { type: 'text', text: textContent },
        ];
        for (const img of images) {
          parts.push({ type: 'image_url', image_url: { url: img.content } });
        }
        return { role: m.role, content: parts };
      }
      return { role: m.role, content: textContent };
    });
  }

  private mapMessagesForOllama(messages: ChatMessage[]) {
    return messages.map(m => {
      const { textContent, images } = this.mapAttachments(m);
      if (images.length > 0) {
        const base64Images = images
          .map(a => a.content.startsWith('data:') ? a.content.split(',')[1] : a.content)
          .filter(Boolean);
        return {
          role: m.role,
          content: textContent,
          ...(base64Images.length > 0 && { images: base64Images }),
        };
      }
      return { role: m.role, content: textContent };
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
          ...(config.useMaxTokens !== false && { max_tokens: config.maxTokens }),
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
