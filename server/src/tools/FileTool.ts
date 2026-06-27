// ============================================================================
// FileTool — File Read / Write / Edit operations with path jail
// ============================================================================

import fs from 'fs/promises';
import path from 'path';
import type { ToolDefinition, ToolContext } from './types.js';
import type { ToolResult } from '../types.js';
import { ConfigManager } from '../configManager.js';

// Shared config instance for reading allowedDirectories
let _config: ConfigManager | null = null;
export function setFileToolConfig(config: ConfigManager) { _config = config; }

function isPathAllowed(normalized: string, workspace: string): boolean {
  const workspaceNorm = path.normalize(workspace);
  if (normalized === workspaceNorm || normalized.startsWith(workspaceNorm + path.sep)) return true;
  // Check allowed directories
  const cfg = _config?.load();
  const allowed = cfg?.allowedDirectories ?? [];
  for (const dir of allowed) {
    const dirNorm = path.normalize(dir);
    if (normalized === dirNorm || normalized.startsWith(dirNorm + path.sep)) return true;
  }
  return false;
}

/**
 * Resolves a file path and ensures it stays within the workspace or allowed directories.
 */
async function safePath(filePath: string, workspace: string): Promise<string | null> {
  const absPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(workspace, filePath);
  const normalized = path.normalize(absPath);

  if (!isPathAllowed(normalized, workspace)) return null;

  // Resolve symlinks to prevent escape via symbolic links
  try {
    const realPath = await fs.realpath(absPath);
    const realNormalized = path.normalize(realPath);
    if (!isPathAllowed(realNormalized, workspace)) return null;
  } catch {
    // File doesn't exist yet — check parent directory for write operations
    const parentDir = path.dirname(absPath);
    try {
      const realParent = await fs.realpath(parentDir);
      const realParentNorm = path.normalize(realParent);
      if (!isPathAllowed(realParentNorm, workspace)) return null;
    } catch {
      return null;  // Parent doesn't exist or can't be resolved
    }
  }

  return normalized;
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
      const content = await fs.readFile(absPath, 'utf-8');

      if (input.offset != null || input.limit != null) {
        const lines = content.split('\n');
        const offset = input.offset ?? 0;
        const limit = input.limit ?? 2000;
        const sliced = lines.slice(offset, offset + limit);
        const numbered = sliced.map((l, i) => `${offset + i + 1}\t${l}`).join('\n');
        return { success: true, output: numbered, duration: Date.now() - start };
      }

      // Cap at 50KB for very large files
      if (content.length > 50_000) {
        return {
          success: true,
          output: content.slice(0, 50_000) + '\n... (file truncated, use offset/limit to read specific ranges)',
          duration: Date.now() - start,
        };
      }

      return { success: true, output: content, duration: Date.now() - start };
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
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, input.content, 'utf-8');
      const lines = input.content.split('\n').length;
      return {
        success: true,
        output: `Wrote ${lines} lines to ${path.relative(ctx.workingDirectory, absPath)}`,
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
      const content = await fs.readFile(absPath, 'utf-8');

      if (!content.includes(input.old_string)) {
        return {
          success: false,
          output: '',
          error: 'old_string not found in file',
          duration: Date.now() - start,
        };
      }

      let newContent: string;
      if (input.replace_all) {
        newContent = content.split(input.old_string).join(input.new_string);
      } else {
        // Replace only first occurrence
        const idx = content.indexOf(input.old_string);
        newContent =
          content.slice(0, idx) + input.new_string + content.slice(idx + input.old_string.length);
      }

      await fs.writeFile(absPath, newContent, 'utf-8');
      return {
        success: true,
        output: `Replaced in ${path.relative(ctx.workingDirectory, absPath)}`,
        duration: Date.now() - start,
      };
    } catch (err: any) {
      return { success: false, output: '', error: err.message, duration: Date.now() - start };
    }
  },
};
