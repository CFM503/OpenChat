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
        description: 'Additional arguments (e.g. "--oneline -10" for log)',
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
    const args = [input.subcommand, ...argsStr.split(/\s+/).filter(Boolean)];

    return new Promise<ToolResult>((resolve) => {
      const proc = spawn('git', args, {
        cwd: ctx.workingDirectory,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

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
