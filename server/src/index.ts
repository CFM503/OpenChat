// ============================================================================
// OpenChat Backend — thin entry (Hono + WebSocket)
// ============================================================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { WebSocketServer } from 'ws';
import path from 'path';
import fs from 'fs';

import { createRuntime, bootstrapRuntime } from './runtime.js';
import { registerRoutes } from './routes/index.js';
import { attachWebSocketHandlers } from './ws/handler.js';
import { assertPortFree } from './portCheck.js';

const rt = createRuntime();

// Fail fast if OPENCHAT_PORT is taken (before bind)
await assertPortFree(rt.port, 'OpenChat backend');

const app = new Hono();

app.use(
  '/*',
  cors({
    origin: [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      `http://localhost:${rt.port}`,
      `http://127.0.0.1:${rt.port}`,
      // allow custom frontend port via env
      ...(process.env.OPENCHAT_FRONTEND_PORT
        ? [
            `http://localhost:${process.env.OPENCHAT_FRONTEND_PORT}`,
            `http://127.0.0.1:${process.env.OPENCHAT_FRONTEND_PORT}`,
          ]
        : []),
    ],
  }),
);

registerRoutes(app, rt);

// Production: serve built frontend
const distDir = path.resolve(process.cwd(), 'dist');
if (fs.existsSync(distDir)) {
  app.use('/assets/*', serveStatic({ root: './dist' }));
  app.get('/favicon.svg', serveStatic({ root: './dist' }));
  app.get('/icons.svg', serveStatic({ root: './dist' }));
  app.get('/', async (c) => {
    return c.html(fs.readFileSync(path.join(distDir, 'index.html'), 'utf-8'));
  });
}

const httpServer = serve({ fetch: app.fetch, port: rt.port }, async (info) => {
  console.log(`\n  ✨ OpenChat Backend running at http://localhost:${info.port}`);
  console.log(`  📂 Working directory: ${rt.workingDirectory}`);

  await bootstrapRuntime(rt);

  console.log(`  🔧 Tools: ${rt.tools.getAll().map(t => t.name).join(', ')}`);
  const skillList = rt.skills.getAll();
  console.log(`  ⚡ Skills (${skillList.length}): ${skillList.map(s => s.shortcut).join(', ')}`);
  const plugins = rt.pluginManager.getAll();
  if (plugins.length) {
    console.log(`  🧩 Plugins: ${plugins.map(p => `${p.name}[${p.format}]`).join(', ')}`);
  }
  const mcpTools = rt.mcpManager.getTools();
  if (mcpTools.length) {
    console.log(`  🔌 MCP tools: ${mcpTools.map(t => t.name).join(', ')}`);
  }
  const active = rt.providers.getActiveModel();
  if (active) {
    console.log(`  🤖 Active model: ${active.name} (${active.provider})`);
  } else {
    console.log(`  ⚠️  No model configured — open the web UI to set one up`);
  }
  console.log('');
});

// Surface listen errors that slip past pre-check (race)
(httpServer as any).on?.('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Failed to bind port ${rt.port}: already in use (EADDRINUSE).`);
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});

const wss = new WebSocketServer({ server: httpServer as any, path: '/ws' });
attachWebSocketHandlers(wss, rt);

function shutdown() {
  console.log('\n  🛑 Shutting down...');
  rt.mcpManager.stopAll();
  wss.clients.forEach(ws => ws.close());
  (httpServer as any).close?.(() => {
    console.log('  ✅ Server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export { app, httpServer, wss, rt };
