// ============================================================================
// HTTP route registration
// ============================================================================

import { Hono } from 'hono';
import type { Runtime } from '../runtime.js';
import { reloadExtensions } from '../runtime.js';
import { listTree, readFileContent, writeFileContent } from '../fsApi.js';
import { buildEnvContext } from '../envContext.js';
import {
  parseModelsListResponse,
  inferContextWindowFromId,
  formatContextLabel,
} from '../providers/inferContextWindow.js';

export function registerRoutes(app: Hono, rt: Runtime): void {
  const {
    config, sessions, providers, skills, mcpManager, pluginManager,
    registryInstaller, registryClient, tools, workingDirectory,
  } = rt;

  // ── Config ──────────────────────────────────────────────────────────
  app.get('/api/config', (c) => c.json(config.load()));
  app.post('/api/config', async (c) => {
    const body = await c.req.json();
    config.save(body);
    return c.json({ success: true });
  });

  // ── Sessions ────────────────────────────────────────────────────────
  app.get('/api/sessions', (c) => c.json(sessions.list()));
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
    sessions.update(c.req.param('id'), body.messages ?? [], body.title);
    return c.json({ success: true });
  });
  app.patch('/api/sessions/:id', async (c) => {
    const body = await c.req.json();
    if (!body.title) return c.json({ error: 'title is required' }, 400);
    const ok = sessions.rename(c.req.param('id'), body.title);
    if (!ok) return c.json({ error: 'Not found' }, 404);
    return c.json({ success: true });
  });
  app.delete('/api/sessions/:id', (c) => {
    sessions.delete(c.req.param('id'));
    return c.json({ success: true });
  });

  // ── Filesystem ──────────────────────────────────────────────────────
  app.get('/api/fs/tree', async (c) => {
    const dir = c.req.query('path') || '.';
    const depth = parseInt(c.req.query('depth') || '3', 10);
    try {
      const tree = await listTree(dir, workingDirectory, config, Math.min(depth, 5));
      return c.json({ root: workingDirectory, tree });
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  });
  app.get('/api/fs/file', async (c) => {
    const filePath = c.req.query('path');
    if (!filePath) return c.json({ error: 'path required' }, 400);
    try {
      return c.json(await readFileContent(filePath, workingDirectory, config));
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  });
  app.put('/api/fs/file', async (c) => {
    const body = await c.req.json();
    if (!body.path || typeof body.content !== 'string') {
      return c.json({ error: 'path and content are required' }, 400);
    }
    try {
      return c.json(await writeFileContent(body.path, body.content, workingDirectory, config));
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  });

  // ── Health / tools / discover ───────────────────────────────────────
  app.get('/api/health', (c) => {
    const env = buildEnvContext(workingDirectory);
    return c.json({
      status: 'ok',
      tools: tools.getAll().map(t => t.name),
      workingDirectory,
      canMakeRequest: providers.canMakeRequest(),
      skills: skills.getAll().length,
      plugins: pluginManager.getAll().length,
      environment: {
        platform: env.platformLabel,
        shell: env.shell,
        home: env.homeDir,
        desktop: env.desktopDir,
        documents: env.documentsDir,
        downloads: env.downloadsDir,
      },
    });
  });

  app.get('/api/tools', (c) =>
    c.json(
      tools.getAll().map(t => ({
        name: t.name,
        description: t.description,
        isReadOnly: t.isReadOnly,
        isDestructive: t.isDestructive,
      })),
    ),
  );

  app.get('/api/discover-models', async (c) => {
    const url = c.req.query('url');
    if (!url) return c.json({ error: 'url parameter required' }, 400);
    const apiKey = c.req.query('apiKey')?.trim() || c.req.header('x-api-key')?.trim();
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (apiKey) {
        // OpenAI-compatible + Anthropic-style keys both accepted by many gateways as Bearer
        headers.Authorization = `Bearer ${apiKey}`;
        if (apiKey.startsWith('sk-ant')) headers['x-api-key'] = apiKey;
      }
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(12000),
        headers,
      });
      if (!resp.ok) return c.json({ error: `HTTP ${resp.status}` }, resp.status as any);
      const data = await resp.json() as any;
      const models = parseModelsListResponse(data, url);
      return c.json({
        models,
        modelIds: models.map(m => m.id),
      });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  /** Infer context window for a model id when API does not list it */
  app.get('/api/infer-context', (c) => {
    const model = c.req.query('model') || '';
    const endpoint = c.req.query('endpoint') || '';
    const contextWindow = inferContextWindowFromId(model, endpoint);
    return c.json({
      contextWindow: contextWindow ?? null,
      source: contextWindow != null ? 'inferred' : 'unknown',
      label: contextWindow != null ? formatContextLabel(contextWindow) : null,
    });
  });

  // ── Skills ──────────────────────────────────────────────────────────
  const skillsApp = new Hono();
  skillsApp.get('/', (c) =>
    c.json(
      skills.getAll().map(s => ({
        name: s.pluginName ? `${s.pluginName}:${s.name}` : s.name,
        description: s.description,
        shortcut: s.shortcut,
        category: s.category,
        builtin: !!s.builtin || s.source === 'builtin',
        source: s.source,
        pluginName: s.pluginName,
        userInvocable: s.userInvocable,
        disableModelInvocation: s.disableModelInvocation,
        argumentHint: s.argumentHint,
        whenToUse: s.whenToUse,
      })),
    ),
  );
  skillsApp.get('/catalog', (c) => c.json({ catalog: skills.getCatalog(true) }));
  skillsApp.post('/reload', async (c) => {
    const r = await reloadExtensions(rt);
    return c.json({ success: true, ...r });
  });
  skillsApp.get('/:name', (c) => {
    const skill = skills.get(c.req.param('name'));
    if (!skill) return c.json({ error: 'Skill not found' }, 404);
    return c.json({
      name: skill.name,
      description: skill.description,
      shortcut: skill.shortcut,
      category: skill.category,
      builtin: skill.builtin,
      source: skill.source,
      content: skill.content,
      argumentHint: skill.argumentHint,
      disableModelInvocation: skill.disableModelInvocation,
      userInvocable: skill.userInvocable,
    });
  });
  skillsApp.post('/:name/expand', async (c) => {
    const skill = skills.get(c.req.param('name'));
    if (!skill) return c.json({ error: 'Skill not found' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const expanded = await skills.expand(skill, {
      selection: body.selection,
      arguments: body.arguments || body.args || '',
      projectDir: workingDirectory,
      runShell: body.runShell !== false,
    });
    return c.json({ expanded });
  });
  skillsApp.post('/', async (c) => {
    const body = await c.req.json();
    if (!body.name || !body.content) {
      return c.json({ error: 'name and content are required' }, 400);
    }
    try {
      const skill = await skills.create(
        {
          name: body.name,
          description: body.description || '',
          shortcut: body.shortcut || `/${body.name}`,
          category: body.category,
          disableModelInvocation: body.disableModelInvocation,
        },
        body.content,
      );
      return c.json({ success: true, name: skill.name, shortcut: skill.shortcut }, 201);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });
  skillsApp.delete('/:name', async (c) => {
    const deleted = await skills.delete(c.req.param('name'));
    if (!deleted) return c.json({ error: 'Skill not found or is built-in/plugin' }, 404);
    return c.json({ success: true });
  });
  app.route('/api/skills', skillsApp);

  // ── MCP ─────────────────────────────────────────────────────────────
  const mcpApp = new Hono();
  mcpApp.get('/servers', (c) => c.json(mcpManager.getStatus()));
  mcpApp.post('/servers', async (c) => {
    const body = await c.req.json();
    if (!body.name || !body.command) return c.json({ error: 'name and command are required' }, 400);
    try {
      await mcpManager.addServer(body.name, {
        command: body.command,
        args: body.args,
        env: body.env,
      });
      return c.json({ success: true });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });
  mcpApp.delete('/servers/:name', (c) => {
    mcpManager.removeServer(c.req.param('name'));
    return c.json({ success: true });
  });
  mcpApp.post('/servers/:name/restart', async (c) => {
    const name = c.req.param('name');
    try {
      await mcpManager.restartServer(name);
      return c.json({
        success: true,
        status: mcpManager.getStatus().find(s => s.name === name),
      });
    } catch (err: any) {
      return c.json({ error: err.message }, 404);
    }
  });
  app.route('/api/mcp', mcpApp);

  // ── Plugins ─────────────────────────────────────────────────────────
  const pluginsApp = new Hono();
  pluginsApp.get('/', (c) =>
    c.json(
      pluginManager.getAll().map(p => ({
        name: p.name,
        version: p.version,
        description: p.description,
        author: p.author,
        enabled: p.enabled,
        format: p.format,
        skills: p.skillNames,
        agents: p.agentNames,
        tools: [
          ...p.toolNames.map(name => ({
            name,
            description: tools.get(name)?.description || name,
            isReadOnly: tools.get(name)?.isReadOnly ?? false,
            isDestructive: tools.get(name)?.isDestructive ?? true,
          })),
          ...p.skillNames.map(s => ({
            name: `skill:${p.name}:${s}`,
            description: `Skill /${p.name}:${s}`,
            isReadOnly: true,
            isDestructive: false,
          })),
        ],
      })),
    ),
  );
  pluginsApp.get('/agents', (c) => c.json(pluginManager.getAgents()));
  pluginsApp.post('/reload', async (c) => {
    const r = await reloadExtensions(rt);
    return c.json({ success: true, ...r });
  });
  pluginsApp.delete('/:name', (c) => {
    pluginManager.unload(c.req.param('name'));
    return c.json({ success: true });
  });
  app.route('/api/plugins', pluginsApp);

  // ── Registry marketplace ────────────────────────────────────────────
  const registryApp = new Hono();
  registryApp.get('/search', async (c) => {
    try {
      return c.json({ packages: await registryClient.search(c.req.query('q') ?? '') });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });
  registryApp.get('/packages', async (c) => {
    try {
      return c.json({ packages: await registryClient.search('') });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });
  registryApp.get('/packages/:name', async (c) => {
    const pkg = await registryClient.getPackage(c.req.param('name'));
    if (!pkg) return c.json({ error: 'Package not found' }, 404);
    return c.json(pkg);
  });
  registryApp.post('/install', async (c) => {
    const body = await c.req.json();
    if (!body.name) return c.json({ error: 'name is required' }, 400);
    const result = await registryInstaller.install(body.name);
    return c.json(result, result.success ? 200 : 400);
  });
  registryApp.delete('/uninstall/:name', async (c) => {
    const result = await registryInstaller.uninstall(c.req.param('name'));
    return c.json(result, result.success ? 200 : 400);
  });
  registryApp.post('/update', async (c) => {
    const body = await c.req.json();
    if (!body.name) return c.json({ error: 'name is required' }, 400);
    const result = await registryInstaller.install(body.name);
    return c.json(result, result.success ? 200 : 400);
  });
  registryApp.get('/updates', async (c) =>
    c.json({ updates: await registryInstaller.checkUpdates() }),
  );
  registryApp.get('/installed', async (c) =>
    c.json({ installed: await registryInstaller.getInstalled() }),
  );
  app.route('/api/registry', registryApp);
}
