// ============================================================================
// OpenChat Backend Server — Hono + WebSocket Gateway
// ============================================================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { WebSocketServer, WebSocket } from 'ws';

import { ConfigManager, validateConfig, sanitizeError } from './configManager.js';
import { ProviderGateway } from './providerGateway.js';
import { AgentLoop } from './agentLoop.js';
import { SessionManager } from './sessionManager.js';
import { ToolRegistry } from './tools/registry.js';
import { BashTool } from './tools/BashTool.js';
import { FileReadTool, FileWriteTool, FileEditTool } from './tools/FileTool.js';
import { GrepTool, GlobTool, setGrepGlobToolConfig } from './tools/GrepGlobTool.js';
import { GitTool } from './tools/GitTool.js';
import { setFileToolConfig } from './tools/FileTool.js';
import { setBashToolConfig } from './tools/BashTool.js';
import { SkillManager } from './skills/loader.js';
import { createSkillsRouter } from './api/skills.js';
import { MCPManager } from './mcp/manager.js';
import { createMCPRouter } from './api/mcp.js';
import { PluginManager } from './plugins/loader.js';
import { createPluginRouter } from './api/plugins.js';
import { RegistryClient } from './registry/client.js';
import { RegistryInstaller } from './registry/installer.js';
import { createRegistryRouter } from './api/registry.js';

import type { ClientMessage, ServerMessage } from './types.js';

// ── Initialization ──────────────────────────────────────────────────────────

const WORKING_DIRECTORY = process.env.OPENCHAT_CWD ?? process.cwd();
const PORT = parseInt(process.env.OPENCHAT_PORT ?? '3001', 10);

const config = new ConfigManager(WORKING_DIRECTORY);
const providers = new ProviderGateway(config);
const sessions = new SessionManager();
const tools = new ToolRegistry();

// Share config with tools for allowedDirectories support
setFileToolConfig(config);
setBashToolConfig(config);
setGrepGlobToolConfig(config);

// Register all tools
tools.register(BashTool);
tools.register(FileReadTool);
tools.register(FileWriteTool);
tools.register(FileEditTool);
tools.register(GrepTool);
tools.register(GlobTool);
tools.register(GitTool);

// Skill and MCP managers
const userHome = process.env.HOME ?? process.env.USERPROFILE ?? WORKING_DIRECTORY;
const openchatDir = `${userHome}/.openchat`;
const skills = new SkillManager(`${openchatDir}/skills`);
const mcpManager = new MCPManager(config, tools);
const pluginManager = new PluginManager(`${openchatDir}/plugins`, tools);

// Registry system
const cfg = config.load();
const registries = (cfg as any).registries as string[] ?? [];
const registryClient = new RegistryClient(registries, cfg.proxyUrl);
const registryInstaller = new RegistryInstaller(
  registryClient,
  `${openchatDir}/skills`,
  `${openchatDir}/plugins`,
  skills,
  pluginManager,
);

const agentLoop = new AgentLoop(providers, tools, WORKING_DIRECTORY);

// ── HTTP API ────────────────────────────────────────────────────────────────

const app = new Hono();

// H-1: Restrict CORS to localhost origins only
app.use('/*', cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
}));

// Config endpoints (compatible with existing Vite plugin)
// GET returns full config — CORS restriction (localhost-only) is the protection layer.
// Do NOT mask API keys here: the frontend needs real keys for direct API mode,
// and masked values ("***") would corrupt the config on round-trip save.
app.get('/api/config', (c) => {
  return c.json(config.load());
});

app.post('/api/config', async (c) => {
  const body = await c.req.json();
  // C-3: Validate config before writing
  const error = validateConfig(body);
  if (error) {
    return c.json({ error }, 400);
  }
  // Merge with existing config to preserve API keys not included in the update.
  // This prevents accidental key loss when the frontend sends a partial config.
  config.saveWithMerge(body);
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

app.post('/api/sessions', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const session = sessions.create(body.title);
  return c.json({ id: session.id, title: session.title });
});

app.put('/api/sessions/:id', async (c) => {
  const body = await c.req.json();
  sessions.update(c.req.param('id'), body.messages ?? []);
  return c.json({ success: true });
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

// Model discovery endpoint (proxies to avoid CORS)
app.get('/api/discover-models', async (c) => {
  const url = c.req.query('url');
  if (!url) return c.json({ error: 'url parameter required' }, 400);
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return c.json({ error: `HTTP ${resp.status}` }, resp.status as any);
    const data = await resp.json();
    // Normalize response: OpenAI format returns {data: [{id: ...}]}
    // Ollama format returns {models: [{name: ...}]}
    let models: string[] = [];
    if (data.data && Array.isArray(data.data)) {
      models = data.data.map((m: any) => m.id).filter(Boolean);
    } else if (data.models && Array.isArray(data.models)) {
      models = data.models.map((m: any) => m.name || m.id).filter(Boolean);
    }
    return c.json({ models: models.sort() });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
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

// Skills API
app.route('/api/skills', createSkillsRouter(skills));

// MCP API
app.route('/api/mcp', createMCPRouter(mcpManager));

// Plugin API
app.route('/api/plugins', createPluginRouter(pluginManager));

// Registry API
app.route('/api/registry', createRegistryRouter(registryClient, registryInstaller));

// ── HTTP Server + WebSocket ─────────────────────────────────────────────────

const httpServer = serve({ fetch: app.fetch, port: PORT }, async (info) => {
  console.log(`\n  ✨ OpenChat Backend running at http://localhost:${info.port}`);
  console.log(`  📂 Working directory: ${WORKING_DIRECTORY}`);
  console.log(`  🔧 Tools: ${tools.getAll().map(t => t.name).join(', ')}`);

  // Load skills
  await skills.load();
  console.log(`  ⚡ Skills: ${skills.getAll().map(s => s.shortcut).join(', ')}`);

  // Start MCP servers
  await mcpManager.startAll();
  const mcpTools = mcpManager.getTools();
  if (mcpTools.length > 0) {
    console.log(`  🔌 MCP tools: ${mcpTools.map(t => t.name).join(', ')}`);
  }

  // Load plugins
  await pluginManager.loadAll();
  const pluginToolNames = pluginManager.getToolNames();
  if (pluginToolNames.length > 0) {
    console.log(`  🧩 Plugin tools: ${pluginToolNames.join(', ')}`);
  }

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
            // M-1: Sanitize error messages before sending to client
            ws.send(JSON.stringify({
              type: 'error',
              message: sanitizeError(err),
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

// L-3: Graceful shutdown
function shutdown() {
  console.log('\n  🛑 Shutting down...');
  mcpManager.stopAll();
  wss.clients.forEach(ws => ws.close());
  httpServer.close(() => {
    console.log('  ✅ Server closed');
    process.exit(0);
  });
  // Force exit after 5s
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export { app, httpServer, wss };
