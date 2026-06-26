// ============================================================================
// GitTool — Common git operations
// ============================================================================

import { spawn } from 'child_process';
import type { ToolDefinition, ToolContext } from './types.js';
import type { ToolResult } from '../types.js';

interface GitInput {
  subcommand: 'status' | 'diff' | 'log' | 'branch';
  args?: string;
}

// H-5: Whitelist of safe git arguments to prevent parameter injection
const SAFE_ARGS = new Set([
  '--short', '--oneline', '--stat', '--name-only', '--name-status',
  '--graph', '--all', '--decorate', '--color=never', '--no-color',
  '-s', '-b', '-a', '-n', '-p', '--cached', '--no-pager',
  '--porcelain', '--ignore-submodules',
  // Numeric limits
  '-1', '-2', '-3', '-5', '-10', '-20', '-50', '-100',
  '--max-count=1', '--max-count=2', '--max-count=3', '--max-count=5',
  '--max-count=10', '--max-count=20', '--max-count=50', '--max-count=100',
]);

function filterArgs(argsStr: string): string[] {
  return argsStr
    .split(/\s+/)
    .filter(Boolean)
    .filter(arg => SAFE_ARGS.has(arg));
}

export const GitTool: ToolDefinition<GitInput> = {
  name: 'git',
  description:
    'Run read-only git operations. Supported subcommands: status, diff, log, branch. For write operations (commit, push), use bash.',
  inputSchema: {
    type: 'object',
    properties: {
      subcommand: {
        type: 'string',
        enum: ['status', 'diff', 'log', 'branch'],
        description: 'Git subcommand to run',
      },
      args: {
        type: 'string',
        description: 'Additional arguments (e.g. "--oneline -10" for log). Only whitelisted args allowed.',
      },
    },
    required: ['subcommand'],
  },
  isReadOnly: true,
  isDestructive: false,

  async execute(input: GitInput, ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now();

    const defaultArgs: Record<string, string> = {
      status: '--short',
      diff: '--stat',
      log: '--oneline -20',
      branch: '-a',
    };

    const argsStr = input.args ?? defaultArgs[input.subcommand] ?? '';
    // H-5: Filter through whitelist instead of blindly splitting
    const filteredArgs = input.args ? filterArgs(argsStr) : argsStr.split(/\s+/).filter(Boolean);
    const args = [input.subcommand, ...filteredArgs];

    return new Promise<ToolResult>((resolve) => {
      const proc = spawn('git', args, {
        cwd: ctx.workingDirectory,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      // L-7: Cap output at 100KB
      proc.stdout.on('data', (d: Buffer) => {
        stdout += d.toString();
        if (stdout.length > 100_000) {
          stdout = stdout.slice(0, 100_000) + '\n... (output truncated)';
          proc.kill('SIGTERM');
        }
      });
      proc.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
        if (stderr.length > 50_000) {
          stderr = stderr.slice(0, 50_000) + '\n... (output truncated)';
        }
      });

      proc.on('close', (code) => {
        resolve({
          success: code === 0,
          output: stdout || stderr || `(exit code: ${code})`,
          error: code !== 0 ? stderr || `git exited with code ${code}` : undefined,
          duration: Date.now() - start,
        });
      });

      proc.on('error', (err) => {
        resolve({
          success: false,
          output: '',
          error: `git not available: ${err.message}`,
          duration: Date.now() - start,
        });
      });

      ctx.abortSignal.addEventListener('abort', () => proc.kill('SIGTERM'));
    });
  },
};
