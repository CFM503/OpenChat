// ============================================================================
// MCP Manager — Lifecycle management for multiple MCP servers
// ============================================================================

import { MCPClient, type MCPServerConfig } from './client.js';
import type { ConfigManager } from '../configManager.js';
import type { ToolDefinition } from '../tools/types.js';
import * as registry from '../tools/registry.js';

export class MCPManager {
  private clients: Map<string, MCPClient> = new Map();
  private registeredTools: Map<string, string> = new Map(); // toolName → serverName
  private config: ConfigManager;
  private registry: typeof registry;

  constructor(config: ConfigManager, reg: typeof registry) {
    this.config = config;
    this.registry = reg;
  }

  /**
   * Start all MCP servers defined in config.
   */
  async startAll(): Promise<void> {
    const cfg = this.config.load();
    const servers = (cfg as any).mcpServers as Record<string, MCPServerConfig> | undefined;
    if (!servers) return;

    for (const [name, serverConfig] of Object.entries(servers)) {
      await this.startServer(name, serverConfig);
    }
  }

  /**
   * Start a single MCP server and register its tools.
   */
  async startServer(name: string, serverConfig: MCPServerConfig): Promise<void> {
    if (this.clients.has(name)) {
      console.warn(`[mcp] Server "${name}" is already running`);
      return;
    }

    const client = new MCPClient(name, serverConfig);
    try {
      await client.start();
      this.clients.set(name, client);

      // Discover and register tools
      const mcpTools = await client.listTools();
      const toolDefs = client.toToolDefinitions(mcpTools);
      for (const tool of toolDefs) {
        registry.register(tool);
        this.registeredTools.set(tool.name, name);
      }
      console.log(`[mcp:${name}] Registered ${toolDefs.length} tools`);
    } catch (err: any) {
      console.error(`[mcp:${name}] Failed to start:`, err.message);
      client.stop();
    }
  }

  /**
   * Stop a single MCP server and unregister its tools.
   */
  stopServer(name: string): void {
    const client = this.clients.get(name);
    if (!client) return;

    client.stop();
    this.clients.delete(name);

    // Unregister tools from this server
    for (const [toolName, serverName] of this.registeredTools) {
      if (serverName === name) {
        registry.unregister(toolName);
        this.registeredTools.delete(toolName);
      }
    }
  }

  /**
   * Stop all MCP servers.
   */
  stopAll(): void {
    for (const name of this.clients.keys()) {
      this.stopServer(name);
    }
  }

  /**
   * Get all MCP-provided tool definitions.
   */
  getTools(): ToolDefinition[] {
    return registry.getAll().filter(t => t.name.startsWith('mcp_'));
  }

  /**
   * Get status of all MCP servers.
   */
  getStatus(): Array<{ name: string; running: boolean; tools: string[] }> {
    const result: Array<{ name: string; running: boolean; tools: string[] }> = [];
    for (const [name, client] of this.clients) {
      const tools = Array.from(this.registeredTools.entries())
        .filter(([, s]) => s === name)
        .map(([t]) => t);
      result.push({ name, running: client.isRunning(), tools });
    }
    return result;
  }

  /**
   * Add a new MCP server config and start it.
   */
  async addServer(name: string, serverConfig: MCPServerConfig): Promise<void> {
    // Update config
    const cfg = this.config.load();
    const mcpServers = ((cfg as any).mcpServers ?? {}) as Record<string, MCPServerConfig>;
    mcpServers[name] = serverConfig;
    this.config.save({ ...cfg, mcpServers } as any);

    // Start
    await this.startServer(name, serverConfig);
  }

  /**
   * Remove an MCP server config and stop it.
   */
  removeServer(name: string): void {
    this.stopServer(name);

    const cfg = this.config.load();
    const mcpServers = ((cfg as any).mcpServers ?? {}) as Record<string, MCPServerConfig>;
    delete mcpServers[name];
    this.config.save({ ...cfg, mcpServers } as any);
  }
}
