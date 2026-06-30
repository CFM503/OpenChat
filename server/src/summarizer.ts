// ============================================================================
// Context Summarizer — Recursive compression via LLM instead of truncating
// ============================================================================

import { ProviderGateway } from './providerGateway.js';
import type { ModelConfig } from './configManager.js';

interface SummarizeRequest {
  messages: Array<{ role: string; content: string | any[] }>;
  summaryPrefix?: string;
}

interface SummarizeResult {
  summary: string;
  recentMessages: Array<{ role: string; content: string }>;
}

const SUMMARY_PROMPT = `You are a conversation summarizer. Compress the conversation below into a structured summary.

Rules:
- Preserve all factual information, decisions, and key details
- Keep the conversation flow clear (who said what)
- Include any code snippets, file paths, or important data
- Group related topics together
- Be concise but thorough`;

const MAX_TOKENS = 128_000;

/** Estimate token count from message content length (rough heuristic). */
function estimateTokenCount(messages: any[]): number {
  return Math.ceil(messages.reduce((sum, m) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return sum + content.length / 4;
  }, 0));
}

/**
 * Recursively compress messages that exceed the token limit.
 * Keeps the summary prefix (from prior compression rounds) + recent messages.
 */
async function compress(
  gateway: ProviderGateway,
  model: ModelConfig,
  req: SummarizeRequest,
): Promise<SummarizeResult> {
  const tokenCount = estimateTokenCount(req.messages);
  if (tokenCount <= MAX_TOKENS) {
    // Fits within limit — keep all messages as recent context
    return {
      summary: req.summaryPrefix ?? '',
      recentMessages: req.messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : '',
      })),
    };
  }

  // Split: compress older half, keep recent half
  const mid = Math.ceil(req.messages.length / 2);
  const oldHalf = req.messages.slice(0, mid);
  const recentHalf = req.messages.slice(mid);

  const result = await summarize(gateway, model, oldHalf, req.summaryPrefix);

  // Recurse: combine summary + recentHalf + newHalf, check if still too big
  const combined: SummarizeRequest = {
    messages: [
      ...(result.summary ? [{ role: 'system', content: result.summary }] : []),
      ...recentHalf,
    ],
  };

  return compress(gateway, model, combined);
}

/** Call the LLM to summarize a set of messages. */
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

  const systemContent = summaryPrefix
    ? `${SUMMARY_PROMPT}\n\nPrevious summary (append to this):\n${summaryPrefix}`
    : SUMMARY_PROMPT;

  const body: Record<string, any> = {
    model: model.model,
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: JSON.stringify(history) },
    ],
    temperature: 0.3,
    max_tokens: 4000,
    stream: false,
  };

  const url = normalizeEndpoint(model.endpoint);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (model.apiKey) headers['Authorization'] = `Bearer ${model.apiKey}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Summarization failed (${resp.status}): ${text.substring(0, 500)}`);
  }

  const data = await resp.json();
  return { summary: data.choices?.[0]?.message?.content ?? '' };
}

/** Public API: compress messages if they exceed the token limit. */
export async function compressConversation(
  gateway: ProviderGateway,
  model: ModelConfig,
  messages: Array<{ role: string; content: string | any[] }>,
): Promise<{ summary: string; recentMessages: Array<{ role: string; content: string }> }> {
  return compress(gateway, model, { messages });
}

function normalizeEndpoint(url: string): string {
  let normalized = url.trim().replace(/\/+$/, '');
  if (normalized.endsWith('/chat/completions')) return normalized;
  if (normalized.endsWith('/v1')) return normalized + '/chat/completions';
  return normalized + '/v1/chat/completions';
}
