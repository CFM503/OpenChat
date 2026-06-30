// ============================================================================
// Plugin System — Loader
// ============================================================================

import * as fs from 'fs/promises';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type { PluginManifest, PluginModule, InstalledPlugin } from './types.js';
import type { ToolDefinition, ToolContext } from '../tools/types.js';
import type { ToolResult } from '../types.js';
import * as registry from '../tools/registry.js';

export class PluginManager {
  private plugins: Map<string, InstalledPlugin> = new Map();
  private pluginDir: string;
  private registry: typeof registry;
  private registeredTools: Map<string, string> = new Map(); // toolName → pluginName

  constructor(pluginDir: string, reg: typeof registry) {
    this.pluginDir = pluginDir;
    this.registry = reg;
  }

  /**
   * Scan plugin directory and load all valid plugins.
   */
  async loadAll(): Promise<void> {
    try {
      await fs.mkdir(this.pluginDir, { recursive: true });
      const entries = await fs.readdir(this.pluginDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dirPath = path.join(this.pluginDir, entry.name);
        try {
          await this.loadPlugin(dirPath);
        } catch (err: any) {
          console.warn(`[plugin:${entry.name}] Failed to load:`, err.message);
        }
      }
    } catch {
      // Plugin dir doesn't exist yet — fine
    }
  }

  /**
   * Load a single plugin from a directory.
   */
  async loadPlugin(dirPath: string): Promise<void> {
    const manifestPath = path.join(dirPath, 'manifest.json');
    const manifestContent = await fs.readFile(manifestPath, 'utf-8');
    const manifest: PluginManifest = JSON.parse(manifestContent);

    if (!manifest.name || !manifest.tools || !Array.isArray(manifest.tools)) {
      throw new Error('Invalid manifest: name and tools[] required');
    }

    const plugin: InstalledPlugin = {
      manifest,
      dirPath,
      enabled: true,
    };

    this.plugins.set(manifest.name, plugin);

    // Load and register tools
    const indexPath = path.join(dirPath, 'index.js');
    const fileUrl = pathToFileURL(indexPath).href;
    const module: PluginModule = await import(fileUrl);
    const defaultExport = module.default ?? module;

    if (!defaultExport || typeof defaultExport !== 'object' || !defaultExport.tools) {
      throw new Error('Plugin must export { tools: { ... } }');
    }

    for (const toolDecl of manifest.tools) {
      const impl = defaultExport.tools[toolDecl.name];
      if (!impl || typeof impl.execute !== 'function') {
        console.warn(`[plugin:${manifest.name}] Tool "${toolDecl.name}" has no implementation, skipping`);
        continue;
      }

      const prefixedName = `plugin_${manifest.name}_${toolDecl.name}`;
      const toolDef: ToolDefinition = {
        name: prefixedName,
        description: `[Plugin:${manifest.name}] ${toolDecl.description}`,
        inputSchema: toolDecl.inputSchema,
        isReadOnly: toolDecl.isReadOnly ?? false,
        isDestructive: toolDecl.isDestructive ?? true,
        execute: async (input: unknown, ctx: ToolContext): Promise<ToolResult> => {
          const start = Date.now();
          try {
            const result = await impl.execute(input, {
              workingDirectory: ctx.workingDirectory,
              sessionId: ctx.sessionId,
            });
            return {
              success: result.success,
              output: result.output,
              error: result.error,
              duration: Date.now() - start,
            };
          } catch (err: any) {
            return {
              success: false,
              output: '',
              error: err.message,
              duration: Date.now() - start,
            };
          }
        },
      };

      registry.register(toolDef);
      this.registeredTools.set(prefixedName, manifest.name);
    }

    console.log(`[plugin:${manifest.name}] Loaded ${manifest.tools.length} tools`);
  }

  /**
   * Unload a plugin and unregister its tools.
   */
  unload(name: string): void {
    const plugin = this.plugins.get(name);
    if (!plugin) return;

    // Unregister tools
    for (const [toolName, pluginName] of this.registeredTools) {
      if (pluginName === name) {
        registry.unregister(toolName);
        this.registeredTools.delete(toolName);
      }
    }

    this.plugins.delete(name);
  }

  /**
   * Get all installed plugins.
   */
  getAll(): InstalledPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get a plugin by name.
   */
  get(name: string): InstalledPlugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * Get tool names registered by plugins.
   */
  getToolNames(): string[] {
    return Array.from(this.registeredTools.keys());
  }
}
