import { describe, it, expect } from 'vitest';
import {
  withConfigDefaults,
  autoPickAgentRouting,
  OPENCHAT_CONFIG_DEFAULTS,
} from '../../server/src/configManager.js';
import type { ModelConfig } from '../../server/src/providers/modelTypes.js';

function m(partial: Partial<ModelConfig> & { id: string; name: string; model: string }): ModelConfig {
  return {
    provider: 'custom',
    endpoint: 'https://api.example.com/v1',
    maxTokens: 8192,
    temperature: 0.4,
    isDefault: false,
    ...partial,
  };
}

describe('OPENCHAT_CONFIG_DEFAULTS', () => {
  it('recommends cache_max + apply + task bridge', () => {
    expect(OPENCHAT_CONFIG_DEFAULTS.defaultContextStrategy).toBe('cache_max');
    expect(OPENCHAT_CONFIG_DEFAULTS.requireFileApply).toBe(true);
    expect(OPENCHAT_CONFIG_DEFAULTS.chatTaskBridge).toBe(true);
  });
});

describe('withConfigDefaults', () => {
  it('fills omitted safety flags', () => {
    const c = withConfigDefaults({});
    expect(c.requireFileApply).toBe(true);
    expect(c.chatTaskBridge).toBe(true);
    expect(c.defaultContextStrategy).toBe('cache_max');
  });

  it('preserves explicit false', () => {
    const c = withConfigDefaults({ requireFileApply: false, chatTaskBridge: false });
    expect(c.requireFileApply).toBe(false);
    expect(c.chatTaskBridge).toBe(false);
  });

  it('defaults cloud models to cache_max and ollama to balanced', () => {
    const c = withConfigDefaults({
      models: [
        m({ id: 'a', name: 'Cloud', model: 'gpt-4o', maxTokens: 0 as any }),
        m({
          id: 'b',
          name: 'Local',
          model: 'llama3',
          provider: 'ollama',
          endpoint: 'http://localhost:11434/api/chat',
        }),
      ],
    });
    expect(c.models?.[0].contextStrategy).toBe('cache_max');
    expect(c.models?.[1].contextStrategy).toBe('balanced');
  });
});

describe('autoPickAgentRouting', () => {
  it('picks flash as cheap and claude as coding', () => {
    const models = [
      m({ id: 'main', name: 'Main', model: 'gpt-4o', isDefault: true }),
      m({ id: 'flash', name: 'Flash', model: 'gemini-2.5-flash' }),
      m({ id: 'claude', name: 'Claude', model: 'claude-sonnet-4' }),
    ];
    const r = autoPickAgentRouting(models, 'main');
    expect(r.cheapModelId).toBe('flash');
    expect(r.codingModelId).toBe('claude');
  });
});
