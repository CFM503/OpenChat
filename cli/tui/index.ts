/**
 * OpenChat interactive TUI entrypoint.
 *
 * Launch:
 *   openchat tui
 *   openchat tui --port 3001 --model my-model --no-thinking
 *   openchat tui --serve          # auto-start backend if offline
 *   openchat --tui
 */

import { runTui } from './app.js';
import type { TuiOptions } from './types.js';

function parseArgs(argv: string[]): TuiOptions {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') flags.port = argv[++i];
    else if (a === '--host' || a === '-H') flags.host = argv[++i];
    else if (a === '--model' || a === '-m') flags.model = argv[++i];
    else if (a === '--cwd') flags.cwd = argv[++i];
    else if (a === '--serve' || a === '--auto-serve') flags.serve = true;
    else if (a === '--no-serve') flags.serve = false;
    else if (a === '--no-thinking' || a === '--no-think') flags.noThinking = true;
    else if (a === '--thinking' || a === '--think') flags.thinking = true;
    else if (a === '--help' || a === '-h') flags.help = true;
    else if (a.startsWith('--')) flags[a.slice(2)] = true;
    else positional.push(a);
  }

  if (flags.help) {
    printHelp();
    process.exit(0);
  }

  const port = parseInt(String(flags.port || process.env.OPENCHAT_PORT || '3001'), 10);
  const host = String(flags.host || process.env.OPENCHAT_HOST || 'localhost');

  let enableThinking = true;
  if (flags.noThinking) enableThinking = false;
  if (flags.thinking) enableThinking = true;

  // Default: auto-serve on, unless --no-serve
  const autoServe = flags.serve === false ? false : true;

  return {
    host,
    port: Number.isFinite(port) ? port : 3001,
    modelId: flags.model ? String(flags.model) : undefined,
    enableThinking,
    autoServe,
    cwd: flags.cwd ? String(flags.cwd) : process.env.OPENCHAT_CWD || process.cwd(),
  };
}

function printHelp(): void {
  console.log(`
OpenChat TUI — interactive terminal chat

Usage:
  openchat tui [options]
  openchat --tui [options]

Options:
  -p, --port <n>       Backend port (default: 3001 or OPENCHAT_PORT)
  -H, --host <host>    Backend host (default: localhost)
  -m, --model <id>     Model id to use
      --cwd <path>     Working directory for tools
      --serve          Auto-start backend if offline (default)
      --no-serve       Do not start backend; fail if offline
      --no-thinking    Disable deep thinking / CoT
      --thinking       Enable deep thinking (default)
  -h, --help           Show this help

In-session:
  Type a message and press Enter to chat
  /help /clear /model /think /compress /abort /status /tools /skills /sessions /reload /quit
  Esc or Ctrl+C aborts a stream; Ctrl+C twice quits

Context compression:
  Automatic on each chat turn (token pack + optional LLM summary)
  Manual: /compress   (force LLM summary of older turns)
`);
}

const opts = parseArgs(process.argv.slice(2));

runTui(opts).catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
