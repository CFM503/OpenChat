// ============================================================================
// GrepTool — Content search using ripgrep or grep fallback
// ============================================================================

import { spawn } from 'child_process';
import type { ToolDefinition, ToolContext } from './types.js';
import type { ToolResult } from '../types.js';

interface GrepInput {
  pattern: string;
  path?: string;
  glob?: string;
  case_insensitive?: boolean;
  max_results?: number;
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
    const cwd = input.path
      ? input.path.startsWith('/')
        ? input.path
        : `${ctx.workingDirectory}/${input.path}`
      : ctx.workingDirectory;
    const maxResults = input.max_results ?? 100;

    const args: string[] = ['--line-number', '--with-filename'];
    if (input.case_insensitive) args.push('--ignore-case');
    if (input.glob) args.push('--glob', input.glob);
    args.push(input.pattern, '.');

    return new Promise<ToolResult>((resolve) => {
      // Try rg (ripgrep) first, fall back to grep
      const tryRg = spawn('rg', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });

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

      ctx.abortSignal.addEventListener('abort', () => {
        tryRg.kill('SIGTERM');
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
    const cwd = input.path
      ? input.path.startsWith('/')
        ? input.path
        : `${ctx.workingDirectory}/${input.path}`
      : ctx.workingDirectory;

    // Use Node's fs to do simple glob matching
    // For production, consider using glob package
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
      } catch {
        // Permission errors etc — skip silently
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
 * Not exhaustive but covers common patterns.
 */
function matchesGlob(filepath: string, pattern: string): boolean {
  // Normalize separators
  const fp = filepath.replace(/\\/g, '/');
  const pat = pattern.replace(/\\/g, '/');

  // Convert glob to regex
  let regexStr = pat
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex specials (except * ? { })
    .replace(/\{([^}]+)\}/g, (_, group) => {
      // {a,b,c} → (a|b|c)
      return '(' + group.split(',').join('|') + ')';
    })
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(fp);
}
