// ============================================================================
// WebSocket API Service �?Connects frontend to backend gateway
// Falls back gracefully when backend is unavailable
// ============================================================================

import type { ChatMessage, ServerMessage, ClientMessage, ChatMessage as ServerChatMessage } from '../../server/src/types.js';
import type { SkillInfo, MCPServerStatus, PluginInfo, RegistryPackageInfo, InstalledPackageInfo, ToolEvent, FsTreeEntry } from '../core/types.js';
import { apiUrl, getWsUrl } from '../lib/apiBase.js';

export type { ChatMessage, ServerMessage, ClientMessage };

export interface ProgressEvent {
  stage: string;
  message: string;
  round?: number;
  percent?: number;
  modelId?: string;
  modelName?: string;
}

export interface PackStatsPayload {
  estimatedTokens: number;
  strategy: string;
  keptMessages: number;
  droppedMessages: number;
  truncatedTools?: number;
  compressed?: boolean;
  llmCompressed?: boolean;
  summaryChars?: number;
  summaryPreview?: string;
  summary?: string;
  appendOnly?: boolean;
  promptCacheSession?: boolean;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  cacheHitRate?: number;
  totalCachedTokens?: number;
  agentModelId?: string;
  agentModelName?: string;
  summaryModelId?: string;
  summaryModelName?: string;
}

export interface AgentRoutingPayload {
  primaryModelId: string;
  primaryModelName: string;
  agentModelId: string;
  agentModelName: string;
  summaryModelId: string;
  summaryModelName: string;
  agentIsOverride?: boolean;
  summaryIsSeparate?: boolean;
}

interface StreamCallbacks {
  onContent: (text: string) => void;
  onThinking: (text: string) => void;
  onToolEvent: (event: ToolEvent) => void;
  onPackStats?: (stats: PackStatsPayload) => void;
  onAgentRouting?: (r: AgentRoutingPayload) => void;
  onProgress?: (p: ProgressEvent) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY = 1000;  // 1 second

class BackendClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;
  private callbacks: StreamCallbacks | null = null;
  private reconnectAttempts = 0;
  private connectingPromise: Promise<boolean> | null = null;  // H-12: Guard against concurrent connects

  constructor() {
    this.url = getWsUrl();
  }

  /**
   * Check if the backend server is reachable.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const resp = await fetch(apiUrl('/api/health'), {
        signal: AbortSignal.timeout(2000),
      });
      return resp.ok;
    } catch {
      // Fallback direct port when Vite proxy not ready
      try {
        const resp = await fetch('http://localhost:3001/api/health', {
          signal: AbortSignal.timeout(1500),
        });
        if (resp.ok) {
          this.url = 'ws://localhost:3001/ws';
          return true;
        }
      } catch { /* ignore */ }
      return false;
    }
  }

  /**
   * Get backend health info.
   */
  async getHealth(): Promise<{ tools: string[]; canMakeRequest: boolean } | null> {
    try {
      const resp = await fetch(apiUrl('/api/health'), {
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) return resp.json();
    } catch {
      // Ignore
    }
    return null;
  }

  /**
   * Connect to the backend WebSocket.
   * H-12: Guards against concurrent connect() calls.
   */
  connect(): Promise<boolean> {
    // H-12: If already connecting, return existing promise
    if (this.connectingPromise) return this.connectingPromise;

    if (this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve(true);
    }

    this.connectingPromise = new Promise((resolve) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          this.connected = true;
          this.reconnectAttempts = 0;  // Reset on successful connection
          this.connectingPromise = null;
          resolve(true);
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onclose = () => {
          this.connected = false;
          this.connectingPromise = null;
          this.scheduleReconnect();
        };

        this.ws.onerror = () => {
          this.connectingPromise = null;
          resolve(false);
        };
      } catch {
        this.connectingPromise = null;
        resolve(false);
      }
    });

    return this.connectingPromise;
  }

  private handleMessage(data: string): void {
    if (!this.callbacks) return;

    let msg: ServerMessage;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'content':
        this.callbacks.onContent(msg.text);
        break;
      case 'thinking':
        this.callbacks.onThinking(msg.text);
        break;
      case 'tool_start':
        this.callbacks.onToolEvent({
          type: 'start',
          toolCallId: msg.toolCallId,
          name: msg.name,
          input: msg.input,
        });
        break;
      case 'tool_result':
        this.callbacks.onToolEvent({
          type: 'result',
          toolCallId: msg.toolCallId,
          name: msg.name,
          result: msg.result,
        });
        break;
      case 'pack_stats':
        this.callbacks.onPackStats?.({
          estimatedTokens: msg.estimatedTokens,
          strategy: msg.strategy,
          keptMessages: msg.keptMessages,
          droppedMessages: msg.droppedMessages,
          truncatedTools: msg.truncatedTools,
          compressed: msg.compressed,
          llmCompressed: msg.llmCompressed,
          summaryChars: msg.summaryChars,
          summaryPreview: msg.summaryPreview,
          summary: msg.summary,
          appendOnly: msg.appendOnly,
          promptCacheSession: msg.promptCacheSession,
          cachedTokens: msg.cachedTokens,
          cacheWriteTokens: msg.cacheWriteTokens,
          promptTokens: msg.promptTokens,
          completionTokens: msg.completionTokens,
          cacheHitRate: msg.cacheHitRate,
          totalCachedTokens: msg.totalCachedTokens,
          agentModelId: msg.agentModelId,
          agentModelName: msg.agentModelName,
          summaryModelId: msg.summaryModelId,
          summaryModelName: msg.summaryModelName,
        });
        break;
      case 'agent_routing':
        this.callbacks.onAgentRouting?.({
          primaryModelId: msg.primaryModelId,
          primaryModelName: msg.primaryModelName,
          agentModelId: msg.agentModelId,
          agentModelName: msg.agentModelName,
          summaryModelId: msg.summaryModelId,
          summaryModelName: msg.summaryModelName,
          agentIsOverride: msg.agentIsOverride,
          summaryIsSeparate: msg.summaryIsSeparate,
        });
        break;
      case 'progress':
        this.callbacks.onProgress?.({
          stage: msg.stage,
          message: msg.message,
          round: msg.round,
          percent: msg.percent,
          modelId: msg.modelId,
          modelName: msg.modelName,
        });
        break;
      case 'done':
        this.callbacks.onDone();
        break;
      case 'error':
        this.callbacks.onError(msg.message);
        break;
    }
  }

  /**
   * Send a chat message through the backend.
   */
  async sendMessage(
    messages: ChatMessage[],
    modelId: string | undefined,
    callbacks: StreamCallbacks,
    options?: { enableThinking?: boolean; forceCompress?: boolean; sessionId?: string },
  ): Promise<boolean> {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      const ok = await this.connect();
      if (!ok) return false;
    }

    this.callbacks = callbacks;

    const msg: ClientMessage = {
      type: 'chat',
      messages,
      modelId,
      enableThinking: options?.enableThinking,
      forceCompress: options?.forceCompress,
      sessionId: options?.sessionId,
    };
    this.ws!.send(JSON.stringify(msg));
    return true;
  }

  /**
   * Run context pack + optional LLM compression without generating a reply.
   */
  async compressContext(
    messages: ChatMessage[],
    modelId: string | undefined,
    callbacks: Pick<StreamCallbacks, 'onPackStats' | 'onProgress' | 'onDone' | 'onError'>,
    options?: { forceCompress?: boolean; sessionId?: string },
  ): Promise<boolean> {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      const ok = await this.connect();
      if (!ok) return false;
    }

    this.callbacks = {
      onContent: () => {},
      onThinking: () => {},
      onToolEvent: () => {},
      onPackStats: callbacks.onPackStats,
      onProgress: callbacks.onProgress,
      onDone: callbacks.onDone,
      onError: callbacks.onError,
    };

    const msg: ClientMessage = {
      type: 'compress',
      messages,
      modelId,
      forceCompress: options?.forceCompress !== false,
      sessionId: options?.sessionId,
    };
    this.ws!.send(JSON.stringify(msg));
    return true;
  }

  /**
   * Abort the current streaming response.
   */
  abort(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'abort' } satisfies ClientMessage));
    }
  }

  // ── Skill API ───────────────────────────────────────────────────────────

  async getSkills(): Promise<SkillInfo[]> {
    try {
      const resp = await fetch('/api/skills', {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) return resp.json();
    } catch { /* ignore */ }
    return [];
  }

  async expandSkill(
    name: string,
    selection?: string,
    args?: string,
  ): Promise<string | null> {
    try {
      const resp = await fetch(`/api/skills/${encodeURIComponent(name)}/expand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selection, arguments: args || '' }),
        // Shell injection in skills may take longer
        signal: AbortSignal.timeout(45000),
      });
      if (resp.ok) {
        const data = await resp.json() as { expanded: string };
        return data.expanded;
      }
    } catch { /* ignore */ }
    return null;
  }

  async reloadSkills(): Promise<boolean> {
    try {
      const resp = await fetch('/api/skills/reload', {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  async reloadPlugins(): Promise<boolean> {
    try {
      const resp = await fetch('/api/plugins/reload', {
        method: 'POST',
        signal: AbortSignal.timeout(30000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  // ── MCP API ─────────────────────────────────────────────────────────────

  async getMCPServers(): Promise<MCPServerStatus[]> {
    try {
      const resp = await fetch('/api/mcp/servers', {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) return resp.json();
    } catch { /* ignore */ }
    return [];
  }

  // ── Plugin API ───────────────────────────────────────────────────────────

  async getPlugins(): Promise<PluginInfo[]> {
    try {
      const resp = await fetch('/api/plugins', {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) return resp.json();
    } catch { /* ignore */ }
    return [];
  }

  // ── Registry API ─────────────────────────────────────────────────────────

  async searchRegistry(query: string): Promise<RegistryPackageInfo[]> {
    try {
      const resp = await fetch(`/api/registry/search?q=${encodeURIComponent(query)}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) {
        const data = await resp.json() as { packages: RegistryPackageInfo[] };
        return data.packages;
      }
    } catch { /* ignore */ }
    return [];
  }

  async installPackage(name: string): Promise<{ success: boolean; error?: string }> {
    try {
      const resp = await fetch('/api/registry/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
        signal: AbortSignal.timeout(60000),
      });
      return resp.json();
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async uninstallPackage(name: string): Promise<{ success: boolean; error?: string }> {
    try {
      const resp = await fetch(`/api/registry/uninstall/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(10000),
      });
      return resp.json();
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async getInstalledPackages(): Promise<InstalledPackageInfo[]> {
    try {
      const resp = await fetch('/api/registry/installed', {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        const data = await resp.json() as { installed: InstalledPackageInfo[] };
        return data.installed;
      }
    } catch { /* ignore */ }
    return [];
  }

  async checkUpdates(): Promise<Array<{ name: string; current: string; latest: string }>> {
    try {
      const resp = await fetch('/api/registry/updates', {
        signal: AbortSignal.timeout(15000),
      });
      if (resp.ok) {
        const data = await resp.json() as { updates: Array<{ name: string; current: string; latest: string }> };
        return data.updates;
      }
    } catch { /* ignore */ }
    return [];
  }

  // ── Session API ──────────────────────────────────────────────────────────

  async getSessions(): Promise<Array<{ id: string; title: string; messages: ServerChatMessage[]; createdAt: number; updatedAt: number }>> {
    try {
      const resp = await fetch('/api/sessions', {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) return resp.json();
    } catch { /* ignore */ }
    return [];
  }

  async createSession(title?: string): Promise<{ id: string } | null> {
    try {
      const resp = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) return resp.json();
    } catch { /* ignore */ }
    return null;
  }

  async updateSession(id: string, messages: any[], title?: string): Promise<void> {
    try {
      await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, title }),
        signal: AbortSignal.timeout(5000),
      });
    } catch { /* ignore */ }
  }

  async renameSession(id: string, title: string): Promise<boolean> {
    try {
      const resp = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
        signal: AbortSignal.timeout(5000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  // ── Filesystem API ───────────────────────────────────────────────────────

  async getFsTree(dirPath = '.', depth = 3): Promise<{ root: string; tree: FsTreeEntry[] } | null> {
    try {
      const resp = await fetch(
        `/api/fs/tree?path=${encodeURIComponent(dirPath)}&depth=${depth}`,
        { signal: AbortSignal.timeout(10000) },
      );
      if (resp.ok) return resp.json();
    } catch { /* ignore */ }
    return null;
  }

  async readFsFile(filePath: string): Promise<{ path: string; content: string; language: string; size: number } | null> {
    try {
      const resp = await fetch(
        `/api/fs/file?path=${encodeURIComponent(filePath)}`,
        { signal: AbortSignal.timeout(10000) },
      );
      if (resp.ok) return resp.json();
      const err = await resp.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error || `HTTP ${resp.status}`);
    } catch (err: any) {
      throw err;
    }
  }

  async writeFsFile(filePath: string, content: string): Promise<{ path: string; size: number } | null> {
    try {
      const resp = await fetch('/api/fs/file', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content }),
        signal: AbortSignal.timeout(15000),
      });
      if (resp.ok) return resp.json();
      const err = await resp.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error || `HTTP ${resp.status}`);
    } catch (err: any) {
      throw err;
    }
  }

  async restartMCPServer(name: string): Promise<{ success: boolean; error?: string }> {
    try {
      const resp = await fetch(`/api/mcp/servers/${encodeURIComponent(name)}/restart`, {
        method: 'POST',
        signal: AbortSignal.timeout(30000),
      });
      const data = await resp.json();
      if (!resp.ok) return { success: false, error: data.error || `HTTP ${resp.status}` };
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async deleteSession(id: string): Promise<void> {
    try {
      await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(5000),
      });
    } catch { /* ignore */ }
  }

  async getSession(id: string): Promise<{ id: string; title: string; messages: any[] } | null> {
    try {
      const resp = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) return resp.json();
    } catch { /* ignore */ }
    return null;
  }

  /**
   * Disconnect from the backend.
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = MAX_RECONNECT_ATTEMPTS;  // Prevent further reconnects
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.connectingPromise = null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * H-9: Exponential backoff with max retry limit.
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.warn(`[ws] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached, giving up`);
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, ... capped at 30s
    const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts), 30_000);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

// Singleton instance
export const backendClient = new BackendClient();
