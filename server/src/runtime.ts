// ============================================================================
// Application Runtime — composition root / dependency container
// ============================================================================

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
