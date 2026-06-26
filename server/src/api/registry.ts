// ============================================================================
// Registry API Routes
// ============================================================================

import { Hono } from 'hono';
import type { RegistryClient } from '../registry/client.js';
import type { RegistryInstaller } from '../registry/installer.js';

export function createRegistryRouter(client: RegistryClient, installer: RegistryInstaller): Hono {
  const router = new Hono();

  // Search packages across all registries
  router.get('/search', async (c) => {
    const query = c.req.query('q') ?? '';
    try {
      const results = await client.search(query);
      return c.json({ packages: results });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  // Get all available packages
  router.get('/packages', async (c) => {
    try {
      const results = await client.listAll();
      return c.json({ packages: results });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  // Get package details
  router.get('/packages/:name', async (c) => {
    const name = c.req.param('name');
    const pkg = await client.getPackage(name);
    if (!pkg) return c.json({ error: 'Package not found' }, 404);
    return c.json(pkg);
  });

  // Install a package
  router.post('/install', async (c) => {
    const body = await c.req.json();
    if (!body.name) return c.json({ error: 'name is required' }, 400);
    const result = await installer.install(body.name);
    return c.json(result, result.success ? 200 : 400);
  });

  // Uninstall a package
  router.delete('/uninstall/:name', async (c) => {
    const name = c.req.param('name');
    const result = await installer.uninstall(name);
    return c.json(result, result.success ? 200 : 400);
  });

  // Update a package
  router.post('/update', async (c) => {
    const body = await c.req.json();
    if (!body.name) return c.json({ error: 'name is required' }, 400);
    const result = await installer.update(body.name);
    return c.json(result, result.success ? 200 : 400);
  });

  // Check for updates
  router.get('/updates', async (c) => {
    const updates = await installer.checkUpdates();
    return c.json({ updates });
  });

  // List installed packages
  router.get('/installed', async (c) => {
    const installed = await installer.getInstalled();
    return c.json({ installed });
  });

  return router;
}
