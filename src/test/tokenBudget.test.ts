import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  packConversation,
  packSkillCatalog,
  truncateToolResults,
} from '../../server/src/context/tokenBudget.js';
import { resolveModelCaps } from '../../server/src/providers/resolveCaps.js';
import type { ModelConfig } from '../../server/src/providers/modelTypes.js';

function baseModel(over: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 't',
    name: 't',
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    maxTokens: 4096,
    temperature: 0.7,
    isDefault: true,
    contextWindow: 8000,
    contextStrategy: 'balanced',
    ...over,
  };
}

describe('estimateTokens', () => {
  it('counts ascii cheaper than CJK', () => {
    const en = estimateTokens('hello world test');
    const zh = estimateTokens('你好世界测试文本内容');
    expect(zh).toBeGreaterThan(en);
  });
});

describe('resolveModelCaps', () => {
  it('detects o1 max_completion_tokens', () => {
    const caps = resolveModelCaps(baseModel({ model: 'o3-mini' }));
    expect(caps.tokenParam).toBe('max_completion_tokens');
    expect(caps.supportsTemperature).toBe(false);
  });

  it('detects deepseek reasoner', () => {
    const caps = resolveModelCaps(baseModel({
      model: 'deepseek-reasoner',
      endpoint: 'https://api.deepseek.com/v1',
    }));
    expect(caps.reasoningMode).toBe('enabled');
  });

  it('detects qwen dashscope', () => {
    const caps = resolveModelCaps(baseModel({
      model: 'qwen-plus',
      endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      contextWindow: undefined,
    }));
    expect(caps.contextWindow).toBeGreaterThanOrEqual(32000);
    expect(caps.supportsTools).toBe(true);
  });

  it('respects explicit overrides', () => {
    const caps = resolveModelCaps(baseModel({
      model: 'o3-mini',
      tokenParam: 'max_tokens',
      supportsTemperature: true,
    }));
    expect(caps.tokenParam).toBe('max_tokens');
    expect(caps.supportsTemperature).toBe(true);
  });
});

describe('packConversation', () => {
  it('keeps last user and system under budget', () => {
    const messages = [];
    for (let i = 0; i < 30; i++) {
      messages.push({ role: 'user', content: `question ${i} ` + 'x'.repeat(200) });
      messages.push({ role: 'assistant', content: `answer ${i} ` + 'y'.repeat(200) });
    }
    messages.push({ role: 'user', content: 'FINAL QUESTION' });

    const result = packConversation({
      messages,
      systemParts: ['You are OpenChat.'],
      model: baseModel({ contextStrategy: 'minimal', contextWindow: 4000 }),
    });

    expect(result.messages.some(m => m.role === 'system')).toBe(true);
    const lastUser = [...result.messages].reverse().find(m => m.role === 'user');
    expect(lastUser?.content).toContain('FINAL QUESTION');
    expect(result.stats.droppedMessages).toBeGreaterThan(0);
    expect(result.estimatedTokens).toBeLessThan(5000);
  });

  it('truncates tool results', () => {
    const msgs = [
      { role: 'user', content: 'hi' },
      { role: 'tool', tool_call_id: '1', content: 'Z'.repeat(10000) },
    ];
    const n = truncateToolResults(msgs, 100);
    expect(n).toBe(1);
    expect((msgs[1].content as string).length).toBeLessThan(200);
  });
});

describe('packSkillCatalog', () => {
  it('names mode is shorter than full', () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({
      shortcut: `/s${i}`,
      name: `s${i}`,
      description: 'A fairly long description of what this skill does in detail.',
    }));
    const names = packSkillCatalog(entries, 'names', 2000);
    const full = packSkillCatalog(entries, 'full', 2000);
    expect(names.length).toBeLessThan(full.length);
    expect(packSkillCatalog(entries, 'off', 2000)).toBe('');
  });
});
