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

export class BackendClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;
  private callbacks: StreamCallbacks | null = null;

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
   */
  connect(): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve(true);
        return;
      }

      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          this.connected = true;
          resolve(true);
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onclose = () => {
          this.connected = false;
          this.scheduleReconnect();
        };

        this.ws.onerror = () => {
          resolve(false);
        };
      } catch {
        resolve(false);
      }
    });
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
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 5000);
  }
}

// Singleton instance
export const backendClient = new BackendClient();
