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
 * Fold system messages into system string(s) + remaining messages
 * for Anthropic, or fold into first user if model lacks system role.
 *
 * Multiple leading system messages are preserved as ordered blocks so
 * static prefix (tools + first system) can stay cache-stable while a
 * second dynamic system (summary) changes.
 */
export function adaptMessagesForModel(
  messages: Record<string, any>[],
  model: ModelConfig,
): {
  system?: string;
  /** Ordered system blocks (static first, dynamic next) for cache breakpoints */
  systemBlocks?: string[];
  messages: Record<string, any>[];
} {
  const caps = resolveModelCaps(model);
  const systemParts: string[] = [];
  let rest = [...messages];

  // Extract system (preserve order — first block is treated as static/cacheable)
  rest = rest.filter(m => {
    if (m.role === 'system') {
      const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      if (c.trim()) systemParts.push(c);
      return false;
    }
    return true;
  });

  const system = systemParts.join('\n\n') || undefined;
  const systemBlocks = systemParts.length ? systemParts : undefined;

  if (caps.apiStyle === 'anthropic') {
    // Anthropic wants system separate; messages only user/assistant/tool
    return { system, systemBlocks, messages: convertToAnthropicMessages(rest) };
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
    // Keep separate system messages when multiple blocks exist so OpenAI-compatible
    // prefix caches can share the first system message across turns.
    if (systemParts.length > 1) {
      return {
        system,
        systemBlocks,
        messages: [
          ...systemParts.map(content => ({ role: 'system' as const, content })),
          ...rest,
        ],
      };
    }
    return { system, systemBlocks, messages: [{ role: 'system', content: system }, ...rest] };
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
 * Apply enable/disable deep-thinking for multi-vendor APIs.
 * enableThinking=false tries to turn off CoT where the provider supports it.
 */
export function applyThinkingPreference(
  body: Record<string, any>,
  model: ModelConfig,
  enableThinking: boolean | undefined,
  apiStyle: 'openai' | 'ollama' | 'anthropic',
): void {
  // undefined → leave provider default
  if (enableThinking === undefined) return;

  const m = (model.model || '').toLowerCase();
  const ep = (model.endpoint || '').toLowerCase();

  if (enableThinking) {
    // Explicitly enable where APIs have a toggle (hybrid chat/reasoner models).
    // Do NOT force extra flags on pure reasoners (deepseek-reasoner / r1) — they
    // already stream reasoning_content; extra body keys can break some gateways.
    const pureReasoner =
      m.includes('reasoner') ||
      m.includes('deepseek-r1') ||
      /(^|[-_/])r1([-_/]|$)/.test(m) ||
      /^o[1-9]/.test(m) ||
      m.includes('o1-') ||
      m.includes('o3-') ||
      m.includes('o4-');

    if (apiStyle === 'anthropic') {
      // Only set if user explicitly wants thinking — keep mild budget
      if (!body.thinking) {
        body.thinking = { type: 'enabled', budget_tokens: 8000 };
      }
      return;
    }
    if (pureReasoner) {
      return;
    }
    if (m.includes('deepseek') || ep.includes('deepseek')) {
      // Hybrid deepseek-chat: optional thinking block
      body.thinking = { type: 'enabled' };
      return;
    }
    if (m.includes('qwen') || ep.includes('dashscope') || ep.includes('aliyuncs')) {
      body.enable_thinking = true;
      return;
    }
    if (m.includes('glm') || ep.includes('bigmodel')) {
      body.thinking = { type: 'enabled' };
      return;
    }
    if (m.includes('kimi') || m.includes('moonshot') || ep.includes('moonshot')) {
      body.enable_thinking = true;
      return;
    }
    if (m.includes('doubao') || ep.includes('volces') || ep.includes('volcengine')) {
      body.thinking = { type: 'enabled' };
      return;
    }
    // o-series already handled as pureReasoner; leave other models default
    return;
  }

  // ── Disable thinking ──────────────────────────────────────────────
  // Pure reasoners cannot turn CoT off — don't send flags that some gateways
  // reject (empty stream / 400). UI will hide CoT and promote to reply.
  const pureReasonerOff =
    m.includes('reasoner') ||
    m.includes('deepseek-r1') ||
    /(^|[-_/])r1([-_/]|$)/.test(m) ||
    /^o[1-9]/.test(m) ||
    m.includes('o1-') ||
    m.includes('o3-') ||
    m.includes('o4-') ||
    m.includes('gpt-5');

  if (apiStyle === 'anthropic') {
    delete body.thinking;
    return;
  }

  if (apiStyle === 'ollama') {
    return;
  }

  if (pureReasonerOff) {
    // o-series: lowest effort when supported; r1/reasoner: leave body clean
    if (/^o[1-9]/.test(m) || m.includes('o1-') || m.includes('o3-') || m.includes('o4-') || m.includes('gpt-5')) {
      body.reasoning_effort = 'low';
    }
    return;
  }

  // DeepSeek chat hybrids
  if (m.includes('deepseek') || ep.includes('deepseek')) {
    body.thinking = { type: 'disabled' };
    return;
  }

  // Qwen / DashScope OpenAI-compat
  if (m.includes('qwen') || ep.includes('dashscope') || ep.includes('aliyuncs')) {
    body.enable_thinking = false;
    return;
  }

  // Zhipu GLM
  if (m.includes('glm') || ep.includes('bigmodel') || ep.includes('zhipu')) {
    body.thinking = { type: 'disabled' };
    return;
  }

  // Kimi / Moonshot
  if (m.includes('kimi') || m.includes('moonshot') || ep.includes('moonshot')) {
    body.enable_thinking = false;
    return;
  }

  // Doubao / Volcengine
  if (m.includes('doubao') || ep.includes('volces') || ep.includes('volcengine')) {
    body.thinking = { type: 'disabled' };
    return;
  }

  // Generic OpenAI-compat: only one soft flag (avoid stacking incompatible keys)
  body.enable_thinking = false;
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
    /** false = ask provider to skip deep thinking / CoT */
    enableThinking?: boolean;
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
    // Prompt-cache breakpoints: mark static system (first block) + last tool as ephemeral
    const blocks = adapted.systemBlocks?.filter(Boolean) ?? (adapted.system ? [adapted.system] : []);
    if (blocks.length === 1) {
      body.system = [
        {
          type: 'text',
          text: blocks[0],
          cache_control: { type: 'ephemeral' },
        },
      ];
    } else if (blocks.length > 1) {
      body.system = blocks.map((text, i) => ({
        type: 'text',
        text,
        // Cache static prefix; dynamic summary block stays uncached so it can change cheaply
        ...(i === 0 ? { cache_control: { type: 'ephemeral' as const } } : {}),
      }));
    }
    if (caps.supportsTemperature && caps.reasoningMode === 'none') {
      body.temperature = model.temperature;
    }
    if (model.topP != null) body.top_p = model.topP;
    if (model.topK != null) body.top_k = model.topK;
    if (model.stopSequences?.length) body.stop_sequences = model.stopSequences;

    if (params.tools?.length && caps.supportsTools) {
      body.tools = params.tools.map((t, i, arr) => {
        const tool: Record<string, unknown> = {
          name: t.function.name,
          description: t.function.description,
          input_schema: t.function.parameters || { type: 'object', properties: {} },
        };
        // Last tool carries cache_control so the whole tools array is a cache prefix
        if (i === arr.length - 1) {
          tool.cache_control = { type: 'ephemeral' };
        }
        return tool;
      });
    }

    applyThinkingPreference(body, model, params.enableThinking, 'anthropic');

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

  // Ask OpenAI-compatible gateways to emit usage (incl. cached tokens) on the stream
  if (stream) {
    body.stream_options = { include_usage: true };
  }

  // Output token limit — pure reasoners with tiny max_tokens often burn the
  // whole budget on CoT and never emit content. Soft floor only when too low.
  let outTokens = model.maxTokens || 4096;
  if (
    params.enableThinking !== false &&
    caps.reasoningMode === 'enabled' &&
    outTokens > 0 &&
    outTokens < 2048
  ) {
    outTokens = 2048;
  }
  if (caps.tokenParam === 'max_tokens') {
    body.max_tokens = outTokens;
  } else if (caps.tokenParam === 'max_completion_tokens') {
    body.max_completion_tokens = outTokens;
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

  applyThinkingPreference(body, model, params.enableThinking, 'openai');

  // When thinking is off, allow temperature again for hybrid models
  if (params.enableThinking === false && model.supportsTemperature !== false) {
    if (body.temperature === undefined && model.temperature != null) {
      body.temperature = model.temperature;
    }
  }

  if (model.extraBody) Object.assign(body, model.extraBody);

  return { url, headers, body, apiStyle: 'openai' };
}
