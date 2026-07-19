// ============================================================================
// Infer / extract model context window for settings auto-fill
// ============================================================================

export type ContextSource = 'api' | 'inferred' | 'unknown';

export interface DiscoveredModel {
  id: string;
  /** Best-known context window in tokens */
  contextWindow?: number;
  source: ContextSource;
}

/**
 * Pull context length from a single provider model object (OpenAI-compat / OpenRouter / Ollama).
 */
export function extractContextFromApiModel(raw: Record<string, any>): number | undefined {
  if (!raw || typeof raw !== 'object') return undefined;

  const candidates: unknown[] = [
    raw.context_length,
    raw.context_window,
    raw.max_model_len,
    raw.max_tokens, // some gateways misuse this for context — only accept if large enough
    raw.max_seq_len,
    raw.n_ctx,
    raw.contextLength,
    raw.contextWindow,
    // nested
    raw.top_provider?.context_length,
    raw.architecture?.context_length,
    raw.meta?.context_length,
    raw.limits?.max_context_tokens,
    raw.limits?.context_window,
    // Ollama show/tags details
    raw.details?.context_length,
    raw.model_info?.['llama.context_length'],
    raw.model_info?.['general.context_length'],
    raw.parameters?.num_ctx,
  ];

  // Ollama model_info may use many keys ending in context_length
  if (raw.model_info && typeof raw.model_info === 'object') {
    for (const [k, v] of Object.entries(raw.model_info)) {
      if (/context_length|num_ctx|ctx_len/i.test(k)) candidates.push(v);
    }
  }

  for (const c of candidates) {
    const n = normalizeContextTokens(c);
    if (n != null) return n;
  }

  // String parameters like "num_ctx 8192" in Ollama PARAMETER block
  if (typeof raw.parameters === 'string') {
    const m = raw.parameters.match(/num_ctx\s+(\d+)/i);
    if (m) {
      const n = normalizeContextTokens(m[1]);
      if (n != null) return n;
    }
  }

  return undefined;
}

/** Accept reasonable context sizes (2k–10M). Reject tiny "max_tokens" output caps. */
export function normalizeContextTokens(v: unknown): number | undefined {
  let n: number | undefined;
  if (typeof v === 'number' && Number.isFinite(v)) n = Math.round(v);
  else if (typeof v === 'string' && v.trim()) {
    const s = v.trim().toLowerCase();
    // "128k", "200K", "1m"
    const km = s.match(/^(\d+(?:\.\d+)?)\s*([km])$/i);
    if (km) {
      const base = parseFloat(km[1]);
      n = Math.round(base * (km[2].toLowerCase() === 'm' ? 1_000_000 : 1_000));
    } else if (/^\d+$/.test(s)) {
      n = parseInt(s, 10);
    }
  }
  if (n == null || !Number.isFinite(n)) return undefined;
  // Ignore output-sized values mistakenly reported as context
  if (n < 2_048) return undefined;
  if (n > 10_000_000) return undefined;
  return n;
}

/**
 * Heuristic from model id + endpoint when the API does not report context.
 * Mirrors server resolveCaps families (kept independent so discover can stay light).
 */
export function inferContextWindowFromId(
  modelId: string,
  endpoint = '',
): number | undefined {
  const m = (modelId || '').toLowerCase();
  const ep = (endpoint || '').toLowerCase();
  if (!m && !ep) return undefined;

  // Explicit size in name: 128k, 32k, 1m, 200000
  const named =
    m.match(/(?:^|[-_./])(\d{1,3})\s*k(?:[-_./]|$)/i) ||
    m.match(/(\d{1,3})k\b/i);
  if (named) {
    const k = parseInt(named[1], 10);
    if (k >= 4 && k <= 2000) return k * 1000;
  }
  const namedM = m.match(/(?:^|[-_./])(\d+(?:\.\d+)?)\s*m(?:[-_./]|$)/i);
  if (namedM) {
    const mil = parseFloat(namedM[1]);
    if (mil > 0 && mil <= 10) return Math.round(mil * 1_000_000);
  }

  if (/^o[1-9]/.test(m) || m.includes('o1-') || m.includes('o3-') || m.includes('o4-')
    || m.includes('gpt-5') || m.includes('gpt-4.1')) {
    return m.includes('mini') ? 128_000 : 200_000;
  }
  if (m.includes('deepseek') || ep.includes('deepseek')) return 64_000;
  if (m.includes('claude') || ep.includes('anthropic')) return 200_000;
  if (m.includes('gemini')) {
    if (m.includes('pro') || m.includes('1.5') || m.includes('2.0') || m.includes('2.5')) {
      return m.includes('flash') ? 1_000_000 : 1_000_000;
    }
    return 128_000;
  }
  if (m.includes('gpt-4o') || m.includes('gpt-4.1') || m.includes('chatgpt-4o')) return 128_000;
  if (m.includes('gpt-4-turbo') || m.includes('gpt-4-1106') || m.includes('gpt-4-0125')) return 128_000;
  if (m.includes('gpt-4') || m.includes('gpt-3.5')) return m.includes('32k') ? 32_000 : 16_000;
  if (m.includes('qwen') || ep.includes('dashscope')) {
    if (m.includes('long') || m.includes('turbo') || m.includes('plus') || m.includes('max')) return 128_000;
    return 32_000;
  }
  if (m.includes('moonshot') || m.includes('kimi')) {
    if (m.includes('128') || m.includes('k2')) return 128_000;
    return 32_000;
  }
  if (m.includes('glm') || ep.includes('bigmodel')) return 128_000;
  if (m.includes('doubao') || ep.includes('volces') || ep.includes('volcengine')) return 128_000;
  if (m.includes('minimax') || m.includes('abab')) return 245_000;
  if (m.includes('mimo')) return 128_000;
  if (m.includes('yi-') || ep.includes('lingyiwanwu')) return 16_000;
  if (m.includes('baichuan')) return 32_000;
  if (m.includes('step-') || ep.includes('stepfun')) return 32_000;
  if (m.includes('gemma') || m.includes('phi-') || m.includes('tinyllama')) return 8_000;
  if (m.includes('llama-3.1') || m.includes('llama3.1') || m.includes('llama-3.2')) return 128_000;
  if (m.includes('llama-3') || m.includes('llama3')) return 8_000;
  if (m.includes('mistral') || m.includes('mixtral')) return 32_000;
  if (ep.includes('siliconflow') || ep.includes('together.xyz')) return 32_000;
  if (ep.includes('11434') || ep.includes('/api/chat') || ep.includes('ollama')) return 32_000;
  if (ep.includes('openrouter')) return 128_000;

  return undefined;
}

/**
 * Parse a /models or Ollama /api/tags JSON body into discovered models with context.
 */
export function parseModelsListResponse(
  data: any,
  endpointHint = '',
): DiscoveredModel[] {
  const out: DiscoveredModel[] = [];
  const seen = new Set<string>();

  const push = (id: string, raw?: Record<string, any>) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    const fromApi = raw ? extractContextFromApiModel(raw) : undefined;
    const inferred = inferContextWindowFromId(id, endpointHint);
    if (fromApi != null) {
      out.push({ id, contextWindow: fromApi, source: 'api' });
    } else if (inferred != null) {
      out.push({ id, contextWindow: inferred, source: 'inferred' });
    } else {
      out.push({ id, source: 'unknown' });
    }
  };

  if (!data) return out;

  // OpenAI / OpenRouter: { data: [ { id, ... } ] }
  if (Array.isArray(data.data)) {
    for (const m of data.data) {
      if (!m) continue;
      const id = m.id || m.name;
      if (typeof id === 'string') push(id, m);
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  // Ollama tags: { models: [ { name, details, ... } ] }
  if (Array.isArray(data.models)) {
    for (const m of data.models) {
      if (!m) continue;
      const id = m.name || m.model || m.id;
      if (typeof id === 'string') push(id, m);
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  // Bare array
  if (Array.isArray(data)) {
    for (const m of data) {
      if (typeof m === 'string') push(m);
      else if (m && typeof m === 'object') {
        const id = m.id || m.name;
        if (typeof id === 'string') push(id, m);
      }
    }
  }

  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function formatContextLabel(n?: number): string {
  if (n == null || n <= 0) return '';
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return Number.isInteger(m) ? `${m}M` : `${m.toFixed(1)}M`;
  }
  if (n >= 1000) {
    const k = n / 1000;
    return Number.isInteger(k) ? `${k}k` : `${k.toFixed(1)}k`;
  }
  return String(n);
}
