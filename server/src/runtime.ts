// ============================================================================
// Application Runtime — composition root / dependency container
// ============================================================================

import fs from 'fs';
import path from 'path';
import { ConfigManager } from './configManager.js';
import { ProviderGateway } from './providerGateway.js';
import { AgentLoop } from './agentLoop.js';
import { SessionManager } from './sessionManager.js';
import * as registry from './tools/registry.js';
import { BashTool } from './tools/BashTool.js';
import { FileReadTool, FileWriteTool, FileEditTool, setFileToolConfig } from './tools/FileTool.js';
import { GrepTool, GlobTool, setGrepGlobToolConfig } from './tools/GrepGlobTool.js';
import { GitTool } from './tools/GitTool.js';
import { setBashToolConfig } from './tools/BashTool.js';
import { WebSearchTool, WebFetchTool, setWebToolConfig } from './tools/WebTool.js';
import { SkillTool, setSkillToolContext } from './tools/SkillTool.js';
import { SkillManager } from './skills/loader.js';
import { MCPManager } from './mcp/manager.js';
import { PluginManager } from './plugins/loader.js';
import { RegistryClient } from './registry/client.js';
import { RegistryInstaller } from './registry/installer.js';
import { promptCacheStore } from './context/promptCacheSession.js';

export interface Runtime {
  workingDirectory: string;
  port: number;
  openchatDir: string;
  config: ConfigManager;
  providers: ProviderGateway;
  sessions: SessionManager;
  skills: SkillManager;
  mcpManager: MCPManager;
  pluginManager: PluginManager;
  registryInstaller: RegistryInstaller;
  registryClient: RegistryClient;
  agentLoop: AgentLoop;
  tools: typeof registry;
}

export function createRuntime(opts?: {
  cwd?: string;
  port?: number;
}): Runtime {
  const workingDirectory = opts?.cwd ?? process.env.OPENCHAT_CWD ?? process.cwd();
  const port = opts?.port ?? parseInt(process.env.OPENCHAT_PORT ?? '3001', 10);

  const config = new ConfigManager(workingDirectory);
  const providers = new ProviderGateway(config);
  const sessions = new SessionManager();

  setFileToolConfig(config);
  setBashToolConfig(config);
  setGrepGlobToolConfig(config);
  setWebToolConfig(config);

  // Core tools
  registry.register(BashTool);
  registry.register(FileReadTool);
  registry.register(FileWriteTool);
  registry.register(FileEditTool);
  registry.register(GrepTool);
  registry.register(GlobTool);
  registry.register(GitTool);
  registry.register(WebSearchTool);
  registry.register(WebFetchTool);
  registry.register(SkillTool);

  const userHome = process.env.HOME ?? process.env.USERPROFILE ?? workingDirectory;
  const openchatDir = path.join(userHome, '.openchat');

  const skills = new SkillManager(path.join(openchatDir, 'skills'), workingDirectory);
  const mcpManager = new MCPManager(config, registry);
  const pluginManager = new PluginManager(path.join(openchatDir, 'plugins'), registry);
  pluginManager.setSkillManager(skills);
  setSkillToolContext(skills, workingDirectory);

  const cfg = config.load();
  const registries = (cfg as any).registries as string[] ?? [];
  const registryClient = new RegistryClient(registries, cfg.proxyUrl);
  const registryInstaller = new RegistryInstaller(
    registryClient,
    path.join(openchatDir, 'skills'),
    path.join(openchatDir, 'plugins'),
    skills,
    pluginManager,
  );

  const agentLoop = new AgentLoop(providers, registry, workingDirectory, skills);

  return {
    workingDirectory,
    port,
    openchatDir,
    config,
    providers,
    sessions,
    skills,
    mcpManager,
    pluginManager,
    registryInstaller,
    registryClient,
    agentLoop,
    tools: registry,
  };
}

/** Boot skills, plugins, MCP after HTTP is listening */
export async function bootstrapRuntime(rt: Runtime): Promise<void> {
  await rt.skills.load();
  await rt.pluginManager.loadAll();
  setSkillToolContext(rt.skills, rt.workingDirectory);

  const pluginMcp = await rt.pluginManager.collectMcpConfigs();
  for (const [name, serverConfig] of Object.entries(pluginMcp)) {
    try {
      await rt.mcpManager.startServer(name, serverConfig as any);
    } catch (err: any) {
      console.warn(`[mcp] Plugin MCP ${name}:`, err.message);
    }
  }
  await rt.mcpManager.startAll();
}

export async function reloadExtensions(rt: Runtime): Promise<{ skills: number; plugins: number }> {
  await rt.pluginManager.reloadAll();
  await rt.skills.load();
  for (const p of rt.pluginManager.getAll()) {
    await rt.skills.registerPluginSkills(p.name, p.dirPath);
  }
  setSkillToolContext(rt.skills, rt.workingDirectory);
  return {
    skills: rt.skills.getAll().length,
    plugins: rt.pluginManager.getAll().length,
  };
}

/**
 * Hot-switch the project working directory (tools, fs API, OPENCHAT.md, skills project root).
 * Model API keys stay in the active ConfigManager (re-pointed if new dir has .openchat).
 */
export async function setWorkingDirectory(
  rt: Runtime,
  rawPath: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const trimmed = (rawPath || '').trim();
  if (!trimmed) return { ok: false, error: 'path is required' };

  let resolved: string;
  try {
    resolved = path.resolve(trimmed);
  } catch {
    return { ok: false, error: 'Invalid path' };
  }

  try {
    if (!fs.existsSync(resolved)) {
      return { ok: false, error: `Directory does not exist: ${resolved}` };
    }
    const st = fs.statSync(resolved);
    if (!st.isDirectory()) {
      return { ok: false, error: `Not a directory: ${resolved}` };
    }
    // Prefer realpath when possible
    try {
      resolved = fs.realpathSync(resolved);
    } catch {
      /* keep resolved */
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }

  const prev = rt.workingDirectory;
  if (path.normalize(prev) === path.normalize(resolved)) {
    return { ok: true, path: resolved };
  }

  // Rebind project-local config if the new folder has (or will use) .openchat
  // Preserve API keys: merge previous models into new config file if new is empty
  const prevCfg = rt.config.load();
  const newConfig = new ConfigManager(resolved);
  const newRaw = newConfig.load();
  if ((!newRaw.models || newRaw.models.length === 0) && prevCfg.models?.length) {
    newConfig.save({
      ...prevCfg,
      // keep project-agnostic routing/safety flags; cwd is independent
    });
  }

  rt.workingDirectory = resolved;
  rt.config = newConfig;
  rt.providers.setConfig(newConfig);
  setFileToolConfig(newConfig);
  setBashToolConfig(newConfig);
  setGrepGlobToolConfig(newConfig);
  setWebToolConfig(newConfig);

  rt.agentLoop.setWorkingDirectory(resolved);
  rt.skills.setProjectDir(resolved);
  setSkillToolContext(rt.skills, resolved);
  try {
    await rt.skills.load();
  } catch (err: any) {
    console.warn('[cwd] skill reload after switch:', err?.message);
  }

  process.env.OPENCHAT_CWD = resolved;
  // Session prompt prefixes include old cwd paths — clear to avoid stale cache
  promptCacheStore.clear();

  console.log(`[cwd] Working directory: ${prev} → ${resolved}`);
  return { ok: true, path: resolved };
}
