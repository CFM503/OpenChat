// ============================================================================
// FileTool — File Read / Write / Edit operations with path jail
// ============================================================================

import fs from 'fs/promises';
import path from 'path';
import type { ToolDefinition, ToolContext } from './types.js';
import type { ToolResult } from '../types.js';
import type { ConfigManager } from '../configManager.js';
import { resolveSafePath, setPathConfig } from './pathUtils.js';
import { patchStore, buildUnifiedDiff } from '../patches/store.js';

let _fileConfig: ConfigManager | null = null;

export function setFileToolConfig(config: ConfigManager) {
  setPathConfig(config);
  _fileConfig = config;
}

function requireFileApply(): boolean {
  // Default ON: stage writes for user review
  const v = _fileConfig?.load()?.requireFileApply;
  return v !== false;
}

/**
 * Resolves a file path and ensures it stays within the workspace or allowed directories.
 * Uses resolveSafePath (path jail) + realpath on the nearest existing ancestor
 * (so creating new files/folders under Desktop is allowed when the leaf does not exist yet).
 */
async function safePath(filePath: string, workspace: string): Promise<string | null> {
  const normalized = resolveSafePath(filePath, workspace);
  if (!normalized) return null;

  // Walk up until an existing path is found; that ancestor must also be in jail
  let cur = normalized;
  for (;;) {
    try {
      const real = path.normalize(await fs.realpath(cur));
      if (!resolveSafePath(real, workspace)) return null;
      // Return the original logical path (may not exist yet) for create/write
      return normalized;
    } catch {
      const parent = path.dirname(cur);
      if (!parent || parent === cur) return null;
      // Prefix check: every ancestor must still be inside allowed roots
      if (!resolveSafePath(parent, workspace)) return null;
      cur = parent;
    }
  }
}

// ── File Read ───────────────────────────────────────────────────────────────

interface FileReadInput {
  path: string;
  offset?: number;
  limit?: number;
}

export const FileReadTool: ToolDefinition<FileReadInput> = {
  name: 'file_read',
  description:
    'Read the contents of a file. Returns the file content as text. Use offset and limit to read specific line ranges.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path (relative to project root or absolute)' },
      offset: { type: 'number', description: 'Start reading from this line number (0-based)' },
      limit: { type: 'number', description: 'Maximum number of lines to read' },
    },
    required: ['path'],
  },
  isReadOnly: true,
  isDestructive: false,

  async execute(input: FileReadInput, ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now();
    const absPath = await safePath(input.path, ctx.workingDirectory);

    if (!absPath) {
      return { success: false, output: '', error: 'Path escapes workspace boundary', duration: 0 };
    }

    try {
      const effective = await patchStore.getEffectiveContent(absPath);
      if (!effective) {
        return { success: false, output: '', error: 'File not found', duration: Date.now() - start };
      }
      let content = effective.content;
      const stagedNote = effective.staged
        ? '\n\n[Note: showing staged (pending Apply) content, not yet on disk]'
        : '';

      if (input.offset != null || input.limit != null) {
        const lines = content.split('\n');
        const offset = input.offset ?? 0;
        const limit = input.limit ?? 2000;
        const sliced = lines.slice(offset, offset + limit);
        const numbered = sliced.map((l, i) => `${offset + i + 1}\t${l}`).join('\n');
        return { success: true, output: numbered + stagedNote, duration: Date.now() - start };
      }

      // Cap at 50KB for very large files
      if (content.length > 50_000) {
        return {
          success: true,
          output:
            content.slice(0, 50_000) +
            '\n... (file truncated, use offset/limit to read specific ranges)' +
            stagedNote,
          duration: Date.now() - start,
        };
      }

      return { success: true, output: content + stagedNote, duration: Date.now() - start };
    } catch (err: any) {
      return { success: false, output: '', error: err.message, duration: Date.now() - start };
    }
  },
};

// ── File Write ──────────────────────────────────────────────────────────────

interface FileWriteInput {
  path: string;
  content: string;
}

export const FileWriteTool: ToolDefinition<FileWriteInput> = {
  name: 'file_write',
  description:
    'Write content to a file. Creates the file if it does not exist, overwrites if it does. Creates parent directories automatically.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path (relative to project root or absolute)' },
      content: { type: 'string', description: 'The content to write' },
    },
    required: ['path', 'content'],
  },
  isReadOnly: false,
  isDestructive: true,

  async execute(input: FileWriteInput, ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now();
    const absPath = await safePath(input.path, ctx.workingDirectory);

    if (!absPath) {
      return { success: false, output: '', error: 'Path escapes workspace boundary', duration: 0 };
    }

    try {
      const rel = path.relative(ctx.workingDirectory, absPath);
      let oldContent = '';
      try {
        const eff = await patchStore.getEffectiveContent(absPath);
        oldContent = eff?.content ?? '';
      } catch {
        oldContent = '';
      }

      if (requireFileApply()) {
        const patch = patchStore.stage({
          sessionId: ctx.sessionId,
          absPath,
          relativePath: rel,
          oldContent,
          newContent: input.content,
          tool: 'file_write',
        });
        const lines = input.content.split('\n').length;
        const diffPreview = buildUnifiedDiff(oldContent, input.content, rel);
        return {
          success: true,
          output:
            `Staged write (${lines} lines) → ${rel} [pending user Apply]. ` +
            `patchId=${patch.id}. Do not claim the file is saved on disk until the user applies.`,
          duration: Date.now() - start,
          pendingPatch: {
            id: patch.id,
            path: rel,
            tool: 'file_write',
            oldContent,
            newContent: input.content,
            diffPreview,
          },
        };
      }

      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, input.content, 'utf-8');
      const lines = input.content.split('\n').length;
      return {
        success: true,
        output: `Wrote ${lines} lines to ${rel}`,
        duration: Date.now() - start,
      };
    } catch (err: any) {
      return { success: false, output: '', error: err.message, duration: Date.now() - start };
    }
  },
};

// ── File Edit (surgical string replacement) ─────────────────────────────────

interface FileEditInput {
  path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export const FileEditTool: ToolDefinition<FileEditInput> = {
  name: 'file_edit',
  description:
    'Replace text in a file. Performs exact string replacement (old_string must match exactly). Use replace_all to replace all occurrences.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path' },
      old_string: { type: 'string', description: 'The exact string to find and replace' },
      new_string: { type: 'string', description: 'The replacement string' },
      replace_all: { type: 'boolean', description: 'Replace all occurrences (default: false)' },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  isReadOnly: false,
  isDestructive: true,

  async execute(input: FileEditInput, ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now();
    const absPath = await safePath(input.path, ctx.workingDirectory);

    if (!absPath) {
      return { success: false, output: '', error: 'Path escapes workspace boundary', duration: 0 };
    }

    try {
      const rel = path.relative(ctx.workingDirectory, absPath);
      const eff = await patchStore.getEffectiveContent(absPath);
      if (!eff) {
        return {
          success: false,
          output: '',
          error: 'File not found',
          duration: Date.now() - start,
        };
      }
      const content = eff.content;

      if (!content.includes(input.old_string)) {
        return {
          success: false,
          output: '',
          error: 'old_string not found in file' + (eff.staged ? ' (checked staged content)' : ''),
          duration: Date.now() - start,
        };
      }

      let newContent: string;
      if (input.replace_all) {
        newContent = content.split(input.old_string).join(input.new_string);
      } else {
        const idx = content.indexOf(input.old_string);
        newContent =
          content.slice(0, idx) + input.new_string + content.slice(idx + input.old_string.length);
      }

      // Baseline for diff: original disk (or empty) before any staging
      let diskOld = '';
      try {
        diskOld = await fs.readFile(absPath, 'utf-8');
      } catch {
        diskOld = '';
      }

      if (requireFileApply()) {
        const patch = patchStore.stage({
          sessionId: ctx.sessionId,
          absPath,
          relativePath: rel,
          oldContent: diskOld,
          newContent,
          tool: 'file_edit',
        });
        const diffPreview = buildUnifiedDiff(diskOld, newContent, rel);
        return {
          success: true,
          output:
            `Staged edit → ${rel} [pending user Apply]. patchId=${patch.id}. ` +
            `Do not claim the file is saved on disk until the user applies.`,
          duration: Date.now() - start,
          pendingPatch: {
            id: patch.id,
            path: rel,
            tool: 'file_edit',
            oldContent: diskOld,
            newContent,
            diffPreview,
          },
        };
      }

      await fs.writeFile(absPath, newContent, 'utf-8');
      return {
        success: true,
        output: `Replaced in ${rel}`,
        duration: Date.now() - start,
      };
    } catch (err: any) {
      return { success: false, output: '', error: err.message, duration: Date.now() - start };
    }
  },
};
