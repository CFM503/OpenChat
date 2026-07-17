#!/usr/bin/env node
/**
 * Pre-flight port occupancy check for OpenChat.
 *
 * Usage:
 *   node scripts/check-ports.mjs              # check 3000 + 3001 (or env)
 *   node scripts/check-ports.mjs --frontend   # only frontend
 *   node scripts/check-ports.mjs --backend    # only backend
 *   node scripts/check-ports.mjs --soft       # warn only, never exit 1
 *
 * Env:
 *   OPENCHAT_PORT       backend (default 3001)
 *   OPENCHAT_FRONTEND_PORT  frontend (default 3000)
 */

import net from 'node:net';

const FRONTEND_PORT = parseInt(process.env.OPENCHAT_FRONTEND_PORT || '3000', 10);
const BACKEND_PORT = parseInt(process.env.OPENCHAT_PORT || '3001', 10);

const args = new Set(process.argv.slice(2));
const soft = args.has('--soft');
const onlyFrontend = args.has('--frontend');
const onlyBackend = args.has('--backend');

/**
 * @param {number} port
 * @returns {Promise<boolean>} true if port is in use
 */
export function checkPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (err) => {
      resolve(/** @type {NodeJS.ErrnoException} */ (err).code === 'EADDRINUSE');
    });
    server.once('listening', () => {
      server.close(() => resolve(false));
    });
    // Bind IPv4 explicitly so Windows dual-stack doesn't hide conflicts
    server.listen(port, '0.0.0.0');
  });
}

function killHints(port) {
  const isWin = process.platform === 'win32';
  if (isWin) {
    return [
      `  Windows:`,
      `    netstat -ano | findstr :${port}`,
      `    taskkill /F /PID <PID>`,
    ].join('\n');
  }
  return [
    `  Unix:`,
    `    lsof -i :${port}   # or: ss -lptn 'sport = :${port}'`,
    `    kill -9 <PID>`,
  ].join('\n');
}

function banner(lines) {
  const bar = '='.repeat(62);
  console.error(`\n${bar}`);
  for (const line of lines) console.error(line);
  console.error(`${bar}\n`);
}

async function main() {
  const checks = [];
  if (!onlyBackend) checks.push({ name: 'Frontend (Vite)', port: FRONTEND_PORT, role: 'frontend' });
  if (!onlyFrontend) checks.push({ name: 'Backend (API/WS)', port: BACKEND_PORT, role: 'backend' });

  /** @type {Array<{ name: string; port: number; role: string }>} */
  const busy = [];
  for (const c of checks) {
    if (await checkPortInUse(c.port)) busy.push(c);
  }

  if (busy.length === 0) {
    if (!args.has('--quiet')) {
      console.log(
        `✓ Ports free: ${checks.map((c) => `${c.port} (${c.role})`).join(', ')}`,
      );
    }
    process.exit(0);
  }

  const lines = [
    `❌ Port${busy.length > 1 ? 's' : ''} already in use — OpenChat cannot start cleanly:`,
    '',
  ];
  for (const b of busy) {
    lines.push(`  • ${b.name} → localhost:${b.port}`);
  }
  lines.push('');
  for (const b of busy) {
    lines.push(killHints(b.port));
    lines.push('');
  }
  lines.push('  Or set different ports:');
  lines.push('    set OPENCHAT_FRONTEND_PORT=3100');
  lines.push('    set OPENCHAT_PORT=3101');
  lines.push('    npm run dev:all');

  banner(lines);

  if (soft) {
    process.exit(0);
  }
  process.exit(1);
}

// Only run when executed directly (not imported)
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('check-ports.mjs') ||
    process.argv[1].includes('check-ports'));

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
