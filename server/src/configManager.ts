// ============================================================================
// ConfigManager — Read/write .openchat config file
// ============================================================================

import fs from 'fs';
import path from 'path';
import type { ModelConfig } from './providers/modelTypes.js';

export type { ModelConfig };

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
  /** Global default context strategy if model omits it */
  defaultContextStrategy?: 'full' | 'balanced' | 'minimal' | 'cache_max';
  /**
   * Multi-model agent routing:
   * - cheapModelId: conversation summarization / compress (token saver)
   * - codingModelId: agent tool loop (strong coding model); omit = active model
   */
  agentRouting?: {
    cheapModelId?: string;
    codingModelId?: string;
  };
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
    this.writeAtomic(this.mergePreservingSecrets(config));
  }

  private mergePreservingSecrets(incoming: OpenChatConfig): OpenChatConfig {
    const existing = this.load();
    const isMasked = (v: unknown) =>
      typeof v !== 'string' || v.trim() === '' || /^\*+$/.test(v.trim()) || v.includes('***');

    const merged: OpenChatConfig = { ...existing, ...incoming };

    if (isMasked(incoming.searchApiKey) && existing.searchApiKey) {
      merged.searchApiKey = existing.searchApiKey;
    }
    if (isMasked(incoming.tavilyApiKey) && existing.tavilyApiKey) {
      merged.tavilyApiKey = existing.tavilyApiKey;
    }

    if (incoming.models && existing.models) {
      const byId = new Map(existing.models.map(m => [m.id, m]));
      merged.models = incoming.models.map(m => {
        const prev = byId.get(m.id);
        if (prev && isMasked(m.apiKey) && prev.apiKey) {
          return { ...m, apiKey: prev.apiKey };
        }
        return m;
      });
    }

    if (incoming.mcpServers === undefined && existing.mcpServers) {
      merged.mcpServers = existing.mcpServers;
    }
    if (incoming.registries === undefined && existing.registries) {
      merged.registries = existing.registries;
    }

    return merged;
  }

  private writeAtomic(config: OpenChatConfig): void {
    const dir = path.dirname(this.configPath);
    const tmpPath = path.join(dir, `.openchat.tmp.${process.pid}`);
    const backupPath = this.configPath + '.bak';

    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8');

    if (fs.existsSync(this.configPath)) {
      try { fs.copyFileSync(this.configPath, backupPath); } catch { /* ignore */ }
    }

    fs.renameSync(tmpPath, this.configPath);

    try { fs.chmodSync(this.configPath, 0o600); } catch { /* ignore on Windows */ }
  }

  getConfigPath(): string {
    return this.configPath;
  }
}
