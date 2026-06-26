// ============================================================================
// Plugin API Routes
// ============================================================================

import { Hono } from 'hono';
import type { PluginManager } from '../plugins/loader.js';

export function createPluginRouter(plugins: PluginManager): Hono {
  const router = new Hono();

  // List all installed plugins
  router.get('/', (c) => {
    return c.json(plugins.getAll().map(p => ({
      name: p.manifest.name,
      version: p.manifest.version,
      description: p.manifest.description,
      author: p.manifest.author,
      enabled: p.enabled,
      tools: p.manifest.tools.map(t => ({
        name: `plugin_${p.manifest.name}_${t.name}`,
        description: t.description,
        isReadOnly: t.isReadOnly ?? false,
        isDestructive: t.isDestructive ?? true,
      })),
    })));
  });

  // Unload a plugin
  router.delete('/:name', (c) => {
    const name = c.req.param('name');
    plugins.unload(name);
    return c.json({ success: true });
  });

  return router;
}
