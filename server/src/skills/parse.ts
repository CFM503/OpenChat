// ============================================================================
// Skill file parsing — YAML-ish frontmatter + SKILL.md / command.md
// ============================================================================

import path from 'path';
import type { Skill, SkillFrontmatter, SkillSource } from './types.js';

/**
 * Parse simple YAML frontmatter (key: value, no nested objects required).
 * Supports booleans, quoted strings, and [a, b] lists.
 */
export function parseFrontmatter(raw: string): { meta: SkillFrontmatter; body: string } | null {
  const trimmed = raw.replace(/^\uFEFF/, '').trimStart();
  if (!trimmed.startsWith('---')) {
    return { meta: {}, body: trimmed };
  }

  const endIdx = trimmed.indexOf('\n---', 3);
  if (endIdx === -1) {
    // No closing fence — treat whole file as body
    return { meta: {}, body: trimmed };
  }

  const fmBlock = trimmed.slice(3, endIdx).trim();
  const body = trimmed.slice(endIdx + 4).replace(/^\r?\n/, '');

  const meta: Record<string, unknown> = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Boolean
    if (value === 'true' || value === 'false') {
      meta[key] = value === 'true';
      continue;
    }

    // YAML list: [a, b] or empty []
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim();
      if (!inner) {
        meta[key] = [];
      } else {
        meta[key] = inner.split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
      }
      continue;
    }

    meta[key] = value;
  }

  return { meta: meta as SkillFrontmatter, body };
}

function asBool(v: unknown, defaultVal: boolean): boolean {
  if (v === undefined || v === null || v === '') return defaultVal;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.toLowerCase() === 'true';
  return defaultVal;
}

function asStringList(v: unknown): string[] | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') {
    // space or comma separated (Claude allowed-tools style)
    return v
      .split(/[\s,]+/)
      .map(s => s.trim())
      .filter(Boolean);
  }
  return undefined;
}

export interface BuildSkillOptions {
  raw: string;
  filePath: string;
  /** Directory name or file basename used as default command name */
  defaultName: string;
  source: SkillSource;
  pluginName?: string;
  /** Namespace for plugin skills → plugin:skill */
  namespace?: string;
}

/**
 * Build a Skill object from file contents.
 */
export function buildSkillFromContent(opts: BuildSkillOptions): Skill | null {
  const parsed = parseFrontmatter(opts.raw);
  if (!parsed) return null;

  const { meta, body } = parsed;
  const dirName = opts.defaultName;
  const name = (meta.name?.trim() || dirName).replace(/^\/+/, '');
  if (!name) return null;

  const description =
    (meta.description?.trim() || body.split(/\r?\n/).find(l => l.trim())?.trim() || name).slice(0, 1536);

  const whenToUse = meta.when_to_use?.trim();
  const namespaced = opts.namespace ? `${opts.namespace}:${dirName}` : dirName;
  const shortcutFromMeta = meta.shortcut?.trim();
  const shortcut = shortcutFromMeta
    ? (shortcutFromMeta.startsWith('/') ? shortcutFromMeta : `/${shortcutFromMeta}`)
    : `/${namespaced}`;

  const id = opts.pluginName
    ? `plugin:${opts.pluginName}:${dirName}`
    : `${opts.source}:${namespaced}`;

  const argNames = asStringList(meta.arguments);

  return {
    id,
    name: dirName, // invocation name is directory name (Claude Code convention)
    description,
    whenToUse,
    shortcut,
    category: meta.category,
    source: opts.source,
    pluginName: opts.pluginName,
    content: body,
    filePath: opts.filePath,
    skillDir: path.dirname(opts.filePath),
    disableModelInvocation: asBool(meta['disable-model-invocation'], false),
    userInvocable: asBool(meta['user-invocable'], true),
    argumentHint: meta['argument-hint'],
    argumentNames: argNames,
    allowedTools: asStringList(meta['allowed-tools']),
    disallowedTools: asStringList(meta['disallowed-tools']),
    model: meta.model,
    context: meta.context,
    agent: meta.agent,
    paths: asStringList(meta.paths),
    shell: meta.shell,
    builtin: opts.source === 'builtin',
  };
}

/**
 * Expand skill body with Claude Code substitutions + OpenChat {{selection}}.
 * Shell injection (!`cmd`) is handled separately after this if needed.
 */
export function expandSkillTemplate(
  skill: Skill,
  opts: {
    arguments?: string;
    selection?: string;
    sessionId?: string;
    projectDir?: string;
    effort?: string;
  } = {},
): string {
  let result = skill.content;
  const args = opts.arguments ?? '';
  const parts = splitArgs(args);

  // Named arguments from frontmatter
  if (skill.argumentNames?.length) {
    skill.argumentNames.forEach((name, i) => {
      const val = parts[i] ?? '';
      result = result.replace(new RegExp(`\\$${name}\\b`, 'g'), val);
    });
  }

  // $ARGUMENTS[N] and $N
  result = result.replace(/\$ARGUMENTS\[(\d+)\]/g, (_, i) => parts[Number(i)] ?? '');
  result = result.replace(/\$(\d+)\b/g, (match, i) => {
    // Don't replace if escaped
    return parts[Number(i)] ?? match;
  });

  // $ARGUMENTS
  if (result.includes('$ARGUMENTS')) {
    result = result.replace(/\$ARGUMENTS\b/g, args);
  } else if (args.trim()) {
    result = result + `\n\nARGUMENTS: ${args}`;
  }

  // Environment-style placeholders
  const skillDir = skill.skillDir ?? '';
  const projectDir = opts.projectDir ?? process.cwd();
  const sessionId = opts.sessionId ?? '';
  const effort = opts.effort ?? 'medium';

  result = result
    .replace(/\$\{CLAUDE_SKILL_DIR\}/g, skillDir)
    .replace(/\$\{CLAUDE_PROJECT_DIR\}/g, projectDir)
    .replace(/\$\{CLAUDE_SESSION_ID\}/g, sessionId)
    .replace(/\$\{CLAUDE_EFFORT\}/g, effort)
    .replace(/\$\{OPENCHAT_SKILL_DIR\}/g, skillDir)
    .replace(/\$\{OPENCHAT_PROJECT_DIR\}/g, projectDir);

  // OpenChat legacy
  if (opts.selection !== undefined) {
    result = result.replace(/\{\{selection\}\}/g, opts.selection);
  }

  // Unescape \$
  result = result.replace(/\\\$/g, '$');

  return result;
}

/** Split arguments with simple shell-style quoting */
function splitArgs(input: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuote: '"' | "'" | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (/\s/.test(ch)) {
      if (current) {
        result.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) result.push(current);
  return result;
}

/**
 * Execute !`command` and ```! multiline shell blocks, replace with stdout.
 */
export async function injectShellContext(
  content: string,
  opts: {
    cwd: string;
    skillDir?: string;
    projectDir?: string;
    shell?: string;
    disabled?: boolean;
  },
): Promise<string> {
  if (opts.disabled) {
    return content
      .replace(/(?:^|\s)!`[^`]+`/gm, ' [shell command execution disabled by policy]')
      .replace(/```!\n[\s\S]*?```/g, '[shell command execution disabled by policy]');
  }

  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  const env = {
    ...process.env,
    CLAUDE_SKILL_DIR: opts.skillDir ?? '',
    CLAUDE_PROJECT_DIR: opts.projectDir ?? opts.cwd,
    OPENCHAT_SKILL_DIR: opts.skillDir ?? '',
    OPENCHAT_PROJECT_DIR: opts.projectDir ?? opts.cwd,
  };

  const run = async (cmd: string): Promise<string> => {
    try {
      const shellOpt: string | boolean =
        opts.shell === 'powershell'
          ? (process.platform === 'win32' ? 'powershell.exe' : true)
          : true;
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: opts.cwd,
        env,
        timeout: 30000,
        maxBuffer: 1024 * 1024,
        shell: shellOpt as string,
      });
      return (stdout || '') + (stderr ? `\n[stderr]\n${stderr}` : '');
    } catch (err: any) {
      return `[command failed: ${err.message}]\n${err.stdout || ''}${err.stderr || ''}`;
    }
  };

  let result = content;

  // Multiline ```! blocks
  const multiRe = /```!\r?\n([\s\S]*?)```/g;
  const multiMatches = [...result.matchAll(multiRe)];
  for (const m of multiMatches) {
    const out = await run(m[1].trim());
    result = result.replace(m[0], out.trimEnd());
  }

  // Inline !`cmd` at line start or after whitespace
  const inlineRe = /(^|\s)!`([^`]+)`/gm;
  const inlineMatches = [...result.matchAll(inlineRe)];
  // Process from end so indices stay valid if we rebuild via replace sequentially
  for (const m of inlineMatches.reverse()) {
    const out = await run(m[2].trim());
    result = result.slice(0, m.index!) + m[1] + out.trimEnd() + result.slice(m.index! + m[0].length);
  }

  return result;
}
