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
      {
        ...openaiModel,
        model: 'o3-mini',
        maxTokens: 8192,
        tokenParam: 'max_completion_tokens',
        supportsTemperature: false,
      },
      { messages: [{ role: 'user', content: 'hi' }] },
    );
    expect(req.body.max_completion_tokens).toBe(8192);
    expect(req.body.max_tokens).toBeUndefined();
    expect(req.body.temperature).toBeUndefined();
  });

  it('raises tiny max_tokens floor for pure reasoners', () => {
    const req = buildCompletionRequest(
      {
        ...openaiModel,
        model: 'o3-mini',
        maxTokens: 512,
        tokenParam: 'max_completion_tokens',
        supportsTemperature: false,
      },
      { messages: [{ role: 'user', content: 'hi' }] },
    );
    expect(req.body.max_completion_tokens).toBe(2048);
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

describe('promoteThinkingToAnswer', () => {
  it('extracts 最终答案 section', async () => {
    const { promoteThinkingToAnswer } = await import('../../server/src/agentLoop.js');
    const t = '先分析问题…\n\n最终答案：这是给用户的回复，足够长。';
    expect(promoteThinkingToAnswer(t)).toContain('这是给用户的回复');
  });

  it('falls back to full thinking when short and not monologue', async () => {
    const { promoteThinkingToAnswer } = await import('../../server/src/agentLoop.js');
    expect(promoteThinkingToAnswer('今天北京晴，气温 22 度。')).toContain('北京');
  });

  it('does not promote long internal monologue', async () => {
    const { promoteThinkingToAnswer } = await import('../../server/src/agentLoop.js');
    const mono =
      'Okay, the user wants to play the weather. Let me see. Looking at the available skills, ' +
      'I need to use web_search. Wait, the user did not specify a location. Maybe I should default to Beijing. '.repeat(
        3,
      );
    expect(promoteThinkingToAnswer(mono)).toBe('');
  });

  it('extracts generic canvas fence buried in monologue', async () => {
    const { promoteThinkingToAnswer } = await import('../../server/src/agentLoop.js');
    const mono = `
好的，我现在需要处理用户请求。让我看看。正确的下一步是调用工具。
\`\`\`canvas card
{"title":"结果","body":"完成"}
\`\`\`
`;
    const out = promoteThinkingToAnswer(mono);
    expect(out).toContain('```canvas card');
    expect(out).toContain('结果');
  });
});

describe('extractOpenAiDeltaPieces', () => {
  it('does not double thinking when multiple aliases carry the same token', async () => {
    const { extractOpenAiDeltaPieces } = await import('../../server/src/providerGateway.js');
    const pieces = extractOpenAiDeltaPieces({
      reasoning_content: 'Hello',
      reasoning: 'Hello',
      thinking: 'Hello',
    });
    const think = pieces.filter(p => p.type === 'thinking');
    const content = pieces.filter(p => p.type === 'content');
    // Only one stream piece total for mirrored fields
    expect(think.length + content.length).toBe(1);
    expect((think[0] || content[0])?.content).toBe('Hello');
  });

  it('normalizes OpenAI nested function tool_calls', async () => {
    // Fixture only: OpenAI streams tool calls as function.{name,arguments}, not top-level fields.
    // Any tool name works — this is not production routing or a hard-coded query.
    const { extractOpenAiDeltaPieces, normalizeOpenAiToolCalls } = await import(
      '../../server/src/providerGateway.js'
    );
    const nested = normalizeOpenAiToolCalls([
      {
        index: 0,
        id: 'call_1',
        function: { name: 'bash', arguments: '{"command":"echo hi"}' },
      },
    ]);
    expect(nested[0].name).toBe('bash');
    expect(nested[0].arguments).toContain('echo hi');

    const pieces = extractOpenAiDeltaPieces({
      tool_calls: [
        {
          index: 0,
          id: 'call_1',
          function: { name: 'bash', arguments: '{"command":"echo hi"}' },
        },
      ],
    });
    expect(pieces.some(p => p.type === 'tool_call' && p.toolCalls?.[0]?.name === 'bash')).toBe(true);
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
