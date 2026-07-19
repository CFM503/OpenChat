import { describe, it, expect, vi } from 'vitest';
import { resolveAgentRouting, modelLabel } from '../../server/src/providers/agentRouting.js';
import type { ModelConfig } from '../../server/src/providers/modelTypes.js';

function model(partial: Partial<ModelConfig> & { id: string; name: string }): ModelConfig {
  return {
    provider: 'openai',
    endpoint: 'https://api.example.com/v1',
    model: partial.model || partial.id,
    maxTokens: 4096,
    temperature: 0.4,
    isDefault: false,
    ...partial,
  };
}

function mockGateway(models: ModelConfig[], routing?: { cheapModelId?: string; codingModelId?: string }) {
  const map = new Map(models.map(m => [m.id, m]));
  return {
    getActiveModel: (id?: string) => {
      if (id && map.has(id)) return map.get(id)!;
      return models.find(m => m.isDefault) || models[0];
    },
    config: {
      load: () => ({ agentRouting: routing }),
    },
  } as any;
}

describe('resolveAgentRouting', () => {
  const primary = model({ id: 'main', name: 'Main', isDefault: true, model: 'gpt-4o' });
  const cheap = model({ id: 'cheap', name: 'Flash', model: 'flash' });
  const coding = model({ id: 'code', name: 'Coder', model: 'coder' });

  it('defaults agent and summary to primary', () => {
    const r = resolveAgentRouting(mockGateway([primary]), 'main');
    expect(r?.agent.id).toBe('main');
    expect(r?.summary.id).toBe('main');
    expect(r?.agentIsOverride).toBe(false);
    expect(r?.summaryIsSeparate).toBe(false);
  });

  it('uses codingModelId for agent loop', () => {
    const r = resolveAgentRouting(
      mockGateway([primary, coding, cheap], { codingModelId: 'code', cheapModelId: 'cheap' }),
      'main',
    );
    expect(r?.agent.id).toBe('code');
    expect(r?.summary.id).toBe('cheap');
    expect(r?.agentIsOverride).toBe(true);
    expect(r?.summaryIsSeparate).toBe(true);
  });

  it('uses cheap only for summary when coding unset', () => {
    const r = resolveAgentRouting(
      mockGateway([primary, cheap], { cheapModelId: 'cheap' }),
      'main',
    );
    expect(r?.agent.id).toBe('main');
    expect(r?.summary.id).toBe('cheap');
    expect(r?.summaryIsSeparate).toBe(true);
  });

  it('modelLabel prefers name', () => {
    expect(modelLabel(primary)).toBe('Main');
  });
});
