// ============================================================================
// Session-level prompt cache state — append-only LLM transcript per chat session
//
// Goal: across user turns (not only tool rounds), keep tools + static system +
// prior messages byte-stable so provider prompt caches hit and save money.
// ============================================================================

export interface TokenUsageSnapshot {
  promptTokens: number;
  completionTokens: number;
  /** Tokens served from provider prompt cache (read) */
  cachedTokens: number;
  /** Tokens written into cache this request (Anthropic cache creation, etc.) */
  cacheWriteTokens: number;
}

export interface PromptCacheState {
  /** Client conversation session id (ses_…) */
  sessionKey: string;
  /** model.id|endpoint|model.model — invalidate on switch */
  modelKey: string;
  /** Sticky thinking flag; changing it rebuilds system */
  thinkingKey: 'on' | 'off';
  /** Frozen static system parts (agent core, env, memory, skills) */
  systemParts: string[];
  dynamicNotes: string[];
  priorSummary?: string;
  /** Frozen tool defs for this session */
  toolDefs: Array<{ type: 'function'; function: any }>;
  /**
   * Exact messages last sent / extended for the provider (system + history).
   * Append-only except on emergency re-pack / compress / model switch.
   */
  llmMessages: Record<string, any>[];
  /** How many client user messages were accounted for */
  clientUserCount: number;
  createdAt: number;
  updatedAt: number;
  /** Cumulative usage for UI (optional) */
  totalUsage: TokenUsageSnapshot;
}

function emptyUsage(): TokenUsageSnapshot {
  return { promptTokens: 0, completionTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 };
}

export function addUsage(a: TokenUsageSnapshot, b: Partial<TokenUsageSnapshot>): TokenUsageSnapshot {
  return {
    promptTokens: a.promptTokens + (b.promptTokens ?? 0),
    completionTokens: a.completionTokens + (b.completionTokens ?? 0),
    cachedTokens: a.cachedTokens + (b.cachedTokens ?? 0),
    cacheWriteTokens: a.cacheWriteTokens + (b.cacheWriteTokens ?? 0),
  };
}

export function modelCacheKey(model: {
  id: string;
  endpoint: string;
  model: string;
}): string {
  return `${model.id}|${model.endpoint}|${model.model}`;
}

/** In-memory store (per server process). Keyed by conversation session id. */
export class PromptCacheStore {
  private map = new Map<string, PromptCacheState>();
  /** Drop idle sessions after this many ms (default 6h) */
  private maxAgeMs: number;

  constructor(maxAgeMs = 6 * 60 * 60 * 1000) {
    this.maxAgeMs = maxAgeMs;
  }

  get(sessionKey: string): PromptCacheState | undefined {
    if (!sessionKey) return undefined;
    const s = this.map.get(sessionKey);
    if (!s) return undefined;
    if (Date.now() - s.updatedAt > this.maxAgeMs) {
      this.map.delete(sessionKey);
      return undefined;
    }
    return s;
  }

  set(state: PromptCacheState): void {
    state.updatedAt = Date.now();
    this.map.set(state.sessionKey, state);
  }

  delete(sessionKey: string): void {
    this.map.delete(sessionKey);
  }

  clear(): void {
    this.map.clear();
  }

  createFresh(opts: {
    sessionKey: string;
    modelKey: string;
    thinkingKey: 'on' | 'off';
    systemParts: string[];
    dynamicNotes: string[];
    priorSummary?: string;
    toolDefs: PromptCacheState['toolDefs'];
    llmMessages: Record<string, any>[];
    clientUserCount: number;
  }): PromptCacheState {
    const now = Date.now();
    return {
      sessionKey: opts.sessionKey,
      modelKey: opts.modelKey,
      thinkingKey: opts.thinkingKey,
      systemParts: opts.systemParts,
      dynamicNotes: opts.dynamicNotes,
      priorSummary: opts.priorSummary,
      toolDefs: opts.toolDefs,
      llmMessages: opts.llmMessages,
      clientUserCount: opts.clientUserCount,
      createdAt: now,
      updatedAt: now,
      totalUsage: emptyUsage(),
    };
  }
}

/** Shared process-wide store */
export const promptCacheStore = new PromptCacheStore();

/**
 * Pull the latest user turn (+ immediately preceding system notes) from client history.
 * Used for append-only session turns so we never re-send rewritten older history.
 */
export function extractLatestTurn(messages: Array<{ role: string; content?: string; attachments?: unknown[] }>): typeof messages {
  if (!messages.length) return [];
  // Find last user message
  let userIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      userIdx = i;
      break;
    }
  }
  if (userIdx < 0) return [];

  // Include contiguous system notes immediately before that user (e.g. web search)
  let start = userIdx;
  for (let k = userIdx - 1; k >= 0; k--) {
    if (messages[k].role === 'system') start = k;
    else break;
  }
  return messages.slice(start, userIdx + 1);
}

export function countUserMessages(messages: Array<{ role: string }>): number {
  return messages.filter(m => m.role === 'user').length;
}

/**
 * Parse provider usage objects (OpenAI / DeepSeek / Anthropic / OpenRouter shapes).
 */
export function parseProviderUsage(raw: unknown): Partial<TokenUsageSnapshot> | null {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Record<string, any>;
  const promptTokens =
    num(u.prompt_tokens) ??
    num(u.input_tokens) ??
    num(u.promptTokens) ??
    0;
  const completionTokens =
    num(u.completion_tokens) ??
    num(u.output_tokens) ??
    num(u.completionTokens) ??
    0;

  // Nested OpenAI-style details
  const details = u.prompt_tokens_details || u.input_tokens_details || {};
  let cachedTokens =
    num(u.prompt_cache_hit_tokens) ??
    num(u.cache_read_input_tokens) ??
    num(u.cached_tokens) ??
    num(details.cached_tokens) ??
    num(details.cache_read_tokens) ??
    0;

  let cacheWriteTokens =
    num(u.prompt_cache_miss_tokens) ?? // DeepSeek miss is not always "write"
    num(u.cache_creation_input_tokens) ??
    num(details.cache_write_tokens) ??
    0;

  // Some gateways only report cache_read under usage at top level after stream
  if (!cachedTokens && num(u.cache_read_input_tokens) != null) {
    cachedTokens = num(u.cache_read_input_tokens)!;
  }
  if (!cacheWriteTokens && num(u.cache_creation_input_tokens) != null) {
    cacheWriteTokens = num(u.cache_creation_input_tokens)!;
  }

  if (!promptTokens && !completionTokens && !cachedTokens && !cacheWriteTokens) {
    return null;
  }
  return { promptTokens, completionTokens, cachedTokens, cacheWriteTokens };
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

export function cacheHitRate(usage: TokenUsageSnapshot): number | undefined {
  const denom = usage.promptTokens || usage.cachedTokens + usage.cacheWriteTokens;
  if (!denom || denom <= 0) return undefined;
  // Prefer promptTokens as denominator when present
  const base = usage.promptTokens > 0 ? usage.promptTokens : denom;
  return Math.min(1, usage.cachedTokens / base);
}
