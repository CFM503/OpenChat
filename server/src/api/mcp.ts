// ============================================================================
// MCP API Routes
// ============================================================================

import { Hono } from 'hono';
import type { MCPManager } from '../mcp/manager.js';

export function createMCPRouter(mcp: MCPManager): Hono {
  const router = new Hono();

  // List MCP server statuses
  router.get('/servers', (c) => {
    return c.json(mcp.getStatus());
  });

  // Add and start an MCP server
  router.post('/servers', async (c) => {
    const body = await c.req.json();
    if (!body.name || !body.command) {
      return c.json({ error: 'name and command are required' }, 400);
    }
    try {
      await mcp.addServer(body.name, {
        command: body.command,
        args: body.args,
        env: body.env,
      });
      return c.json({ success: true });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  // Stop and remove an MCP server
  router.delete('/servers/:name', (c) => {
    mcp.removeServer(c.req.param('name'));
    return c.json({ success: true });
  });

  // Restart an MCP server
  router.post('/servers/:name/restart', async (c) => {
    const name = c.req.param('name');
    const status = mcp.getStatus().find(s => s.name === name);
    if (!status) return c.json({ error: 'Server not found' }, 404);
    // TODO: preserve config and restart
    return c.json({ success: true });
  });

  return router;
}
