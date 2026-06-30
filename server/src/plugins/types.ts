// ============================================================================
// Plugin System — Types
// ============================================================================

export interface PluginManifest {
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

export interface PluginModule {
  tools: Record<string, {
    execute(input: unknown, ctx: { workingDirectory: string; sessionId: string }) => Promise<{
      success: boolean;
      output: string;
      error?: string;
    }>;
  }>;
}

export interface InstalledPlugin {
  manifest: PluginManifest;
  dirPath: string;
  enabled: boolean;
}
