// ============================================================================
// Port occupancy check — fail fast with clear kill instructions
// ============================================================================

import net from 'net';

/** @returns true if something is already listening on this host:port */
function checkHostPortInUse(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (err: NodeJS.ErrnoException) => {
      // Busy only on EADDRINUSE; other codes (e.g. no IPv6) → free on this stack
      resolve(err.code === 'EADDRINUSE');
    });
    server.once('listening', () => {
      server.close(() => resolve(false));
    });
    try {
      server.listen(port, host);
    } catch {
      resolve(false);
    }
  });
}

/**
 * True if port is taken on IPv4 and/or IPv6.
 * Windows Node often listens on `::`; checking only 0.0.0.0 misses conflicts.
 */
export async function checkPortInUse(port: number): Promise<boolean> {
  for (const host of ['0.0.0.0', '127.0.0.1', '::', '::1'] as const) {
    if (await checkHostPortInUse(port, host)) return true;
  }
  return false;
}

function killHints(port: number): string {
  if (process.platform === 'win32') {
    return [
      `  Windows:`,
      `    netstat -ano | findstr :${port}`,
      `    taskkill /F /PID <PID>`,
    ].join('\n');
  }
  return [
    `  Unix:`,
    `    lsof -i :${port}`,
    `    kill -9 <PID>`,
  ].join('\n');
}

/**
 * If port is busy, print a banner and exit(1).
 * Call before binding the HTTP server.
 */
export async function assertPortFree(
  port: number,
  label = 'Backend',
): Promise<void> {
  const busy = await checkPortInUse(port);
  if (!busy) return;

  const bar = '='.repeat(62);
  console.error(`\n${bar}`);
  console.error(`❌ ${label} port ${port} is already in use.`);
  console.error(``);
  console.error(killHints(port));
  console.error(``);
  console.error(`  Or use another port:`);
  console.error(`    set OPENCHAT_PORT=${port + 10}`);
  console.error(`    npm run dev:server`);
  console.error(`${bar}\n`);
  process.exit(1);
}
