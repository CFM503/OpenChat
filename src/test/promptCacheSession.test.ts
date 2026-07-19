import { describe, it, expect, beforeEach } from 'vitest';
import {
  PromptCacheStore,
  extractLatestTurn,
  countUserMessages,
  parseProviderUsage,
  cacheHitRate,
  addUsage,
  modelCacheKey,
} from '../../server/src/context/promptCacheSession.js';
import { resolveModelCaps } from '../../server/src/providers/resolveCaps.js';
import type { ModelConfig } from '../../server/src/providers/modelTypes.js';

describe('promptCacheSession helpers', () => {
  it('extractLatestTurn keeps system notes before last user', () => {
    const msgs = [
      { role: 'user', content: 'old' },
      { role: 'assistant', content: 'a1' },
      { role: 'system', content: 'search results' },
      { role: 'user', content: 'new question' },
    ];
    const turn = extractLatestTurn(msgs);
    expect(turn).toHaveLength(2);
    expect(turn[0].role).toBe('system');
    expect(turn[1].content).toBe('new question');
  });

  it('countUserMessages', () => {
    expect(countUserMessages([{ role: 'user' }, { role: 'assistant' }, { role: 'user' }])).toBe(2);
  });

  it('parseProviderUsage reads DeepSeek cache hits', () => {
    const u = parseProviderUsage({
      prompt_tokens: 1000,
      completion_tokens: 50,
      prompt_cache_hit_tokens: 800,
      prompt_cache_miss_tokens: 200,
    });
    expect(u?.promptTokens).toBe(1000);
    expect(u?.cachedTokens).toBe(800);
  });

  it('parseProviderUsage reads OpenAI cached_tokens details', () => {
    const u = parseProviderUsage({
      prompt_tokens: 500,
      completion_tokens: 10,
      prompt_tokens_details: { cached_tokens: 400 },
    });
    expect(u?.cachedTokens).toBe(400);
  });

  it('parseProviderUsage reads Anthropic cache fields', () => {
    const u = parseProviderUsage({
      input_tokens: 1200,
      output_tokens: 30,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 100,
    });
    expect(u?.cachedTokens).toBe(900);
    expect(u?.cacheWriteTokens).toBe(100);
  });

  it('cacheHitRate', () => {
    expect(cacheHitRate({ promptTokens: 1000, completionTokens: 0, cachedTokens: 750, cacheWriteTokens: 0 })).toBe(0.75);
  });

  it('addUsage accumulates', () => {
    const a = addUsage(
      { promptTokens: 10, completionTokens: 1, cachedTokens: 5, cacheWriteTokens: 0 },
      { promptTokens: 20, cachedTokens: 15 },
    );
    expect(a.promptTokens).toBe(30);
    expect(a.cachedTokens).toBe(20);
  });

  it('modelCacheKey is stable', () => {
    expect(modelCacheKey({ id: 'a', endpoint: 'http://x', model: 'm' })).toBe('a|http://x|m');
  });
});

describe('PromptCacheStore', () => {
  let store: PromptCacheStore;

  beforeEach(() => {
    store = new PromptCacheStore(60_000);
  });

  it('stores and retrieves session state', () => {
    const s = store.createFresh({
      sessionKey: 'ses_1',
      modelKey: 'm1',
      thinkingKey: 'on',
      systemParts: ['core'],
      dynamicNotes: [],
      toolDefs: [],
      llmMessages: [{ role: 'system', content: 'core' }, { role: 'user', content: 'hi' }],
      clientUserCount: 1,
    });
    store.set(s);
    const got = store.get('ses_1');
    expect(got?.llmMessages).toHaveLength(2);
    expect(got?.modelKey).toBe('m1');
  });

  it('delete removes session', () => {
    const s = store.createFresh({
      sessionKey: 'ses_x',
      modelKey: 'm',
      thinkingKey: 'off',
      systemParts: [],
      dynamicNotes: [],
      toolDefs: [],
      llmMessages: [{ role: 'user', content: 'a' }],
      clientUserCount: 1,
    });
    store.set(s);
    store.delete('ses_x');
    expect(store.get('ses_x')).toBeUndefined();
  });
});

describe('default context strategy', () => {
  it('defaults to cache_max when unset', () => {
    const model: ModelConfig = {
      id: 't',
      name: 't',
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      maxTokens: 4096,
      temperature: 0.7,
      isDefault: true,
    };
    expect(resolveModelCaps(model).contextStrategy).toBe('cache_max');
  });
});
