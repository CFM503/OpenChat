// ============================================================================
// PluginManager — Claude Code plugins + legacy OpenChat tool plugins
//
// Claude layout:
//   my-plugin/
//     .claude-plugin/plugin.json   (optional)
//     skills/<name>/SKILL.md
//     commands/*.md
//     agents/*.md
//     hooks/hooks.json             (detected, logged)
//     .mcp.json                    (optional MCP servers)
//
// Legacy OpenChat layout:
//   my-plugin/
//     manifest.json
//     index.js
// ============================================================================

import * as fs from 'fs/promises';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type {
  ClaudePluginManifest,
  InstalledPlugin,
  LegacyPluginManifest,
  PluginAgent,
  PluginFormat,
  PluginModule,
} from './types.js';
import type { ToolDefinition, ToolContext } from '../tools/types.js';
import type { ToolResult } from '../types.js';
import type { SkillManager } from '../skills/loader.js';
import * as registry from '../tools/registry.js';
import { parseFrontmatter } from '../skills/parse.js';

export class PluginManager {
  private plugins = new Map<string, InstalledPlugin>();
  private agents = new Map<string, PluginAgent>();
  private pluginDir: string;
  private claudePluginDir: string;
  private registeredTools = new Map<string, string>(); // toolName → pluginName
  private skillManager: SkillManager | null = null;

  constructor(pluginDir: string, _reg?: typeof registry) {
    this.pluginDir = pluginDir;
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    this.claudePluginDir = path.join(home, '.claude', 'plugins');
  }

  setSkillManager(sm: SkillManager): void {
    this.skillManager = sm;
  }

  /**
   * Scan plugin directories and load all valid plugins.
   */
  async loadAll(): Promise<void> {
    await this.scanDir(this.pluginDir);
    // Also scan ~/.claude/plugins if different
    if (path.resolve(this.claudePluginDir) !== path.resolve(this.pluginDir)) {
      await this.scanDir(this.claudePluginDir);
    }
  }

  private async scanDir(root: string): Promise<void> {
    try {
      await fs.mkdir(root, { recursive: true });
      const entries = await fs.readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.')) continue;
        const dirPath = path.join(root, entry.name);
        try {
          await this.loadPlugin(dirPath);
        } catch (err: any) {
          console.warn(`[plugin:${entry.name}] Failed to load:`, err.message);
        }
      }
    } catch {
      // dir missing
    }
  }

  /**
   * Load a single plugin directory (Claude or legacy).
   */
  async loadPlugin(dirPath: string): Promise<InstalledPlugin> {
    const dirName = path.basename(dirPath);

    // Detect format
    const claudeManifestPath = path.join(dirPath, '.claude-plugin', 'plugin.json');
    const legacyManifestPath = path.join(dirPath, 'manifest.json');
    const hasSkills = await dirExists(path.join(dirPath, 'skills'));
    const hasCommands = await dirExists(path.join(dirPath, 'commands'));
    const hasAgents = await dirExists(path.join(dirPath, 'agents'));
    const hasRootSkill = await fileExists(path.join(dirPath, 'SKILL.md'));
    const hasMcp = await fileExists(path.join(dirPath, '.mcp.json'));
    const hasLegacyIndex = await fileExists(path.join(dirPath, 'index.js'));

    let claudeMeta: ClaudePluginManifest = {};
    try {
      claudeMeta = JSON.parse(await fs.readFile(claudeManifestPath, 'utf-8'));
    } catch {
      // optional
    }

    let legacyMeta: LegacyPluginManifest | null = null;
    try {
      legacyMeta = JSON.parse(await fs.readFile(legacyManifestPath, 'utf-8'));
    } catch {
      // optional
    }

    const isClaude =
      Object.keys(claudeMeta).length > 0 ||
      hasSkills ||
      hasCommands ||
      hasAgents ||
      hasRootSkill ||
      hasMcp;
    const isLegacy = !!(legacyMeta?.tools && hasLegacyIndex);

    if (!isClaude && !isLegacy) {
      throw new Error(
        'Not a valid plugin (need .claude-plugin/plugin.json, skills/, or legacy manifest.json+index.js)',
      );
    }

    const format: PluginFormat =
      isClaude && isLegacy ? 'hybrid' : isClaude ? 'claude' : 'legacy';

    const name =
      claudeMeta.name ||
      legacyMeta?.name ||
      dirName;
    const version = claudeMeta.version || legacyMeta?.version || '0.0.0';
    const description =
      claudeMeta.description ||
      legacyMeta?.description ||
      `Plugin ${name}`;
    const author =
      typeof claudeMeta.author === 'string'
        ? claudeMeta.author
        : claudeMeta.author?.name || legacyMeta?.author;

    const skillNames: string[] = [];
    const agentNames: string[] = [];
    const toolNames: string[] = [];

    // ── Claude skills ──────────────────────────────────────────────
    if (this.skillManager && isClaude) {
      const n = await this.skillManager.registerPluginSkills(name, dirPath);
      // Collect skill names for this plugin
      for (const s of this.skillManager.getAll()) {
        if (s.pluginName === name) skillNames.push(s.name);
      }
      if (n > 0) {
        console.log(`[plugin:${name}] Registered ${n} skill(s)`);
      }
    }

    // ── Agents ─────────────────────────────────────────────────────
    if (hasAgents) {
      const agents = await this.loadAgents(dirPath, name);
      for (const a of agents) {
        this.agents.set(`${name}:${a.name}`, a);
        agentNames.push(a.name);
      }
      if (agents.length) {
        console.log(`[plugin:${name}] Loaded ${agents.length} agent(s)`);
      }
    }

    // ── Legacy JS tools ────────────────────────────────────────────
    if (isLegacy && legacyMeta) {
      const loaded = await this.loadLegacyTools(dirPath, legacyMeta);
      toolNames.push(...loaded);
    }

    // ── Hooks (detect only for now) ────────────────────────────────
    const hooksPath = path.join(dirPath, 'hooks', 'hooks.json');
    if (await fileExists(hooksPath)) {
      console.log(`[plugin:${name}] hooks/hooks.json present (hooks runtime: partial)`);
    }

    const plugin: InstalledPlugin = {
      name,
      version,
      description,
      author,
      dirPath,
      enabled: true,
      format,
      skillNames,
      agentNames,
      toolNames,
      mcpConfigPath: hasMcp ? path.join(dirPath, '.mcp.json') : undefined,
      legacyTools: legacyMeta?.tools,
    };

    this.plugins.set(name, plugin);
    console.log(
      `[plugin:${name}] Loaded (${format}) skills=${skillNames.length} agents=${agentNames.length} tools=${toolNames.length}`,
    );
    return plugin;
  }

  private async loadAgents(pluginRoot: string, pluginName: string): Promise<PluginAgent[]> {
    const agentsDir = path.join(pluginRoot, 'agents');
    const result: PluginAgent[] = [];
    try {
      const entries = await fs.readdir(agentsDir);
      for (const e of entries) {
        if (!e.endsWith('.md')) continue;
        const filePath = path.join(agentsDir, e);
        const raw = await fs.readFile(filePath, 'utf-8');
        const parsed = parseFrontmatter(raw);
        if (!parsed) continue;
        const name =
          (parsed.meta.name as string)?.trim() || e.replace(/\.md$/i, '');
        result.push({
          name,
          description: (parsed.meta.description as string) || name,
          content: parsed.body,
          filePath,
          tools: Array.isArray(parsed.meta.tools)
            ? (parsed.meta.tools as string[])
            : typeof parsed.meta.tools === 'string'
              ? String(parsed.meta.tools).split(/[\s,]+/)
              : undefined,
          model: parsed.meta.model as string | undefined,
        });
      }
    } catch {
      // skip
    }
    return result;
  }

  private async loadLegacyTools(
    dirPath: string,
    manifest: LegacyPluginManifest,
  ): Promise<string[]> {
    const indexPath = path.join(dirPath, 'index.js');
    const fileUrl = pathToFileURL(indexPath).href;
    // Bust cache for reload
    const module: PluginModule = await import(`${fileUrl}?t=${Date.now()}`);
    const defaultExport = (module as any).default ?? module;

    if (!defaultExport || typeof defaultExport !== 'object' || !defaultExport.tools) {
      throw new Error('Legacy plugin must export { tools: { ... } }');
    }

    const names: string[] = [];
    for (const toolDecl of manifest.tools) {
      const impl = defaultExport.tools[toolDecl.name];
      if (!impl || typeof impl.execute !== 'function') {
        console.warn(
          `[plugin:${manifest.name}] Tool "${toolDecl.name}" has no implementation, skipping`,
        );
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
      names.push(prefixedName);
    }
    return names;
  }

  unload(name: string): void {
    const plugin = this.plugins.get(name);
    if (!plugin) return;

    for (const [toolName, pluginName] of this.registeredTools) {
      if (pluginName === name) {
        registry.unregister(toolName);
        this.registeredTools.delete(toolName);
      }
    }

    this.skillManager?.unregisterPluginSkills(name);

    for (const key of [...this.agents.keys()]) {
      if (key.startsWith(`${name}:`)) this.agents.delete(key);
    }

    this.plugins.delete(name);
  }

  async reload(name: string): Promise<InstalledPlugin | null> {
    const existing = this.plugins.get(name);
    if (!existing) return null;
    const dir = existing.dirPath;
    this.unload(name);
    return this.loadPlugin(dir);
  }

  async reloadAll(): Promise<void> {
    const names = [...this.plugins.keys()];
    for (const n of names) this.unload(n);
    await this.loadAll();
  }

  getAll(): InstalledPlugin[] {
    return Array.from(this.plugins.values());
  }

  get(name: string): InstalledPlugin | undefined {
    return this.plugins.get(name);
  }

  getToolNames(): string[] {
    return Array.from(this.registeredTools.keys());
  }

  getAgents(): PluginAgent[] {
    return Array.from(this.agents.values());
  }

  getAgent(pluginName: string, agentName: string): PluginAgent | undefined {
    return this.agents.get(`${pluginName}:${agentName}`);
  }

  /**
   * Read MCP server configs from all plugins' .mcp.json files.
   */
  async collectMcpConfigs(): Promise<Record<string, { command: string; args?: string[]; env?: Record<string, string> }>> {
    const result: Record<string, { command: string; args?: string[]; env?: Record<string, string> }> = {};
    for (const plugin of this.plugins.values()) {
      if (!plugin.mcpConfigPath) continue;
      try {
        const raw = JSON.parse(await fs.readFile(plugin.mcpConfigPath, 'utf-8'));
        const servers = raw.mcpServers || raw;
        if (typeof servers === 'object') {
          for (const [key, val] of Object.entries(servers)) {
            const namespaced = `${plugin.name}:${key}`;
            result[namespaced] = val as any;
          }
        }
      } catch (err: any) {
        console.warn(`[plugin:${plugin.name}] Failed to read .mcp.json:`, err.message);
      }
    }
    return result;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}
