// ============================================================================
// BashTool — Execute shell commands with safety checks
// ============================================================================

import { spawn } from 'child_process';
import path from 'path';
import type { ToolDefinition, ToolContext } from './types.js';
import type { ToolResult } from '../types.js';

interface BashInput {
  command: string;
  timeout?: number;
  cwd?: string;
}

const DANGEROUS_PATTERNS = [
  /\brm\s+(-[^\s]*\s+)*\/(?!tmp)/,     // rm with any flags targeting root (not /tmp)
  /\brmdir\s+\/(?!tmp)/,                 // rmdir targeting root
  /\bmkfs\b/,
  /\bdd\s+of=\/dev/,
  /:(){ :\|:& };:/,
  /\bformat\b.*[a-zA-Z]:/,
  />\s*\/dev\/sd[a-z]/,
  /\bchmod\b.*\b777\b.*\//,              // chmod 777 on system paths
  /\bwget\b.*\|\s*(ba)?sh/,              // pipe download to shell
  /\bcurl\b.*\|\s*(ba)?sh/,              // pipe download to shell
];

function isDangerousCommand(cmd: string): boolean {
  return DANGEROUS_PATTERNS.some(p => p.test(cmd));
}

/** Resolve cwd and ensure it stays within workspace boundary (H-4). */
function safeCwd(inputCwd: string | undefined, workingDirectory: string): string | null {
  if (!inputCwd) return workingDirectory;
  const absPath = path.isAbsolute(inputCwd)
    ? inputCwd
    : path.resolve(workingDirectory, inputCwd);
  const normalized = path.normalize(absPath);
  const workspaceNorm = path.normalize(workingDirectory);
  if (normalized === workspaceNorm || normalized.startsWith(workspaceNorm + path.sep)) {
    return normalized;
  }
  return null;
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
  isDestructive: true,  // L-6: Bash can modify system state

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

    // H-4: Validate cwd stays within workspace boundary
    const cwd = safeCwd(input.cwd, ctx.workingDirectory);
    if (!cwd) {
      return {
        success: false,
        output: '',
        error: `Working directory escapes workspace boundary: ${input.cwd}`,
        duration: 0,
      };
    }

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
