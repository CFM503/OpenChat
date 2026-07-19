import { describe, it, expect } from 'vitest';
import {
  extractContextFromApiModel,
  normalizeContextTokens,
  inferContextWindowFromId,
  parseModelsListResponse,
  formatContextLabel,
} from '../../server/src/providers/inferContextWindow.js';

describe('normalizeContextTokens', () => {
  it('parses k/m suffixes', () => {
    expect(normalizeContextTokens('128k')).toBe(128_000);
    expect(normalizeContextTokens('1m')).toBe(1_000_000);
  });
  it('rejects tiny values (output caps)', () => {
    expect(normalizeContextTokens(4096)).toBe(4096);
    expect(normalizeContextTokens(512)).toBeUndefined();
  });
});

describe('extractContextFromApiModel', () => {
  it('reads OpenRouter-style context_length', () => {
    expect(extractContextFromApiModel({ id: 'x', context_length: 200000 })).toBe(200000);
  });
  it('reads nested top_provider', () => {
    expect(
      extractContextFromApiModel({ id: 'x', top_provider: { context_length: 131072 } }),
    ).toBe(131072);
  });
});

describe('inferContextWindowFromId', () => {
  it('deepseek', () => {
    expect(inferContextWindowFromId('deepseek-chat', 'https://api.deepseek.com')).toBe(64_000);
  });
  it('name with 128k', () => {
    expect(inferContextWindowFromId('moonshot-v1-128k')).toBe(128_000);
  });
  it('claude', () => {
    expect(inferContextWindowFromId('claude-sonnet-4')).toBe(200_000);
  });
});

describe('parseModelsListResponse', () => {
  it('parses OpenAI list with optional context', () => {
    const models = parseModelsListResponse({
      data: [
        { id: 'gpt-4o', context_length: 128000 },
        { id: 'deepseek-chat' },
      ],
    }, 'https://api.example.com/v1/models');
    expect(models.find(m => m.id === 'gpt-4o')?.contextWindow).toBe(128000);
    expect(models.find(m => m.id === 'gpt-4o')?.source).toBe('api');
    expect(models.find(m => m.id === 'deepseek-chat')?.source).toBe('inferred');
    expect(models.find(m => m.id === 'deepseek-chat')?.contextWindow).toBe(64_000);
  });

  it('parses Ollama tags', () => {
    const models = parseModelsListResponse({
      models: [{ name: 'llama3:latest' }],
    }, 'http://localhost:11434/api/tags');
    expect(models[0].id).toBe('llama3:latest');
  });
});

describe('formatContextLabel', () => {
  it('formats k and M', () => {
    expect(formatContextLabel(128000)).toBe('128k');
    expect(formatContextLabel(1000000)).toBe('1M');
  });
});
