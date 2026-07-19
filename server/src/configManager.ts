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
  /**
   * When true (default), file_write / file_edit stage changes for user Apply
   * instead of writing to disk immediately.
   */
  requireFileApply?: boolean;
  /** When true, each chat turn creates/updates a Task Board card */
  chatTaskBridge?: boolean;
}

/**
 * Recommended product defaults (cache hit rate + token cost + safe apply).
 * Applied whenever a field is omitted — explicit user values always win.
 */
export const OPENCHAT_CONFIG_DEFAULTS = {
  defaultContextStrategy: 'cache_max' as const,
  requireFileApply: true,
  chatTaskBridge: true,
};

const CHEAP_MODEL_RE = /mini|flash|haiku|lite|small|nano|fast|turbo|tiny|3\.5|3-5/i;
const CODING_MODEL_RE = /claude|sonnet|opus|deepseek|gpt-4|gpt-5|coder|codex|qwen-max|qwen-plus|v3|reasoner|o3|o4/i;
/** Heuristic: pick cheap + coding model ids from the list when routing is unset. */
export function autoPickAgentRouting(
  models: ModelConfig[] | undefined,
  activeModelId?: string,
): { cheapModelId?: string; codingModelId?: string } {
  if (!models?.length) return {};
  const active = activeModelId || models.find(m => m.isDefault)?.id || models[0]?.id;
  const label = (m: ModelConfig) => `${m.model || ''} ${m.name || ''} ${m.id}`;

  const cheap = models.find(m => m.id !== active && CHEAP_MODEL_RE.test(label(m)));
  // Prefer a strong coding model that is not the active header model
  const coding = models.find(
    m =>
      m.id !== active &&
      CODING_MODEL_RE.test(label(m)) &&
      !CHEAP_MODEL_RE.test(label(m)),
  );

  const out: { cheapModelId?: string; codingModelId?: string } = {};
  if (cheap) out.cheapModelId = cheap.id;
  if (coding) out.codingModelId = coding.id;
  return out;
}

/** Fill recommended defaults without clobbering explicit settings. */
export function withConfigDefaults(cfg: OpenChatConfig): OpenChatConfig {
  const models = cfg.models?.map(m => {
    const isLocal =
      m.provider === 'ollama' ||
      /11434|localhost:1234|ollama/i.test(m.endpoint || '');
    return {
      ...m,
      contextStrategy:
        m.contextStrategy ??
        (isLocal ? ('balanced' as const) : ('cache_max' as const)),
      // Soft defaults only when missing entirely (do not shrink user maxTokens)
      temperature: m.temperature ?? (isLocal ? 0.5 : 0.4),
      maxTokens: m.maxTokens && m.maxTokens > 0 ? m.maxTokens : isLocal ? 4096 : 8192,
    };
  });

  const picked = autoPickAgentRouting(models ?? cfg.models, cfg.activeModelId);
  const agentRouting = {
    ...picked,
    ...cfg.agentRouting,
  };
  // Drop empty routing object
  const hasRouting = !!(agentRouting.cheapModelId || agentRouting.codingModelId);

  return {
    ...cfg,
    models,
    defaultContextStrategy:
      cfg.defaultContextStrategy ?? OPENCHAT_CONFIG_DEFAULTS.defaultContextStrategy,
    requireFileApply:
      cfg.requireFileApply !== undefined
        ? cfg.requireFileApply
        : OPENCHAT_CONFIG_DEFAULTS.requireFileApply,
    chatTaskBridge:
      cfg.chatTaskBridge !== undefined
        ? cfg.chatTaskBridge
        : OPENCHAT_CONFIG_DEFAULTS.chatTaskBridge,
    agentRouting: hasRouting ? agentRouting : cfg.agentRouting,
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
        return withConfigDefaults(JSON.parse(data) as OpenChatConfig);
      }
    } catch {
      // Ignore parse errors
    }
    return withConfigDefaults({});
  }

  /** Raw file contents without defaults (for merge/save internals). */
  private loadRaw(): OpenChatConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        return JSON.parse(data) as OpenChatConfig;
      }
    } catch {
      /* ignore */
    }
    return {};
  }

  save(config: OpenChatConfig): void {
    this.writeAtomic(this.mergePreservingSecrets(config));
  }

  private mergePreservingSecrets(incoming: OpenChatConfig): OpenChatConfig {
    const existing = this.loadRaw();
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

    // Preserve explicit false for safety toggles when client omits them
    if (incoming.requireFileApply === undefined && existing.requireFileApply !== undefined) {
      merged.requireFileApply = existing.requireFileApply;
    }
    if (incoming.chatTaskBridge === undefined && existing.chatTaskBridge !== undefined) {
      merged.chatTaskBridge = existing.chatTaskBridge;
    }
    if (incoming.agentRouting === undefined && existing.agentRouting) {
      merged.agentRouting = existing.agentRouting;
    }
    if (incoming.defaultContextStrategy === undefined && existing.defaultContextStrategy) {
      merged.defaultContextStrategy = existing.defaultContextStrategy;
    }

    return withConfigDefaults(merged);
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
