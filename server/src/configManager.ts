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
}

/** Validate config structure before writing. Returns error string or null. */
export function validateConfig(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return 'Config must be a JSON object';
  }
  const cfg = data as Record<string, unknown>;
  if (cfg.models !== undefined) {
    if (!Array.isArray(cfg.models)) return 'models must be an array';
    for (const m of cfg.models) {
      if (!m || typeof m !== 'object') return 'Each model must be an object';
      const model = m as Record<string, unknown>;
      if (!model.provider || !['openai', 'ollama', 'custom'].includes(model.provider as string))
        return `Model.provider must be one of: openai, ollama, custom`;
      for (const key of ['id', 'name', 'endpoint', 'model']) {
        if (typeof model[key] !== 'string' || !(model[key] as string).trim())
          return `Model.${key} must be a non-empty string`;
      }
      // maxTokens and temperature: required, must be finite numbers
      if (typeof model.maxTokens !== 'number' || !Number.isFinite(model.maxTokens) || model.maxTokens < 4096 || model.maxTokens > 1000000 || model.maxTokens % 4096 !== 0)
        return 'Model.maxTokens must be a multiple of 4096, between 4096 and 1,000,000';
      if (typeof model.temperature !== 'number' || !Number.isFinite(model.temperature) || model.temperature < 0 || model.temperature > 2)
        return 'Model.temperature must be a finite number between 0 and 2';
      if (model.isDefault !== undefined && typeof model.isDefault !== 'boolean')
        return 'Model.isDefault must be a boolean';
      if (model.apiKey !== undefined && typeof model.apiKey !== 'string')
        return 'Model.apiKey must be a string';
    }
  }
  for (const key of ['activeModelId', 'searchProvider', 'searchApiKey', 'searchBaseUrl', 'tavilyApiKey', 'proxyUrl']) {
    if (cfg[key] !== undefined && typeof cfg[key] !== 'string') return `${key} must be a string`;
  }
  if (cfg.webSearchEnabled !== undefined && typeof cfg.webSearchEnabled !== 'boolean')
    return 'webSearchEnabled must be a boolean';
  if (cfg.proxyEnabled !== undefined && typeof cfg.proxyEnabled !== 'boolean')
    return 'proxyEnabled must be a boolean';
  return null;
}

/** Sanitize error messages to strip API keys and secrets. */
export function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg
    .replace(/sk-[a-zA-Z0-9_-]{8,}/g, 'sk-***REDACTED***')    // OpenAI-style keys
    .replace(/sk-ant-[a-zA-Z0-9_-]{8,}/g, 'sk-ant-***')        // Anthropic keys
    .replace(/Bearer\s+[a-zA-Z0-9_.-]{20,}/gi, 'Bearer ***')   // Bearer tokens
    .replace(/[a-zA-Z0-9]{32,}/g, (match) => {                   // Long hex/base64 secrets
      // Only redact if it looks like a secret (mixed case, digits, etc.)
      if (match.length >= 40 && /[A-Z]/.test(match) && /[a-z]/.test(match) && /\d/.test(match)) {
        return match.slice(0, 4) + '***';
      }
      return match;
    });
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

  /**
   * Save config with merge: preserves API keys from existing config
   * when the incoming config doesn't include them or sends masked/empty values.
   * This prevents config corruption from round-trip GET→POST cycles.
   */
  saveWithMerge(incoming: OpenChatConfig): void {
    const existing = this.load();

    // Merge top-level sensitive fields: preserve existing if incoming is empty/masked
    if (!incoming.tavilyApiKey || incoming.tavilyApiKey === '***') {
      incoming.tavilyApiKey = existing.tavilyApiKey;
    }
    if (!incoming.searchApiKey || incoming.searchApiKey === '***') {
      incoming.searchApiKey = existing.searchApiKey;
    }

    // Merge models: match by ID and preserve API keys
    if (incoming.models && existing.models) {
      const existingById = new Map(existing.models.map(m => [m.id, m]));
      incoming.models = incoming.models.map(m => {
        const existingModel = existingById.get(m.id);
        if (existingModel && (!m.apiKey || m.apiKey === '***')) {
          return { ...m, apiKey: existingModel.apiKey };
        }
        return m;
      });
    } else if (incoming.models && !existing.models && incoming.models.length > 0) {
      // First save — no existing models, keep as-is
    }

    this.writeAtomic(incoming);
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
