// ============================================================================
// ConfigManager — Read/write .openchat config file
// ============================================================================

import fs from 'fs';
import path from 'path';

export interface OpenChatConfig {
  models?: ModelConfig[];
  activeModelId?: string;
  webSearchEnabled?: boolean;
  tavilyApiKey?: string;
  searchProvider?: string;
  searchApiKey?: string;
  searchBaseUrl?: string;
  proxyUrl?: string;
  proxyEnabled?: boolean;
  allowedDirectories?: string[];
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
  registries?: string[];
}

export interface ModelConfig {
  id: string;
  name: string;
  provider: 'openai' | 'ollama' | 'custom';
  endpoint: string;
  apiKey?: string;
  model: string;
  maxTokens: number;
  temperature: number;
  isDefault: boolean;
  disableTools?: boolean;
  useMaxTokens?: boolean;
}

/** Sanitize error messages to strip API keys and secrets. */
export function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/sk-[a-zA-Z0-9_-]{8,}/g, 'sk-***REDACTED***')
    .replace(/sk-ant-[a-zA-Z0-9_-]{8,}/g, 'sk-ant-***')
    .replace(/Bearer\s+[a-zA-Z0-9_.-]{20,}/gi, 'Bearer ***');
}

export class ConfigManager {
  private configPath: string;

  constructor(projectRoot?: string) {
    this.configPath = path.resolve(projectRoot ?? process.cwd(), '.openchat');
  }

  load(): OpenChatConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        return JSON.parse(data);
      }
    } catch {
      // Ignore parse errors
    }
    return {};
  }

  save(config: OpenChatConfig): void {
    this.writeAtomic(config);
  }

  private writeAtomic(config: OpenChatConfig): void {
    const dir = path.dirname(this.configPath);
    const tmpPath = path.join(dir, `.openchat.tmp.${process.pid}`);
    const backupPath = this.configPath + '.bak';

    // Atomic write: write to temp file, then rename
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8');

    // Create backup of current config
    if (fs.existsSync(this.configPath)) {
      try { fs.copyFileSync(this.configPath, backupPath); } catch { /* ignore */ }
    }

    fs.renameSync(tmpPath, this.configPath);

    // Restrict permissions (owner read/write only)
    try { fs.chmodSync(this.configPath, 0o600); } catch { /* ignore on Windows */ }
  }

  getConfigPath(): string {
    return this.configPath;
  }
}
