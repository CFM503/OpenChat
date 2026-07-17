// ============================================================================
// Model configuration — multi-provider dialects & request parameters
// Shared shape for config persistence and request adapters
// ============================================================================

/** Wire protocol / message dialect */
export type ApiStyle = 'openai' | 'ollama' | 'anthropic';

/** How the max-output field is named in the JSON body */
export type TokenParamStyle =
  | 'max_tokens'              // classic OpenAI / most CN OpenAI-compat
  | 'max_completion_tokens'   // o1/o3/gpt-5 family
  | 'num_predict'             // Ollama (handled in options)
  | 'none';                   // omit (provider decides)

/** How aggressively we shrink history before each call */
export type ContextStrategy = 'full' | 'balanced' | 'minimal';

export type ModelProvider = 'openai' | 'ollama' | 'custom';

/**
 * Full model route config. Older configs without new fields still work —
 * adapters infer sensible defaults from model id / endpoint.
 */
export interface ModelConfig {
  id: string;
  name: string;
  provider: ModelProvider;
  endpoint: string;
  apiKey?: string;
  model: string;
  /** Max output tokens (legacy field name kept for compatibility) */
  maxTokens: number;
  temperature: number;
  isDefault: boolean;
  disableTools?: boolean;
  /** @deprecated prefer tokenParam; true ≈ max_tokens, false ≈ none */
  useMaxTokens?: boolean;

  // ── Dialect & capability ──────────────────────────────────────────
  /** openai | ollama | anthropic (Messages API) */
  apiStyle?: ApiStyle;
  /** Context window size (input+output budget), default inferred */
  contextWindow?: number;
  tokenParam?: TokenParamStyle;
  supportsTemperature?: boolean;
  supportsTools?: boolean;
  supportsParallelToolCalls?: boolean;
  /** If false, fold system into first user message */
  supportsSystemRole?: boolean;
  supportsVision?: boolean;
  /** Reasoning models: don't send temperature; parse reasoning fields */
  reasoningMode?: 'none' | 'enabled' | 'auto';
  /** Require strict user/assistant alternation (Gemma, some small models) */
  strictAlternation?: boolean;
  /** Max history messages before hard prune (legacy soft limit) */
  maxHistoryMessages?: number;

  // ── Sampling extras ───────────────────────────────────────────────
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
  seed?: number;

  // ── Wire escape hatches ───────────────────────────────────────────
  /** Extra HTTP headers (OpenRouter referer, Anthropic version, etc.) */
  extraHeaders?: Record<string, string>;
  /** Merged into request body last (advanced) */
  extraBody?: Record<string, unknown>;
  /** Auth header style: bearer (default) | anthropic-x-api-key | query-key | none */
  authStyle?: 'bearer' | 'anthropic-x-api-key' | 'query' | 'none';

  // ── Token-cost strategy ───────────────────────────────────────────
  contextStrategy?: ContextStrategy;
  /** Soft cap for conversation history (tokens). Default: 55% of contextWindow */
  historyTokenBudget?: number;
  /** Max chars per tool result kept in history */
  toolResultMaxChars?: number;
  /** When estimated usage exceeds this fraction of context, compress */
  compressionThreshold?: number;
  /** Max chars of project memory (OPENCHAT.md) injected */
  memoryMaxChars?: number;
  /** Skill catalog: full descriptions vs name-only */
  skillCatalogMode?: 'full' | 'names' | 'off';
}

export interface ResolvedModelCaps {
  apiStyle: ApiStyle;
  contextWindow: number;
  tokenParam: TokenParamStyle;
  supportsTemperature: boolean;
  supportsTools: boolean;
  supportsParallelToolCalls: boolean;
  supportsSystemRole: boolean;
  supportsVision: boolean;
  reasoningMode: 'none' | 'enabled' | 'auto';
  strictAlternation: boolean;
  contextStrategy: ContextStrategy;
  historyTokenBudget: number;
  toolResultMaxChars: number;
  compressionThreshold: number;
  memoryMaxChars: number;
  skillCatalogMode: 'full' | 'names' | 'off';
  maxHistoryMessages: number;
  authStyle: 'bearer' | 'anthropic-x-api-key' | 'query' | 'none';
}
