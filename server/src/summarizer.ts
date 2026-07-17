// ============================================================================
// Context Summarizer — LLM compression when packer signals over-budget
// ============================================================================

import { ProviderGateway } from './providerGateway.js';
import type { ModelConfig } from './providers/modelTypes.js';
import { resolveModelCaps } from './providers/resolveCaps.js';
import { buildCompletionRequest } from './providers/requestAdapter.js';
import { estimateTokens } from './context/tokenBudget.js';

interface SummarizeRequest {
  messages: Array<{ role: string; content: string | any[] }>;
  summaryPrefix?: string;
}

interface SummarizeResult {
  summary: string;
  recentMessages: Array<{ role: string; content: string }>;
}

const SUMMARY_PROMPT = `Compress the conversation into a dense summary for an AI coding agent.

Keep: decisions, file paths, commands run, errors, TODOs, user constraints.
Drop: chit-chat, repeated tool dumps, full file contents (keep paths + intent).
Max ~400 words. Use bullet points.`;

function estimateTokenCount(messages: any[]): number {
  return messages.reduce((sum, m) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return sum + estimateTokens(content);
  }, 0);
}

async function compress(
  gateway: ProviderGateway,
  model: ModelConfig,
  req: SummarizeRequest,
): Promise<SummarizeResult> {
  const caps = resolveModelCaps(model);
  const budget = Math.floor(caps.historyTokenBudget * 0.85);
  const tokenCount = estimateTokenCount(req.messages);

  if (tokenCount <= budget) {
    return {
      summary: req.summaryPrefix ?? '',
      recentMessages: req.messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
    };
  }

  // Keep last ~40% as recent, summarize the rest
  const keepCount = Math.max(4, Math.ceil(req.messages.length * 0.4));
  const cut = Math.max(0, req.messages.length - keepCount);
  const oldHalf = req.messages.slice(0, cut);
  const recentHalf = req.messages.slice(cut);

  if (oldHalf.length === 0) {
    return {
      summary: req.summaryPrefix ?? '',
      recentMessages: recentHalf.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
    };
  }

  const result = await summarize(gateway, model, oldHalf, req.summaryPrefix);

  return {
    summary: result.summary,
    recentMessages: recentHalf.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    })),
  };
}

async function summarize(
  gateway: ProviderGateway,
  model: ModelConfig,
  messages: Array<{ role: string; content: string | any[] }>,
  summaryPrefix?: string,
): Promise<{ summary: string }> {
  const history = messages.map(m => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
  }));

  // Truncate history text itself if huge
  let historyJson = JSON.stringify(history);
  if (historyJson.length > 24_000) {
    historyJson = historyJson.slice(0, 24_000) + '…[truncated for summarizer]';
  }

  const systemContent = summaryPrefix
    ? `${SUMMARY_PROMPT}\n\nPrevious summary (merge/extend):\n${summaryPrefix}`
    : SUMMARY_PROMPT;

  // Non-streaming one-shot via adapter
  const built = buildCompletionRequest(
    {
      ...model,
      // Force cheap summarizer settings
      temperature: 0.2,
      maxTokens: Math.min(model.maxTokens || 2048, 2048),
      supportsTemperature: true,
      reasoningMode: 'none',
      disableTools: true,
    },
    {
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: historyJson },
      ],
      stream: false,
    },
  );

  // Override stream false in body
  built.body.stream = false;

  const resp = await fetch(built.url, {
    method: 'POST',
    headers: built.headers,
    body: JSON.stringify(built.body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Summarization failed (${resp.status}): ${text.substring(0, 500)}`);
  }

  const data = await resp.json() as any;

  // OpenAI shape
  let summary = data.choices?.[0]?.message?.content ?? '';
  // Anthropic shape
  if (!summary && Array.isArray(data.content)) {
    summary = data.content.map((c: any) => c.text || '').join('');
  }
  // Ollama non-stream
  if (!summary && data.message?.content) {
    summary = data.message.content;
  }

  return { summary: summary || '' };
}

export async function compressConversation(
  gateway: ProviderGateway,
  model: ModelConfig,
  messages: Array<{ role: string; content: string | any[] }>,
): Promise<{ summary: string; recentMessages: Array<{ role: string; content: string }> }> {
  return compress(gateway, model, { messages });
}
