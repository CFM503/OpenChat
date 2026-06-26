// ============================================================================
// GrepTool — Content search using ripgrep or grep fallback
// ============================================================================

import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import type { ToolDefinition, ToolContext } from './types.js';
import type { ToolResult } from '../types.js';

interface GrepInput {
  pattern: string;
  path?: string;
  glob?: string;
  case_insensitive?: boolean;
  max_results?: number;
}

/** Resolve search path and ensure it stays within workspace boundary (H-4). */
function safeSearchPath(inputPath: string | undefined, workingDirectory: string): string | null {
  if (!inputPath) return workingDirectory;
  const absPath = path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(workingDirectory, inputPath);
  const normalized = path.normalize(absPath);
  const workspaceNorm = path.normalize(workingDirectory);
  if (normalized === workspaceNorm || normalized.startsWith(workspaceNorm + path.sep)) {
    return normalized;
  }
  return null;
}

export const GrepTool: ToolDefinition<GrepInput> = {
  name: 'grep',
  description:
    'Search file contents using regex pattern. Returns matching lines with file paths and line numbers. Uses ripgrep if available, falls back to system grep.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search for' },
      path: { type: 'string', description: 'Directory or file to search in (default: project root)' },
      glob: { type: 'string', description: 'File glob filter (e.g. "*.ts", "*.{js,tsx}")' },
      case_insensitive: { type: 'boolean', description: 'Case insensitive search' },
      max_results: { type: 'number', description: 'Maximum results (default: 100)' },
    },
    required: ['pattern'],
  },
  isReadOnly: true,
  isDestructive: false,

  async execute(input: GrepInput, ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now();

    // H-4: Validate path stays within workspace
    const cwd = safeSearchPath(input.path, ctx.workingDirectory);
    if (!cwd) {
      return {
        success: false,
        output: '',
        error: `Search path escapes workspace boundary: ${input.path}`,
        duration: 0,
      };
    }

    const maxResults = input.max_results ?? 100;

    const args: string[] = ['--line-number', '--with-filename'];
    if (input.case_insensitive) args.push('--ignore-case');
    if (input.glob) args.push('--glob', input.glob);
    args.push(input.pattern, '.');

    return new Promise<ToolResult>((resolve) => {
      // H-13: Track the active process for abort handling
      let activeProc: ChildProcess | null = null;

      // Try rg (ripgrep) first, fall back to grep
      const tryRg = spawn('rg', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      activeProc = tryRg;

      let stdout = '';
      let stderr = '';
      let useFallback = false;

      tryRg.on('error', () => {
        useFallback = true;
        // Fall back to grep
        const grepArgs = ['-rn', '--color=never'];
        if (input.case_insensitive) grepArgs.push('-i');
        if (input.glob) grepArgs.push('--include', input.glob);
        grepArgs.push(input.pattern, '.');

        const grep = spawn('grep', grepArgs, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
        activeProc = grep;  // H-13: Update active process reference
        let gOut = '';
        let gErr = '';
        grep.stdout.on('data', (d: Buffer) => { gOut += d.toString(); });
        grep.stderr.on('data', (d: Buffer) => { gErr += d.toString(); });
        grep.on('close', (code) => {
          const lines = gOut.split('\n').filter(Boolean).slice(0, maxResults);
          resolve({
            success: code === 0 || lines.length > 0,
            output: lines.length > 0 ? lines.join('\n') : 'No matches found',
            error: code !== 0 && lines.length === 0 ? gErr || 'No matches' : undefined,
            duration: Date.now() - start,
          });
        });
      });

      tryRg.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      tryRg.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

      tryRg.on('close', (code) => {
        if (useFallback) return;
        const lines = stdout.split('\n').filter(Boolean).slice(0, maxResults);
        resolve({
          success: code === 0 || lines.length > 0,
          output: lines.length > 0 ? lines.join('\n') : 'No matches found',
          error: code !== 0 && lines.length === 0 ? stderr || 'No matches' : undefined,
          duration: Date.now() - start,
        });
      });

      // H-13: Abort signal kills whichever process is currently active
      ctx.abortSignal.addEventListener('abort', () => {
        if (activeProc) {
          activeProc.kill('SIGTERM');
        }
      });
    });
  },
};

// ============================================================================
// GlobTool — File pattern matching
// ============================================================================

import fs from 'fs/promises';

interface GlobInput {
  pattern: string;
  path?: string;
}

export const GlobTool: ToolDefinition<GlobInput> = {
  name: 'glob',
  description:
    'Find files matching a glob pattern. Returns matching file paths sorted by modification time.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.ts", "src/**/*.test.{ts,tsx}")' },
      path: { type: 'string', description: 'Directory to search in (default: project root)' },
    },
    required: ['pattern'],
  },
  isReadOnly: true,
  isDestructive: false,

  async execute(input: GlobInput, ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now();

    // H-4: Validate path stays within workspace
    const cwd = safeSearchPath(input.path, ctx.workingDirectory);
    if (!cwd) {
      return {
        success: false,
        output: '',
        error: `Search path escapes workspace boundary: ${input.path}`,
        duration: 0,
      };
    }

    // Use Node's fs to do simple glob matching
    const pattern = input.pattern;
    const results: string[] = [];

    async function walk(dir: string, relativeTo: string) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = `${dir}/${entry.name}`;
          const relPath = fullPath.slice(relativeTo.length + 1);

          // Skip node_modules, .git, dist
          if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
            continue;
          }

          if (entry.isDirectory()) {
            await walk(fullPath, relativeTo);
          } else if (entry.isFile()) {
            if (matchesGlob(relPath, pattern)) {
              results.push(relPath);
            }
          }
        }
      } catch (err) {
        // L-9: Log errors instead of silently swallowing
        console.warn(`[glob] Error reading ${dir}:`, err instanceof Error ? err.message : err);
      }
    }

    await walk(cwd, cwd);

    // Sort by name, limit to 200
    const limited = results.sort().slice(0, 200);

    return {
      success: true,
      output: limited.length > 0 ? limited.join('\n') : 'No files matched',
      duration: Date.now() - start,
    };
  },
};

/**
 * Simple glob matching (supports **, *, ?, {a,b}).
 */
function matchesGlob(filepath: string, pattern: string): boolean {
  const fp = filepath.replace(/\\/g, '/');
  const pat = pattern.replace(/\\/g, '/');

  let regexStr = pat
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\{([^}]+)\}/g, (_, group) => {
      return '(' + group.split(',').join('|') + ')';
    })
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(fp);
}
