// ============================================================================
// OpenChat Backend Server — Hono + WebSocket Gateway
// ============================================================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import path from 'path';

import { ConfigManager } from './configManager.js';
import { ProviderGateway } from './providerGateway.js';
import { AgentLoop } from './agentLoop.js';
import { SessionManager } from './sessionManager.js';
import { ToolRegistry } from './tools/registry.js';
import { BashTool } from './tools/BashTool.js';
import { FileReadTool, FileWriteTool, FileEditTool } from './tools/FileTool.js';
import { GrepTool, GlobTool } from './tools/GrepGlobTool.js';
import { GitTool } from './tools/GitTool.js';

import type { ClientMessage, ServerMessage } from './types.js';

// ── Initialization ──────────────────────────────────────────────────────────

const WORKING_DIRECTORY = process.env.OPENCHAT_CWD ?? process.cwd();
const PORT = parseInt(process.env.OPENCHAT_PORT ?? '3001', 10);

const config = new ConfigManager(WORKING_DIRECTORY);
const providers = new ProviderGateway(config);
const sessions = new SessionManager();
const tools = new ToolRegistry();

// Register all tools
tools.register(BashTool);
tools.register(FileReadTool);
tools.register(FileWriteTool);
tools.register(FileEditTool);
tools.register(GrepTool);
tools.register(GlobTool);
tools.register(GitTool);

const agentLoop = new AgentLoop(providers, tools, WORKING_DIRECTORY);

// ── HTTP API ────────────────────────────────────────────────────────────────

const app = new Hono();

app.use('/*', cors());

// Config endpoints (compatible with existing Vite plugin)
app.get('/api/config', (c) => {
  return c.json(config.load());
});

app.post('/api/config', async (c) => {
  const body = await c.req.json();
  config.save(body);
  return c.json({ success: true });
});

// Session endpoints
app.get('/api/sessions', (c) => {
  return c.json(sessions.list());
});

app.get('/api/sessions/:id', (c) => {
  const session = sessions.get(c.req.param('id'));
  if (!session) return c.json({ error: 'Not found' }, 404);
  return c.json(session);
});

app.delete('/api/sessions/:id', (c) => {
  sessions.delete(c.req.param('id'));
  return c.json({ success: true });
});

// Health check
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    tools: tools.getAll().map(t => t.name),
    workingDirectory: WORKING_DIRECTORY,
    canMakeRequest: providers.canMakeRequest(),
  });
});

// Tools listing
app.get('/api/tools', (c) => {
  return c.json(
    tools.getAll().map(t => ({
      name: t.name,
      description: t.description,
      isReadOnly: t.isReadOnly,
      isDestructive: t.isDestructive,
    }))
  );
});

// ── HTTP Server + WebSocket ─────────────────────────────────────────────────

const httpServer = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`\n  ✨ OpenChat Backend running at http://localhost:${info.port}`);
  console.log(`  📂 Working directory: ${WORKING_DIRECTORY}`);
  console.log(`  🔧 Tools: ${tools.getAll().map(t => t.name).join(', ')}`);
  const activeModel = providers.getActiveModel();
  if (activeModel) {
    console.log(`  🤖 Active model: ${activeModel.name} (${activeModel.provider})`);
  } else {
    console.log(`  ⚠️  No model configured — open the web UI to set one up`);
  }
  console.log('');
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (ws: WebSocket) => {
  console.log('[ws] Client connected');

  let currentAbort: AbortController | null = null;

  ws.on('message', async (data) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' } satisfies ServerMessage));
      return;
    }

    switch (msg.type) {
      case 'chat': {
        if (currentAbort) {
          currentAbort.abort();
        }
        currentAbort = new AbortController();

        // If no real API credentials, send error — frontend should use demo mode
        if (!providers.canMakeRequest(msg.modelId)) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'No API credentials configured. Use the Settings panel to add a model, or use demo mode.',
          } satisfies ServerMessage));
          ws.send(JSON.stringify({ type: 'done' } satisfies ServerMessage));
          break;
        }

        try {
          await agentLoop.run({
            messages: msg.messages,
            modelId: msg.modelId,
            signal: currentAbort.signal,
            onEvent: (event) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(event));
              }
            },
          });
        } catch (err: any) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'error',
              message: err.message,
            } satisfies ServerMessage));
            ws.send(JSON.stringify({ type: 'done' } satisfies ServerMessage));
          }
        }
        break;
      }

      case 'abort': {
        if (currentAbort) {
          currentAbort.abort();
          currentAbort = null;
        }
        break;
      }

      case 'ping': {
        ws.send(JSON.stringify({ type: 'pong' } satisfies ServerMessage));
        break;
      }
    }
  });

  ws.on('close', () => {
    console.log('[ws] Client disconnected');
    if (currentAbort) {
      currentAbort.abort();
      currentAbort = null;
    }
  });
});

export { app, httpServer, wss };
