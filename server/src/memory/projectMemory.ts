// ============================================================================
// Project Memory — CLAUDE.md / OPENCHAT.md always-on context
// Compatible with Claude Code memory files
// ============================================================================

import * as fs from 'fs/promises';
import * as path from 'path';

const MEMORY_FILES = [
  'OPENCHAT.md',
  'CLAUDE.md',
  '.openchat/OPENCHAT.md',
  '.claude/CLAUDE.md',
  'AGENTS.md',
];

const MAX_CHARS = 24_000;

/**
 * Load project instruction files (Claude Code style memory).
 * Concatenates available files with clear headers.
 */
export async function loadProjectMemory(projectDir: string): Promise<string> {
  const parts: string[] = [];
  let total = 0;

  for (const rel of MEMORY_FILES) {
    const full = path.join(projectDir, rel);
    try {
      const text = await fs.readFile(full, 'utf-8');
      const trimmed = text.trim();
      if (!trimmed) continue;
      const chunk = `## ${rel}\n\n${trimmed}`;
      if (total + chunk.length > MAX_CHARS) {
        parts.push(chunk.slice(0, Math.max(0, MAX_CHARS - total)) + '\n\n…[truncated]');
        break;
      }
      parts.push(chunk);
      total += chunk.length;
    } catch {
      // file missing — ok
    }
  }

  // Also load .claude/rules/*.md if present (path-agnostic: all rules)
  try {
    const rulesDir = path.join(projectDir, '.claude', 'rules');
    const entries = await fs.readdir(rulesDir);
    for (const e of entries) {
      if (!e.endsWith('.md')) continue;
      try {
        const text = (await fs.readFile(path.join(rulesDir, e), 'utf-8')).trim();
        if (!text) continue;
        const chunk = `## .claude/rules/${e}\n\n${text}`;
        if (total + chunk.length > MAX_CHARS) break;
        parts.push(chunk);
        total += chunk.length;
      } catch {
        // skip
      }
    }
  } catch {
    // no rules dir
  }

  if (parts.length === 0) return '';
  return `# Project Instructions\n\nThe following project memory files apply to this workspace:\n\n${parts.join('\n\n---\n\n')}`;
}
