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
// ============================================================================

import type { ModelConfig, ResolvedModelCaps } from '../providers/modelTypes.js';
import { resolveModelCaps } from '../providers/resolveCaps.js';

export interface PackInput {
  messages: Record<string, any>[];
  systemParts: string[];
  model: ModelConfig;
  /** Precomputed rolling summary of older history (optional) */
  priorSummary?: string;
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
 */
export function truncateToolResults(
  messages: Record<string, any>[],
  maxChars: number,
): number {
  let count = 0;
  for (const m of messages) {
    if (m.role !== 'tool') continue;
    if (typeof m.content === 'string' && m.content.length > maxChars) {
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
 */
export function packSkillCatalog(
  entries: Array<{ shortcut: string; name: string; description: string; whenToUse?: string }>,
  mode: 'full' | 'names' | 'off',
  maxChars: number,
): string {
  if (mode === 'off' || entries.length === 0) return '';
  const lines = [
    '# Skills',
    mode === 'names'
      ? 'Use the `skill` tool with a name below when relevant.'
      : 'Use the `skill` tool when a description matches the task.',
    '',
  ];
  let used = lines.join('\n').length;
  for (const e of entries) {
    const line =
      mode === 'names'
        ? `- ${e.shortcut}`
        : `- **${e.shortcut}**: ${e.description.slice(0, 120)}${e.whenToUse ? ` (${e.whenToUse.slice(0, 80)})` : ''}`;
    if (used + line.length + 1 > maxChars) {
      lines.push(`- …+${entries.length - lines.length + 3} more (use skill tool)`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}

/**
 * Pack messages into a token budget for lowest cost.
 */
export function packConversation(input: PackInput): PackResult {
  const caps = resolveModelCaps(input.model);
  const historyBudget = caps.historyTokenBudget;
  // Reserve ~15% of context for model output + tools this turn
  const hardCap = Math.min(
    historyBudget,
    Math.floor(caps.contextWindow * (1 - 0.15)),
  );

  // ── System block ──────────────────────────────────────────────────
  let systemText = input.systemParts.filter(Boolean).join('\n\n');
  if (systemText.length > caps.memoryMaxChars + 2000) {
    // Prefer keeping agent core (last part) + truncated front
    const core = input.systemParts[input.systemParts.length - 1] || '';
    const head = input.systemParts.slice(0, -1).join('\n\n');
    const headBudget = Math.max(500, caps.memoryMaxChars);
    systemText =
      (head.length > headBudget
        ? head.slice(0, headBudget) + '\n…[project memory truncated]'
        : head) +
      (core ? `\n\n${core}` : '');
  }
  if (input.priorSummary) {
    systemText += `\n\n# Conversation summary (older turns)\n${input.priorSummary}`;
  }

  const systemTokens = estimateTokens(systemText);
  let remaining = hardCap - systemTokens;

  // ── Clean + truncate tools in a working copy ──────────────────────
  let working = input.messages
    .filter(m => {
      if (m.role === 'assistant' && typeof m.content === 'string' && m.content.includes('Welcome to **OpenChat**')) {
        return false;
      }
      return true;
    })
    .map(m => ({ ...m }));

  const truncatedTools = truncateToolResults(working, caps.toolResultMaxChars);

  // ── Split: must-keep tail vs older ────────────────────────────────
  // Keep tool chains intact: walk from end, keep last N "turns"
  const maxMsgs = caps.maxHistoryMessages;
  const tail: Record<string, any>[] = [];
  const older: Record<string, any>[] = [];

  // Always try to keep from the end
  let turnBudget = maxMsgs;
  for (let i = working.length - 1; i >= 0; i--) {
    const m = working[i];
    if (tail.length >= turnBudget && m.role !== 'tool') {
      // once we hit user/assistant beyond budget, rest is older
      older.unshift(...working.slice(0, i + 1));
      break;
    }
    tail.unshift(m);
    if (m.role === 'user') turnBudget--; // count user turns
  }

  // Fill from tail (newest first) into budget
  const keptRev: Record<string, any>[] = [];
  let historyTokens = 0;
  let dropped = 0;

  for (let i = tail.length - 1; i >= 0; i--) {
    const t = estimateMessageTokens(tail[i]);
    if (historyTokens + t > remaining && keptRev.length > 0) {
      // Must keep at least the last user message
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

  // Anything not in tail was already "older"
  dropped += older.length;

  // Compact stub for dropped older content (no LLM)
  let dropStub = '';
  if (dropped > 0 && caps.contextStrategy !== 'full') {
    const sample = older
      .slice(-6)
      .map(m => {
        const c = contentToString(m.content).replace(/\s+/g, ' ').slice(0, 80);
        return `${m.role}: ${c}`;
      })
      .join(' | ');
    dropStub = `[${dropped} earlier messages omitted for token budget${sample ? `: ${sample}` : ''}]`;
  }

  const packed: Record<string, any>[] = [];
  if (systemText.trim()) {
    packed.push({ role: 'system', content: systemText });
  }
  if (dropStub && caps.contextStrategy !== 'full') {
    // Attach stub as system note (cheap) rather than fake user message
    if (packed[0]?.role === 'system') {
      packed[0].content += `\n\n${dropStub}`;
    } else {
      packed.push({ role: 'system', content: dropStub });
    }
  }
  packed.push(...kept);

  // Strict alternation for fragile models
  const finalMsgs = caps.strictAlternation
    ? enforceAlternation(packed)
    : packed;

  const estimatedTokens =
    finalMsgs.reduce((s, m) => s + estimateMessageTokens(m), 0);

  // Suggest LLM compression if still high vs window
  const needsLlmCompression =
    estimatedTokens > caps.contextWindow * caps.compressionThreshold ||
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
      systemTokens,
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
