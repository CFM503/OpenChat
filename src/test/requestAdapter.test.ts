import { describe, it, expect } from 'vitest';
import {
  buildCompletionRequest,
  adaptMessagesForModel,
  applyThinkingPreference,
} from '../../server/src/providers/requestAdapter.js';
import type { ModelConfig } from '../../server/src/providers/modelTypes.js';

const openaiModel: ModelConfig = {
  id: '1',
  name: 'gpt',
  provider: 'openai',
  endpoint: 'https://api.openai.com/v1',
  model: 'gpt-4o',
  maxTokens: 1024,
  temperature: 0.5,
  isDefault: true,
  apiKey: 'sk-test',
};

describe('buildCompletionRequest', () => {
  it('builds OpenAI body with max_tokens', () => {
    const req = buildCompletionRequest(openaiModel, {
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    });
    expect(req.url).toContain('/chat/completions');
    expect(req.headers.Authorization).toBe('Bearer sk-test');
    expect(req.body.max_tokens).toBe(1024);
    expect(req.body.temperature).toBe(0.5);
    expect(req.body.stream).toBe(true);
  });

  it('uses max_completion_tokens for o-series', () => {
    const req = buildCompletionRequest(
      { ...openaiModel, model: 'o3-mini', tokenParam: 'max_completion_tokens', supportsTemperature: false },
      { messages: [{ role: 'user', content: 'hi' }] },
    );
    expect(req.body.max_completion_tokens).toBe(1024);
    expect(req.body.max_tokens).toBeUndefined();
    expect(req.body.temperature).toBeUndefined();
  });

  it('builds anthropic messages request', () => {
    const req = buildCompletionRequest(
      {
        ...openaiModel,
        endpoint: 'https://api.anthropic.com/v1',
        model: 'claude-sonnet-4-20250514',
        apiStyle: 'anthropic',
        authStyle: 'anthropic-x-api-key',
      },
      {
        messages: [
          { role: 'system', content: 'Be helpful' },
          { role: 'user', content: 'hi' },
        ],
        tools: [{
          type: 'function',
          function: { name: 'bash', description: 'run', parameters: { type: 'object' } },
        }],
      },
    );
    expect(req.apiStyle).toBe('anthropic');
    expect(req.url).toContain('/messages');
    expect(req.headers['x-api-key']).toBe('sk-test');
    expect(req.body.system).toBe('Be helpful');
    expect(Array.isArray(req.body.tools)).toBe(true);
    expect((req.body.tools as any[])[0].name).toBe('bash');
  });
});

describe('adaptMessagesForModel', () => {
  it('folds system into user when supportsSystemRole is false', () => {
    const { messages } = adaptMessagesForModel(
      [
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'HELLO' },
      ],
      { ...openaiModel, supportsSystemRole: false },
    );
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toContain('SYS');
    expect(messages[0].content).toContain('HELLO');
  });
});

describe('applyThinkingPreference', () => {
  it('disables thinking for deepseek', () => {
    const body: Record<string, any> = { model: 'deepseek-chat' };
    applyThinkingPreference(
      body,
      { ...openaiModel, model: 'deepseek-chat', endpoint: 'https://api.deepseek.com/v1' },
      false,
      'openai',
    );
    expect(body.thinking).toEqual({ type: 'disabled' });
  });

  it('disables thinking for qwen via enable_thinking', () => {
    const body: Record<string, any> = {};
    applyThinkingPreference(
      body,
      { ...openaiModel, model: 'qwen-plus', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
      false,
      'openai',
    );
    expect(body.enable_thinking).toBe(false);
  });

  it('sets low reasoning_effort for o-series when disabled', () => {
    const body: Record<string, any> = {};
    applyThinkingPreference(
      body,
      { ...openaiModel, model: 'o3-mini' },
      false,
      'openai',
    );
    expect(body.reasoning_effort).toBe('low');
  });
});
