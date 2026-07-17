// ============================================================================
// Build provider-specific HTTP request (headers + body) from ModelConfig
// ============================================================================

import type { ModelConfig } from './modelTypes.js';
import { resolveModelCaps } from './resolveCaps.js';

export interface BuiltRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  apiStyle: 'openai' | 'ollama' | 'anthropic';
}

/**
 * Normalize chat-completions URL (shared with frontend rules).
 */
export function normalizeEndpoint(url: string): string {
  let normalized = url.trim().replace(/\/+$/, '');
  if (normalized.endsWith('/chat/completions')) return normalized;
  if (normalized.endsWith('/v1')) return normalized + '/chat/completions';
  try {
    const parsed = new URL(normalized);
    const p = parsed.pathname.replace(/\/+$/, '');
    if (/\/openai$/i.test(p)) return normalized + '/chat/completions';
    if (/^\/v\d+\w*$/.test(p)) return normalized + '/openai/chat/completions';
    if (/^\/v\d+\w*\/openai/.test(p)) return normalized + '/chat/completions';
    // Complete Ollama / Anthropic paths
    if (/\/(generate|chat|tags|messages)$/.test(p)) return normalized;
    // Already versioned API base (e.g. /api/paas/v4, /compatible-mode/v1) → only /chat/completions
    if (p !== '' && p !== '/' && /\/v\d+/.test(p)) {
      return normalized + '/chat/completions';
    }
  } catch { /* fall through */ }
  return normalized + '/v1/chat/completions';
}

function anthropicMessagesUrl(endpoint: string): string {
  let base = endpoint.trim().replace(/\/+$/, '');
  if (base.endsWith('/v1/messages')) return base;
  if (base.endsWith('/v1')) return base + '/messages';
  if (base.endsWith('/messages')) return base;
  return base.replace(/\/v1\/chat\/completions$/, '/v1') + '/v1/messages';
}

/**
 * Fold system messages into a single system string + remaining messages
 * for Anthropic, or fold into first user if model lacks system role.
 */
export function adaptMessagesForModel(
  messages: Record<string, any>[],
  model: ModelConfig,
): { system?: string; messages: Record<string, any>[] } {
  const caps = resolveModelCaps(model);
  const systemParts: string[] = [];
  let rest = [...messages];

  // Extract system
  rest = rest.filter(m => {
    if (m.role === 'system') {
      const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      if (c.trim()) systemParts.push(c);
      return false;
    }
    return true;
  });

  const system = systemParts.join('\n\n') || undefined;

  if (caps.apiStyle === 'anthropic') {
    // Anthropic wants system separate; messages only user/assistant/tool
    return { system, messages: convertToAnthropicMessages(rest) };
  }

  if (!caps.supportsSystemRole && system) {
    // Fold system into first user message
    const firstUserIdx = rest.findIndex(m => m.role === 'user');
    if (firstUserIdx >= 0) {
      const u = rest[firstUserIdx];
      if (typeof u.content === 'string') {
        rest[firstUserIdx] = {
          ...u,
          content: `[System instructions]\n${system}\n\n[User]\n${u.content}`,
        };
      } else if (Array.isArray(u.content)) {
        rest[firstUserIdx] = {
          ...u,
          content: [
            { type: 'text', text: `[System instructions]\n${system}` },
            ...u.content,
          ],
        };
      }
    } else {
      rest.unshift({ role: 'user', content: system });
    }
    return { messages: rest };
  }

  if (system) {
    return { messages: [{ role: 'system', content: system }, ...rest] };
  }
  return { messages: rest };
}

function convertToAnthropicMessages(messages: Record<string, any>[]): Record<string, any>[] {
  const out: Record<string, any>[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      out.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: m.tool_call_id,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        }],
      });
      continue;
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const content: any[] = [];
      if (m.content && typeof m.content === 'string' && m.content.trim()) {
        content.push({ type: 'text', text: m.content });
      }
      for (const tc of m.tool_calls) {
        let input = {};
        try {
          input = typeof tc.function?.arguments === 'string'
            ? JSON.parse(tc.function.arguments || '{}')
            : (tc.function?.arguments || {});
        } catch { input = {}; }
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function?.name || tc.name,
          input,
        });
      }
      out.push({ role: 'assistant', content });
      continue;
    }
    // Multimodal
    if (Array.isArray(m.content)) {
      const content = m.content.map((block: any) => {
        if (block.type === 'image_url') {
          const url = block.image_url?.url || '';
          const match = url.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            return {
              type: 'image',
              source: { type: 'base64', media_type: match[1], data: match[2] },
            };
          }
          return { type: 'text', text: `[image: ${url.slice(0, 80)}]` };
        }
        return { type: 'text', text: block.text || '' };
      });
      out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content });
      continue;
    }
    out.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    });
  }
  return out;
}

/**
 * Build fetch-ready request for the model.
 */
export function buildCompletionRequest(
  model: ModelConfig,
  params: {
    messages: Record<string, any>[];
    tools?: Array<{ type: 'function'; function: any }>;
    stream?: boolean;
  },
): BuiltRequest {
  const caps = resolveModelCaps(model);
  const stream = params.stream !== false;
  const adapted = adaptMessagesForModel(params.messages, model);

  // ── Ollama ────────────────────────────────────────────────────────
  if (caps.apiStyle === 'ollama') {
    const messages = adapted.messages.map(m => {
      if (Array.isArray(m.content)) {
        const textParts: string[] = [];
        const images: string[] = [];
        for (const block of m.content) {
          if (block.type === 'text' && block.text) textParts.push(block.text);
          else if (block.type === 'image_url' && block.image_url?.url) {
            const url = block.image_url.url;
            const idx = url.indexOf(';base64,');
            images.push(idx >= 0 ? url.slice(idx + 8) : url);
          }
        }
        return { role: m.role, content: textParts.join('\n'), images };
      }
      return m;
    });
    // Prepend system as first message if present
    if (adapted.system) {
      messages.unshift({ role: 'system', content: adapted.system });
    }
    return {
      url: model.endpoint,
      headers: { 'Content-Type': 'application/json' },
      apiStyle: 'ollama',
      body: {
        model: model.model,
        messages,
        stream,
        options: {
          num_predict: model.maxTokens,
          ...(caps.supportsTemperature ? { temperature: model.temperature } : {}),
          ...(model.topP != null ? { top_p: model.topP } : {}),
          ...(model.topK != null ? { top_k: model.topK } : {}),
          ...(model.seed != null ? { seed: model.seed } : {}),
        },
      },
    };
  }

  // ── Anthropic Messages API ────────────────────────────────────────
  if (caps.apiStyle === 'anthropic') {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...model.extraHeaders,
    };
    if (model.apiKey) {
      if (caps.authStyle === 'anthropic-x-api-key' || !caps.authStyle) {
        headers['x-api-key'] = model.apiKey;
      } else {
        headers['Authorization'] = `Bearer ${model.apiKey}`;
      }
    }

    const body: Record<string, any> = {
      model: model.model,
      messages: adapted.messages,
      max_tokens: model.maxTokens || 4096,
      stream,
    };
    if (adapted.system) body.system = adapted.system;
    if (caps.supportsTemperature && caps.reasoningMode === 'none') {
      body.temperature = model.temperature;
    }
    if (model.topP != null) body.top_p = model.topP;
    if (model.topK != null) body.top_k = model.topK;
    if (model.stopSequences?.length) body.stop_sequences = model.stopSequences;

    if (params.tools?.length && caps.supportsTools) {
      body.tools = params.tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters || { type: 'object', properties: {} },
      }));
    }

    if (model.extraBody) Object.assign(body, model.extraBody);

    return {
      url: anthropicMessagesUrl(model.endpoint),
      headers,
      body,
      apiStyle: 'anthropic',
    };
  }

  // ── OpenAI-compatible (covers most CN + global providers) ─────────
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...model.extraHeaders,
  };

  if (model.apiKey && caps.authStyle !== 'none') {
    if (caps.authStyle === 'query') {
      // rare; attach later
    } else {
      headers['Authorization'] = `Bearer ${model.apiKey}`;
    }
  }

  // OpenRouter best practice
  if (model.endpoint.includes('openrouter.ai') && !headers['HTTP-Referer']) {
    headers['HTTP-Referer'] = 'https://github.com/openchat';
    headers['X-Title'] = 'OpenChat';
  }

  let url = normalizeEndpoint(model.endpoint);
  if (caps.authStyle === 'query' && model.apiKey) {
    const sep = url.includes('?') ? '&' : '?';
    url = `${url}${sep}key=${encodeURIComponent(model.apiKey)}`;
  }

  const body: Record<string, any> = {
    model: model.model,
    messages: adapted.messages,
    stream,
  };

  // Output token limit
  if (caps.tokenParam === 'max_tokens') {
    body.max_tokens = model.maxTokens;
  } else if (caps.tokenParam === 'max_completion_tokens') {
    body.max_completion_tokens = model.maxTokens;
  }

  // Temperature (skip for pure reasoning models)
  if (caps.supportsTemperature && caps.reasoningMode !== 'enabled') {
    body.temperature = model.temperature;
  }

  if (model.topP != null) body.top_p = model.topP;
  if (model.frequencyPenalty != null) body.frequency_penalty = model.frequencyPenalty;
  if (model.presencePenalty != null) body.presence_penalty = model.presencePenalty;
  if (model.stopSequences?.length) body.stop = model.stopSequences;
  if (model.seed != null) body.seed = model.seed;

  if (params.tools?.length && caps.supportsTools) {
    body.tools = params.tools;
    body.tool_choice = 'auto';
    if (caps.supportsParallelToolCalls === false) {
      body.parallel_tool_calls = false;
    }
  }

  if (model.extraBody) Object.assign(body, model.extraBody);

  return { url, headers, body, apiStyle: 'openai' };
}
