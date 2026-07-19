// ============================================================================
// Token-budget conversation packer — minimize prompt cost while keeping signal
//
// Algorithm (priority fill):
//   1. Always keep: short agent core + last user turn
//   2. Budget-cap: project memory, skill catalog (names vs full)
//   3. Keep newest turns first until history budget is exhausted
//   4. Collapse older turns into a compact summary stub (no LLM call here;
//      optional LLM compression is triggered separately when over threshold)
//   5. Truncate tool outputs to toolResultMaxChars
//   6. Drop empty / welcome / pure-thinking history noise
//
// Prompt-cache friendly layout (byte-stable prefix):
//   [system static]  systemParts only — never includes summary/drop stub
//   [system dynamic] priorSummary + dropStub (separate message; changes don't
//                    rewrite the static system string)
//   [history...]     newest-first fill; cache_max avoids mid-prefix churn
// ============================================================================

import type { ModelConfig, ResolvedModelCaps } from '../providers/modelTypes.js';
import { resolveModelCaps } from '../providers/resolveCaps.js';

export interface PackInput {
  messages: Record<string, any>[];
  /** Stable system blocks (agent core, env, memory, skills). Must not include rolling summary. */
  systemParts: string[];
  model: ModelConfig;
  /** Precomputed rolling summary of older history (optional) — placed in dynamic system msg */
  priorSummary?: string;
  /** Extra dynamic notes (client compress injects, etc.) — never mixed into static system */
  dynamicNotes?: string[];
  /**
   * When true, never rewrite message contents that already look truncated;
   * only truncate brand-new oversized tool results. Used for append-only re-entry.
   */
  writeOnceTools?: boolean;
}

export interface PackResult {
  messages: Record<string, any>[];
  /** Estimated tokens after packing */
  estimatedTokens: number;
  /** Whether caller should run LLM compression on dropped tail */
  needsLlmCompression: boolean;
  /** Human-readable debug stats */
  stats: {
    strategy: string;
    contextWindow: number;
    historyBudget: number;
    keptMessages: number;
    droppedMessages: number;
    truncatedTools: number;
    systemTokens: number;
    historyTokens: number;
  };
}

/** ~4 chars/token English; denser for CJK (~1.5–2). Use 2.5 as mixed heuristic. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Count CJK vs ascii roughly
  let cjk = 0;
  let other = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3040 && code <= 0x30ff)
    ) {
      cjk++;
    } else {
      other++;
    }
  }
  return Math.ceil(cjk / 1.5 + other / 4);
}

export function estimateMessageTokens(m: Record<string, any>): number {
  let n = 4; // role overhead
  if (typeof m.content === 'string') {
    n += estimateTokens(m.content);
  } else if (Array.isArray(m.content)) {
    for (const b of m.content) {
      if (b.text) n += estimateTokens(b.text);
      if (b.image_url) n += 300; // image token stub
    }
  }
  if (m.tool_calls) {
    n += estimateTokens(JSON.stringify(m.tool_calls));
  }
  return n;
}

function contentToString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(b => b.text || '').join('\n');
  }
  return content ? JSON.stringify(content) : '';
}

/**
 * Truncate oversized tool results in-place (returns count truncated).
 * When writeOnce is true, skip contents that already carry a truncation marker
 * so re-packing never mutates bytes that were already sent to the model.
 */
export function truncateToolResults(
  messages: Record<string, any>[],
  maxChars: number,
  writeOnce = false,
): number {
  let count = 0;
  for (const m of messages) {
    if (m.role !== 'tool') continue;
    if (typeof m.content !== 'string') continue;
    if (writeOnce && /\[tool output truncated|…\[truncated /.test(m.content)) {
      continue;
    }
    if (m.content.length > maxChars) {
      m.content =
        m.content.slice(0, maxChars) +
        `\n…[tool output truncated to ${maxChars} chars for token budget]`;
      count++;
    }
  }
  return count;
}

/**
 * Build skill catalog text under a character budget.
 * Entries should already be sorted by name for stable prompt cache prefixes.
 */
export function packSkillCatalog(
  entries: Array<{ shortcut: string; name: string; description: string; whenToUse?: string }>,
  mode: 'full' | 'names' | 'off',
  maxChars: number,
): string {
  if (mode === 'off' || entries.length === 0) return '';
  // Stable order for prompt-cache prefixes
  const sorted = entries.slice().sort((a, b) =>
    (a.shortcut || a.name).localeCompare(b.shortcut || b.name),
  );
  const lines = [
    '# Skills',
    mode === 'names'
      ? 'Use the `skill` tool with a name below when relevant.'
      : 'Use the `skill` tool when a description matches the task.',
    '',
  ];
  let used = lines.join('\n').length;
  for (const e of sorted) {
    const line =
      mode === 'names'
        ? `- ${e.shortcut}`
        : `- **${e.shortcut}**: ${e.description.slice(0, 120)}${e.whenToUse ? ` (${e.whenToUse.slice(0, 80)})` : ''}`;
    if (used + line.length + 1 > maxChars) {
      lines.push(`- …+${sorted.length - (lines.length - 3)} more (use skill tool)`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}

/**
 * Pack messages into a token budget for lowest cost / best cache hits.
 */
export function packConversation(input: PackInput): PackResult {
  const caps = resolveModelCaps(input.model);
  const cacheMax = caps.contextStrategy === 'cache_max';
  const historyBudget = caps.historyTokenBudget;
  // Reserve ~15% of context for model output + tools this turn (less for cache_max)
  const reserveFrac = cacheMax ? 0.10 : 0.15;
  const hardCap = Math.min(
    historyBudget,
    Math.floor(caps.contextWindow * (1 - reserveFrac)),
  );

  // ── Static system (never includes summary / drop stub) ────────────
  let staticSystem = input.systemParts.filter(Boolean).join('\n\n');
  if (staticSystem.length > caps.memoryMaxChars + 2000) {
    // Prefer keeping agent core (first part if ordered core-first) + truncated rest
    // systemParts layout from agentLoop: [core, env, memory, skills]
    const core = input.systemParts[0] || '';
    const rest = input.systemParts.slice(1).join('\n\n');
    const restBudget = Math.max(500, caps.memoryMaxChars);
    staticSystem =
      (core ? `${core}\n\n` : '') +
      (rest.length > restBudget
        ? rest.slice(0, restBudget) + '\n…[project memory truncated]'
        : rest);
  }

  // ── Dynamic system note (summary / omit stub) — separate message ──
  const dynamicBits: string[] = [];
  if (input.priorSummary?.trim()) {
    dynamicBits.push(`# Conversation summary (older turns)\n${input.priorSummary.trim()}`);
  }
  if (input.dynamicNotes?.length) {
    for (const note of input.dynamicNotes) {
      if (note?.trim()) dynamicBits.push(note.trim());
    }
  }

  const staticTokens = estimateTokens(staticSystem);
  const dynamicTokensEst = estimateTokens(dynamicBits.join('\n\n'));
  let remaining = hardCap - staticTokens - dynamicTokensEst;

  // ── Clean + truncate tools in a working copy ──────────────────────
  let working = input.messages
    .filter(m => {
      if (m.role === 'assistant' && typeof m.content === 'string' && m.content.includes('Welcome to **OpenChat**')) {
        return false;
      }
      return true;
    })
    .map(m => ({ ...m }));

  const truncatedTools = truncateToolResults(
    working,
    caps.toolResultMaxChars,
    !!input.writeOnceTools,
  );

  // ── Split: must-keep tail vs older ────────────────────────────────
  const maxMsgs = caps.maxHistoryMessages;
  const tail: Record<string, any>[] = [];
  const older: Record<string, any>[] = [];

  let turnBudget = maxMsgs;
  for (let i = working.length - 1; i >= 0; i--) {
    const m = working[i];
    if (tail.length >= turnBudget && m.role !== 'tool') {
      older.unshift(...working.slice(0, i + 1));
      break;
    }
    tail.unshift(m);
    if (m.role === 'user') turnBudget--;
  }

  // Fill from tail (newest first) into budget
  const keptRev: Record<string, any>[] = [];
  let historyTokens = 0;
  let dropped = 0;

  for (let i = tail.length - 1; i >= 0; i--) {
    const t = estimateMessageTokens(tail[i]);
    if (historyTokens + t > remaining && keptRev.length > 0) {
      const isLastUser =
        tail[i].role === 'user' &&
        !keptRev.some(k => k.role === 'user');
      if (!isLastUser) {
        dropped += i + 1;
        break;
      }
    }
    keptRev.push(tail[i]);
    historyTokens += t;
  }
  const kept = keptRev.reverse();

  dropped += older.length;

  // Compact stub for dropped older content — only as DYNAMIC system (not static)
  // cache_max / full: avoid noisy stubs that rewrite the dynamic prefix every pack
  let dropStub = '';
  if (dropped > 0 && caps.contextStrategy === 'balanced') {
    const sample = older
      .slice(-6)
      .map(m => {
        const c = contentToString(m.content).replace(/\s+/g, ' ').slice(0, 80);
        return `${m.role}: ${c}`;
      })
      .join(' | ');
    dropStub = `[${dropped} earlier messages omitted for token budget${sample ? `: ${sample}` : ''}]`;
  } else if (dropped > 0 && caps.contextStrategy === 'minimal') {
    // Short fixed-shape stub (no sample text) — more cache-friendly than varying samples
    dropStub = `[${dropped} earlier messages omitted for token budget]`;
  } else if (dropped > 0 && cacheMax) {
    // Fixed template only — count may change but no random sample churn
    dropStub = `[Context compacted: ${dropped} earlier messages omitted to protect prompt cache]`;
  }

  if (dropStub) dynamicBits.push(dropStub);
  const dynamicSystem = dynamicBits.filter(Boolean).join('\n\n');

  const packed: Record<string, any>[] = [];
  if (staticSystem.trim()) {
    packed.push({ role: 'system', content: staticSystem });
  }
  if (dynamicSystem.trim()) {
    packed.push({ role: 'system', content: dynamicSystem });
  }
  packed.push(...kept);

  // Strict alternation for fragile models
  const finalMsgs = caps.strictAlternation
    ? enforceAlternation(packed)
    : packed;

  const estimatedTokens =
    finalMsgs.reduce((s, m) => s + estimateMessageTokens(m), 0);

  // Suggest LLM compression if still high vs window
  // cache_max: only when truly near the window (avoid frequent summary rewrites)
  const needsLlmCompression = cacheMax
    ? estimatedTokens > caps.contextWindow * caps.compressionThreshold
    : estimatedTokens > caps.contextWindow * caps.compressionThreshold ||
      (dropped > 8 && caps.contextStrategy !== 'minimal');

  return {
    messages: finalMsgs,
    estimatedTokens,
    needsLlmCompression,
    stats: {
      strategy: caps.contextStrategy,
      contextWindow: caps.contextWindow,
      historyBudget: hardCap,
      keptMessages: kept.length,
      droppedMessages: dropped,
      truncatedTools,
      systemTokens: staticTokens + estimateTokens(dynamicSystem),
      historyTokens,
    },
  };
}

/** Merge consecutive same-role messages; ensure user/assistant pattern for small models */
function enforceAlternation(messages: Record<string, any>[]): Record<string, any>[] {
  const out: Record<string, any>[] = [];
  for (const m of messages) {
    if (m.role === 'tool' || m.role === 'system') {
      out.push(m);
      continue;
    }
    const last = out[out.length - 1];
    if (last && last.role === m.role && typeof last.content === 'string' && typeof m.content === 'string') {
      last.content += '\n\n' + m.content;
    } else {
      out.push({ ...m });
    }
  }
  // First non-system should be user
  const firstIdx = out.findIndex(m => m.role === 'user' || m.role === 'assistant');
  if (firstIdx >= 0 && out[firstIdx].role === 'assistant') {
    out.splice(firstIdx, 0, { role: 'user', content: 'Continue.' });
  }
  return out;
}

/**
 * Quick helper for agent loop logging.
 */
export function formatPackStats(stats: PackResult['stats']): string {
  return (
    `ctx=${stats.strategy} window=${stats.contextWindow} ` +
    `kept=${stats.keptMessages} dropped=${stats.droppedMessages} ` +
    `sys≈${stats.systemTokens} hist≈${stats.historyTokens} toolsTrunc=${stats.truncatedTools}`
  );
}

/**
 * Extract the static system string from a packed message list (first system msg).
 * Useful for tests / cache-prefix assertions.
 */
export function getStaticSystemContent(messages: Record<string, any>[]): string {
  const sys = messages.find(m => m.role === 'system');
  return typeof sys?.content === 'string' ? sys.content : '';
}
