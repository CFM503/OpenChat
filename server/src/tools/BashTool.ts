// ============================================================================
// BashTool — Execute shell commands with safety checks
// ============================================================================

import { spawn } from 'child_process';
import type { ToolDefinition, ToolContext } from './types.js';
import type { ToolResult } from '../types.js';

interface BashInput {
  command: string;
  timeout?: number;
  cwd?: string;
}

const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\s+\/(?!tmp)/,
  /\bmkfs\b/,
  /\bdd\s+of=\/dev/,
  /:(){ :\|:& };:/,
  /\bformat\b.*[a-zA-Z]:/,
  />\s*\/dev\/sd[a-z]/,
];

function isDangerousCommand(cmd: string): boolean {
  return DANGEROUS_PATTERNS.some(p => p.test(cmd));
}

export const BashTool: ToolDefinition<BashInput> = {
  name: 'bash',
  description:
    'Execute a shell command and return stdout/stderr. Use this to run tests, build commands, list files, check git status, etc.',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 30000)',
      },
      cwd: {
        type: 'string',
        description: 'Working directory (relative to project root or absolute)',
      },
    },
    required: ['command'],
  },
  isReadOnly: false,
  isDestructive: false,

  async execute(input: BashInput, ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now();
    const timeout = input.timeout ?? 30000;

    if (isDangerousCommand(input.command)) {
      return {
        success: false,
        output: '',
        error: `Blocked potentially dangerous command: ${input.command}`,
        duration: 0,
      };
    }

    const cwd = input.cwd
      ? input.cwd.startsWith('/')
        ? input.cwd
        : `${ctx.workingDirectory}/${input.cwd}`
      : ctx.workingDirectory;

    return new Promise<ToolResult>((resolve) => {
      const isWin = process.platform === 'win32';
      const shell = isWin ? 'cmd.exe' : '/bin/sh';
      const shellArgs = isWin ? ['/c', input.command] : ['-c', input.command];

      const proc = spawn(shell, shellArgs, {
        cwd,
        env: { ...process.env, OPENCHAT_SESSION: ctx.sessionId },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d: Buffer) => {
        stdout += d.toString();
        // Cap output at 100KB to prevent memory issues
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

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        resolve({
          success: false,
          output: stdout + (stderr ? `\n[stderr]\n${stderr}` : ''),
          error: `Command timed out after ${timeout}ms`,
          duration: Date.now() - start,
        });
      }, timeout);

      proc.on('close', (code) => {
        clearTimeout(timer);
        const output = stdout + (stderr ? `\n[stderr]\n${stderr}` : '');
        resolve({
          success: code === 0,
          output: output || `(exit code: ${code})`,
          error: code !== 0 && code !== null ? `Process exited with code ${code}` : undefined,
          duration: Date.now() - start,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          success: false,
          output: '',
          error: err.message,
          duration: Date.now() - start,
        });
      });

      ctx.abortSignal.addEventListener('abort', () => {
        clearTimeout(timer);
        proc.kill('SIGTERM');
      });
    });
  },
};
