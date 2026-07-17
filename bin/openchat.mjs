#!/usr/bin/env node
/**
 * OpenChat CLI — lightweight launcher
 *
 * Usage:
 *   openchat serve [--port 3001] [--cwd PATH]
 *   openchat chat "your prompt" [--model ID]
 *   openchat health
 *   openchat tools
 *   openchat sessions
 *   openchat help
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_PORT = parseInt(process.env.OPENCHAT_PORT || '3001', 10);
const API = `http://localhost:${DEFAULT_PORT}`;

const args = process.argv.slice(2);
const cmd = args[0] || 'help';

function printHelp() {
  console.log(`
OpenChat CLI — AI Coding Workspace

Commands:
  serve [--port N] [--cwd PATH]   Start the backend gateway
  chat <prompt> [--model ID]      One-shot agent chat via WebSocket
  health                          Check backend health
  tools                           List registered tools
  skills                          List Claude-compatible skills
  plugins                         List plugins (Claude + legacy)
  reload                          Reload skills & plugins
  sessions                        List saved sessions
  help                            Show this help

Skills (Claude Code compatible):
  ~/.claude/skills/<name>/SKILL.md
  ~/.openchat/skills/<name>/SKILL.md
  .claude/skills/<name>/SKILL.md   (project)
  <plugin>/skills/<name>/SKILL.md

Plugins:
  ~/.openchat/plugins/<name>/.claude-plugin/plugin.json
  ~/.claude/plugins/<name>/

Environment:
  OPENCHAT_PORT   Backend port (default 3001)
  OPENCHAT_CWD    Working directory for tools
`);
}

function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') flags.port = argv[++i];
    else if (a === '--cwd') flags.cwd = argv[++i];
    else if (a === '--model' || a === '-m') flags.model = argv[++i];
    else if (a.startsWith('--')) flags[a.slice(2)] = true;
    else positional.push(a);
  }
  return { flags, positional };
}

async function cmdServe(argv) {
  const { flags } = parseFlags(argv);
  const port = flags.port || DEFAULT_PORT;
  const cwd = flags.cwd || process.cwd();
  const env = {
    ...process.env,
    OPENCHAT_PORT: String(port),
    OPENCHAT_CWD: cwd,
  };

  // Port pre-check (same script as npm run ports)
  const checkScript = path.join(ROOT, 'scripts', 'check-ports.mjs');
  const check = spawn(
    process.execPath,
    [checkScript, '--backend'],
    { cwd: ROOT, env, stdio: 'inherit', shell: false },
  );
  const checkCode = await new Promise((resolve) => check.on('exit', resolve));
  if (checkCode !== 0) process.exit(checkCode ?? 1);

  const entry = path.join(ROOT, 'server', 'src', 'index.ts');
  console.log(`Starting OpenChat backend on :${port}`);
  console.log(`Working directory: ${cwd}`);

  const child = spawn('npx', ['tsx', entry], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
    shell: true,
  });

  child.on('exit', (code) => process.exit(code ?? 0));
}

async function fetchJson(url, opts) {
  const resp = await fetch(url, opts);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

async function cmdHealth() {
  try {
    const data = await fetchJson(`${API}/api/health`);
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Backend not reachable:', err.message);
    console.error(`Start with: openchat serve  (or npm run dev:server)`);
    process.exit(1);
  }
}

async function cmdTools() {
  const data = await fetchJson(`${API}/api/tools`);
  for (const t of data) {
    const flags = [
      t.isReadOnly ? 'ro' : 'rw',
      t.isDestructive ? 'destructive' : null,
    ].filter(Boolean).join(', ');
    console.log(`  ${t.name.padEnd(16)} ${flags.padEnd(16)} ${t.description.slice(0, 60)}`);
  }
}

async function cmdSessions() {
  const data = await fetchJson(`${API}/api/sessions`);
  if (!data.length) {
    console.log('No sessions.');
    return;
  }
  for (const s of data) {
    console.log(`  ${s.id}  ${(s.title || '').slice(0, 40).padEnd(40)}  msgs=${s.messages?.length ?? 0}`);
  }
}

async function cmdSkills() {
  const data = await fetchJson(`${API}/api/skills`);
  if (!data.length) {
    console.log('No skills loaded.');
    return;
  }
  for (const s of data) {
    const flags = [
      s.source || (s.builtin ? 'builtin' : ''),
      s.disableModelInvocation ? 'user-only' : '',
    ].filter(Boolean).join(',');
    console.log(`  ${(s.shortcut || s.name).padEnd(28)} ${(flags || '-').padEnd(18)} ${s.description?.slice(0, 60) || ''}`);
  }
}

async function cmdPlugins() {
  const data = await fetchJson(`${API}/api/plugins`);
  if (!data.length) {
    console.log('No plugins loaded.');
    return;
  }
  for (const p of data) {
    console.log(`  ${p.name.padEnd(20)} v${(p.version || '?').padEnd(8)} [${p.format || '?'}]  skills=${(p.skills || []).length} tools=${(p.tools || []).length}`);
    console.log(`    ${p.description || ''}`);
  }
}

async function cmdReload() {
  await fetchJson(`${API}/api/skills/reload`, { method: 'POST' });
  const r = await fetchJson(`${API}/api/plugins/reload`, { method: 'POST' });
  console.log('Reloaded.', r);
}

async function cmdChat(argv) {
  const { flags, positional } = parseFlags(argv);
  const prompt = positional.join(' ').trim();
  if (!prompt) {
    console.error('Usage: openchat chat "your prompt"');
    process.exit(1);
  }

  // Health check first
  try {
    await fetchJson(`${API}/api/health`);
  } catch {
    console.error('Backend not running. Start with: openchat serve');
    process.exit(1);
  }

  const { default: WebSocket } = await import('ws');
  const ws = new WebSocket(`ws://localhost:${DEFAULT_PORT}/ws`);

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  const messages = [
    {
      id: `cli_${Date.now()}`,
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    },
  ];

  process.stdout.write('\n');

  await new Promise((resolve) => {
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      switch (msg.type) {
        case 'content':
          process.stdout.write(msg.text || '');
          break;
        case 'thinking':
          // Soft-dim thinking if terminal supports it
          process.stderr.write(`\x1b[2m${msg.text || ''}\x1b[0m`);
          break;
        case 'tool_start':
          process.stderr.write(`\n\x1b[36m🔧 ${msg.name}\x1b[0m\n`);
          break;
        case 'tool_result': {
          const ok = msg.result?.success;
          process.stderr.write(
            `${ok ? '✓' : '✗'} ${msg.name} (${msg.result?.duration ?? 0}ms)\n`,
          );
          break;
        }
        case 'error':
          process.stderr.write(`\n\x1b[31mError: ${msg.message}\x1b[0m\n`);
          break;
        case 'done':
          process.stdout.write('\n');
          ws.close();
          resolve();
          break;
      }
    });

    ws.send(JSON.stringify({
      type: 'chat',
      messages,
      modelId: flags.model,
    }));
  });
}

async function main() {
  try {
    switch (cmd) {
      case 'serve':
        await cmdServe(args.slice(1));
        break;
      case 'chat':
        await cmdChat(args.slice(1));
        break;
      case 'health':
        await cmdHealth();
        break;
      case 'tools':
        await cmdTools();
        break;
      case 'sessions':
        await cmdSessions();
        break;
      case 'skills':
        await cmdSkills();
        break;
      case 'plugins':
        await cmdPlugins();
        break;
      case 'reload':
        await cmdReload();
        break;
      case 'help':
      case '--help':
      case '-h':
        printHelp();
        break;
      default:
        console.error(`Unknown command: ${cmd}`);
        printHelp();
        process.exit(1);
    }
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

main();
