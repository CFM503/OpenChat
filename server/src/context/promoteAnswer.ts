// ============================================================================
// Promote reasoning-only streams into a user-visible answer (domain-agnostic)
// ============================================================================

/**
 * Extract a real answer from thinking when the model forgot delta.content.
 * Prefer fenced canvas / final-answer markers; never dump pure monologue.
 */
export function promoteThinkingToAnswer(thinking: string): string {
  const t = thinking.trim();
  if (!t) return '';

  // 1) Any complete ```canvas …``` block (weather / gallery / card / custom)
  const canvas = extractEmbeddedCanvas(t);
  if (canvas) return canvas;

  // 2) Explicit final-answer sections
  const markers = [
    /(?:^|\n)\s*(?:最终答案|最终回复|答案|结论|回答)[:：]\s*/i,
    /(?:^|\n)\s*(?:Final\s+Answer|Answer|Conclusion)\s*[:：]\s*/i,
    /(?:^|\n)\s*(?:#{1,3}\s*)?(?:最终答案|Final Answer)\b/i,
  ];
  for (const re of markers) {
    const m = t.match(re);
    if (m && m.index != null) {
      const after = t.slice(m.index + m[0].length).trim();
      if (after.length >= 8) {
        const nested = extractEmbeddedCanvas(after);
        if (nested) return nested;
        if (!looksLikeInternalMonologue(after)) return after;
        if (after.includes('```')) return after;
      }
    }
  }

  // 3) Short, direct thinking can stand in as the answer
  if (t.length <= 280 && !looksLikeInternalMonologue(t)) return t;

  // 4) Long planning monologue without a real answer → do not promote
  if (looksLikeInternalMonologue(t)) return '';

  // 5) Medium-length CoT that looks like a normal reply
  if (t.length <= 1200) return t;
  return '';
}

/** Pull the last complete ```canvas …``` fence out of a CoT blob (any subtype). */
export function extractEmbeddedCanvas(text: string): string {
  const re = /```\s*canvas(?:[^\n`]*)\n([\s\S]*?)```/gi;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) last = m;
  if (!last) return '';
  // Return the full fence so the UI can parse it
  return last[0].trim();
}

/** Detect chain-of-thought / planning text that must not be shown as the answer */
export function looksLikeInternalMonologue(text: string): boolean {
  const t = text.toLowerCase();
  if (extractEmbeddedCanvas(text)) return false;

  const signals = [
    'the user wants',
    "the user's",
    'let me see',
    'let me check',
    'let me try',
    'looking at the',
    'available skills',
    'i need to',
    'maybe i should',
    'wait,',
    'hmm',
    'okay, the user',
    'okay, the',
    'steps:',
    'first, call',
    'we need to call',
    'let\'s call',
    '用户想',
    '让我看看',
    '我需要',
    '可用技能',
    '先分析',
    '接下来',
    '调用工具',
    '正确的下一步',
    '需要处理用户',
  ];
  let hits = 0;
  for (const s of signals) {
    if (t.includes(s)) hits++;
  }
  if (/(.)\1{2,}/.test(text.replace(/\s/g, '')) && hits >= 1) return true;
  if (/\b(\w+)\s+\1\b/i.test(text) && text.length > 80) {
    const repeats = text.match(/\b([A-Za-z\u4e00-\u9fff]{2,})\s+\1\b/gi);
    if (repeats && repeats.length >= 3) return true;
  }
  if (hits >= 2) return true;
  if (hits >= 1 && text.length > 350) return true;
  return false;
}
