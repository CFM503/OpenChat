// ============================================================================
// Test Suite B: Model Configuration and Routing Gateway
// ============================================================================

import { describe, it, expect } from 'vitest';
import { ModelRouter, DEFAULT_MODELS, normalizeEndpoint } from '../core/modelRouter';
import type { ModelConfig, ChatMessage } from '../core/types';

describe('ModelRouter Gateway', () => {
  it('should initialize with default model configurations', () => {
    const router = new ModelRouter();
    const models = router.getAllModels();
    expect(models.length).toBe(DEFAULT_MODELS.length);
    
    const defaultModel = router.getDefaultModel();
    expect(defaultModel).toBeDefined();
    expect(defaultModel?.id).toBe('gpt-4o');
  });

  it('should support adding and fetching new custom models', () => {
    const router = new ModelRouter([]);
    const customConfig: ModelConfig = {
      id: 'custom-deepseek',
      name: 'DeepSeek Chat',
      provider: 'custom',
      endpoint: 'https://api.deepseek.com/v1/chat/completions',
      apiKey: 'sk-deepseek-test-key-12345',
      model: 'deepseek-chat',
      maxTokens: 8192,
      temperature: 0.2,
      isDefault: true,
    };

    router.addModel(customConfig);
    
    const fetched = router.getModel('custom-deepseek');
    expect(fetched).toBeDefined();
    expect(fetched?.name).toBe('DeepSeek Chat');
    expect(fetched?.apiKey).toBe('sk-deepseek-test-key-12345');
    expect(router.getDefaultModel()?.id).toBe('custom-deepseek');
  });

  it('should build a valid OpenAI request body and headers', () => {
    const router = new ModelRouter();
    const messages: ChatMessage[] = [
      { id: '1', role: 'user', content: 'Hello AI', timestamp: Date.now() }
    ];

    const req = router.buildRequest('gpt-4o', messages, true);
    expect(req).not.toBeNull();
    if (req) {
      expect(req.url).toBe('https://api.openai.com/v1/chat/completions');
      expect(req.init.method).toBe('POST');
      
      const body = JSON.parse(req.init.body as string);
      expect(body.model).toBe('gpt-4o');
      expect(body.stream).toBe(true);
      expect(body.messages).toEqual([{ role: 'user', content: 'Hello AI' }]);
    }
  });

  it('should build a valid Ollama request body and options', () => {
    const router = new ModelRouter();
    const messages: ChatMessage[] = [
      { id: '1', role: 'user', content: 'Tell me a joke', timestamp: Date.now() }
    ];

    const req = router.buildRequest('ollama-llama3', messages, false);
    expect(req).not.toBeNull();
    if (req) {
      expect(req.url).toBe('http://localhost:11434/api/chat');
      
      const body = JSON.parse(req.init.body as string);
      expect(body.model).toBe('llama3');
      expect(body.stream).toBe(false);
      expect(body.options.temperature).toBe(0.7);
    }
  });

  it('should validate configurations correctly', () => {
    const router = new ModelRouter();

    // API key is optional — no error when missing
    const noKeyConfig: Partial<ModelConfig> = {
      id: 'openai-nokey',
      name: 'OpenAI No Key',
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-4o',
      maxTokens: 4096,
      temperature: 0.7,
    };
    const noKeyErrors = ModelRouter.validateConfig(noKeyConfig);
    expect(noKeyErrors).not.toContain('API key is required for OpenAI provider');

    // Invalid config — missing required fields
    const invalidConfig: Partial<ModelConfig> = {
      id: '',
      name: '',
      provider: 'openai',
      endpoint: '',
      model: '',
    };
    const errors = ModelRouter.validateConfig(invalidConfig);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors).toContain('Model name is required');
    expect(errors).toContain('Endpoint URL is required');
    expect(errors).toContain('Model identifier is required');

    // Invalid temperature and tokens
    const invalidConfig2: Partial<ModelConfig> = {
      id: 'custom-invalid',
      name: 'Custom test',
      provider: 'custom',
      endpoint: 'https://api.custom.com',
      model: 'test',
      maxTokens: -5,
      temperature: 3.5,
    };

    const errors2 = ModelRouter.validateConfig(invalidConfig2);
    expect(errors2).toContain('Max tokens must be between 1 and 128000');
    expect(errors2).toContain('Temperature must be between 0 and 2');
  });

  it('should support deleting model configurations', () => {
    const router = new ModelRouter();
    expect(router.getModel('gpt-4o')).toBeDefined();
    
    const deleted = router.removeModel('gpt-4o');
    expect(deleted).toBe(true);
    expect(router.getModel('gpt-4o')).toBeUndefined();
  });

  it('should auto-normalize base URLs when building custom requests', () => {
    const router = new ModelRouter([]);
    router.addModel({
      id: 'custom-base-url',
      name: 'Base URL Test',
      provider: 'custom',
      endpoint: 'https://token-plan-cn.xiaomimimo.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      maxTokens: 4096,
      temperature: 0.7,
      isDefault: true,
    });

    const messages: ChatMessage[] = [
      { id: '1', role: 'user', content: 'Hello', timestamp: Date.now() },
    ];

    const req = router.buildRequest('custom-base-url', messages, true);
    expect(req).not.toBeNull();
    if (req) {
      expect(req.url).toBe('https://token-plan-cn.xiaomimimo.com/v1/chat/completions');
    }
  });
});

describe('normalizeEndpoint', () => {
  it('should append /v1/chat/completions to bare domain', () => {
    expect(normalizeEndpoint('https://api.example.com')).toBe(
      'https://api.example.com/v1/chat/completions'
    );
  });

  it('should append /chat/completions to /v1 path', () => {
    expect(normalizeEndpoint('https://api.example.com/v1')).toBe(
      'https://api.example.com/v1/chat/completions'
    );
  });

  it('should handle trailing slash on /v1/', () => {
    expect(normalizeEndpoint('https://api.example.com/v1/')).toBe(
      'https://api.example.com/v1/chat/completions'
    );
  });

  it('should handle trailing slash on bare domain', () => {
    expect(normalizeEndpoint('https://api.example.com/')).toBe(
      'https://api.example.com/v1/chat/completions'
    );
  });

  it('should leave already-complete URL unchanged', () => {
    expect(normalizeEndpoint('https://api.openai.com/v1/chat/completions')).toBe(
      'https://api.openai.com/v1/chat/completions'
    );
  });

  it('should strip trailing slash from complete URL', () => {
    expect(normalizeEndpoint('https://api.openai.com/v1/chat/completions/')).toBe(
      'https://api.openai.com/v1/chat/completions'
    );
  });

  it('should handle real-world base URLs', () => {
    expect(normalizeEndpoint('https://token-plan-cn.xiaomimimo.com/v1')).toBe(
      'https://token-plan-cn.xiaomimimo.com/v1/chat/completions'
    );
    expect(normalizeEndpoint('https://api.deepseek.com/v1')).toBe(
      'https://api.deepseek.com/v1/chat/completions'
    );
    expect(normalizeEndpoint('https://openrouter.ai/api/v1')).toBe(
      'https://openrouter.ai/api/v1/chat/completions'
    );
    // Google Gemini OpenAI-compatible endpoint
    expect(normalizeEndpoint('https://generativelanguage.googleapis.com/v1beta/openai')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
    );
    expect(normalizeEndpoint('https://generativelanguage.googleapis.com/v1beta')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
    );
  });

  it('should trim whitespace', () => {
    expect(normalizeEndpoint('  https://api.example.com/v1  ')).toBe(
      'https://api.example.com/v1/chat/completions'
    );
  });
});

describe('ModelRouter Attachments Serialization', () => {
  it('should serialize text attachments into prompt content for OpenAI', () => {
    const router = new ModelRouter([]);
    router.addModel({
      id: 'openai-test',
      name: 'OpenAI Test',
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      maxTokens: 1000,
      temperature: 0.7,
      isDefault: true,
    });

    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'user',
        content: 'Hello, check these files.',
        timestamp: Date.now(),
        attachments: [
          {
            name: 'main.py',
            type: 'text/x-python',
            size: 50,
            content: 'print("hello world")'
          }
        ]
      }
    ];

    const req = router.buildRequest('openai-test', messages, true);
    expect(req).not.toBeNull();
    const body = JSON.parse((req!.init.body as string));
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].content).toContain('Attachment: main.py');
    expect(body.messages[0].content).toContain('print("hello world")');
  });

  it('should serialize image attachments into multimodal content blocks for OpenAI', () => {
    const router = new ModelRouter([]);
    router.addModel({
      id: 'openai-test',
      name: 'OpenAI Test',
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      maxTokens: 1000,
      temperature: 0.7,
      isDefault: true,
    });

    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'user',
        content: 'Check this image.',
        timestamp: Date.now(),
        attachments: [
          {
            name: 'photo.png',
            type: 'image/png',
            size: 1000,
            content: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
          }
        ]
      }
    ];

    const req = router.buildRequest('openai-test', messages, true);
    expect(req).not.toBeNull();
    const body = JSON.parse((req!.init.body as string));
    expect(body.messages[0].role).toBe('user');
    // Images use multimodal content array (OpenAI vision format)
    expect(Array.isArray(body.messages[0].content)).toBe(true);
    expect(body.messages[0].content[0].type).toBe('text');
    expect(body.messages[0].content[0].text).toContain('Check this image.');
    expect(body.messages[0].content[1].type).toBe('image_url');
    expect(body.messages[0].content[1].image_url.url).toContain('data:image/png;base64,');
  });

  it('should serialize image attachments into top-level images array for Ollama', () => {
    const router = new ModelRouter([]);
    router.addModel({
      id: 'ollama-test',
      name: 'Ollama Test',
      provider: 'ollama',
      endpoint: 'http://localhost:11434/api/chat',
      model: 'llava',
      maxTokens: 1000,
      temperature: 0.7,
      isDefault: true,
    });

    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'user',
        content: 'Look at this.',
        timestamp: Date.now(),
        attachments: [
          {
            name: 'photo.png',
            type: 'image/png',
            size: 1000,
            content: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
          }
        ]
      }
    ];

    const req = router.buildRequest('ollama-test', messages, true);
    expect(req).not.toBeNull();
    const body = JSON.parse((req!.init.body as string));
    expect(body.messages[0].role).toBe('user');
    // Ollama uses top-level images array with raw base64
    expect(body.messages[0].content).toBe('Look at this.');
    expect(Array.isArray(body.messages[0].images)).toBe(true);
    expect(body.messages[0].images[0]).toContain('iVBORw0KGgo');
    // Should not have data: prefix
    expect(body.messages[0].images[0]).not.toContain('data:');
  });
});
