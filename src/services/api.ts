// ============================================================================
// WebSocket API Service — Connects frontend to backend gateway
// Falls back gracefully when backend is unavailable
// ============================================================================

import type { ChatMessage, ServerMessage, ClientMessage } from '../../server/src/types.js';

export type { ChatMessage, ServerMessage, ClientMessage };

export interface ToolEvent {
  type: 'start' | 'result';
  toolCallId: string;
  name: string;
  input?: string;
  result?: {
    success: boolean;
    output: string;
    error?: string;
    duration: number;
  };
}

export interface StreamCallbacks {
  onContent: (text: string) => void;
  onThinking: (text: string) => void;
  onToolEvent: (event: ToolEvent) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY = 1000;  // 1 second

export class BackendClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;
  private callbacks: StreamCallbacks | null = null;
  private reconnectAttempts = 0;
  private connectingPromise: Promise<boolean> | null = null;  // H-12: Guard against concurrent connects

  constructor(port: number = 3001) {
    this.url = `ws://localhost:${port}/ws`;
  }

  /**
   * Check if the backend server is reachable.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const resp = await fetch('http://localhost:3001/api/health', {
        signal: AbortSignal.timeout(2000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get backend health info.
   */
  async getHealth(): Promise<{ tools: string[]; canMakeRequest: boolean } | null> {
    try {
      const resp = await fetch('http://localhost:3001/api/health', {
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
  ): Promise<boolean> {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      const ok = await this.connect();
      if (!ok) return false;
    }

    this.callbacks = callbacks;

    const msg: ClientMessage = { type: 'chat', messages, modelId };
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
