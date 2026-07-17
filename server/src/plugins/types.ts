// ============================================================================
// Plugin System — Claude Code + legacy OpenChat types
// ============================================================================

/** Claude Code plugin.json (inside .claude-plugin/) */
export interface ClaudePluginManifest {
  name?: string;
  version?: string;
  description?: string;
  author?: string | { name?: string; email?: string };
  license?: string;
  keywords?: string[];
  skills?: string | string[];
  commands?: string | string[];
  agents?: string | string[];
  hooks?: string;
  mcpServers?: string | Record<string, unknown>;
}

/** Legacy OpenChat manifest.json with JS tools */
export interface LegacyPluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    isReadOnly?: boolean;
    isDestructive?: boolean;
  }>;
}

export type PluginFormat = 'claude' | 'legacy' | 'hybrid';

export interface PluginAgent {
  name: string;
  description: string;
  content: string;
  filePath: string;
  /** Tools this agent may use (from frontmatter) */
  tools?: string[];
  model?: string;
}

export interface InstalledPlugin {
  name: string;
  version: string;
  description: string;
  author?: string;
  dirPath: string;
  enabled: boolean;
  format: PluginFormat;
  /** Claude-style skills registered count */
  skillNames: string[];
  /** Agent definition names */
  agentNames: string[];
  /** Legacy JS tool names (prefixed) */
  toolNames: string[];
  /** Path to .mcp.json if present */
  mcpConfigPath?: string;
  /** Raw legacy manifest tools for API compat */
  legacyTools?: LegacyPluginManifest['tools'];
}

export interface PluginModule {
  tools: Record<
    string,
    {
      execute(
        input: unknown,
        ctx: { workingDirectory: string; sessionId: string },
      ): Promise<{ success: boolean; output: string; error?: string }>;
    }
  >;
}
