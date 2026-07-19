import WebSocket from 'ws';
import type { ChatMessage, ServerMessage } from './types.js';

export type WsStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface WsClientHandlers {
  onStatus?: (status: WsStatus, detail?: string) => void;
  onMessage?: (msg: ServerMessage) => void;
}

export class WsClient {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: WsClientHandlers;
  private intentionalClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(url: string, handlers: WsClientHandlers = {}) {
    this.url = url;
    this.handlers = handlers;
  }

  get status(): WsStatus {
    if (!this.ws) return 'closed';
    if (this.ws.readyState === WebSocket.CONNECTING) return 'connecting';
    if (this.ws.readyState === WebSocket.OPEN) return 'open';
    return 'closed';
  }

  connect(): Promise<void> {
    this.intentionalClose = false;
    return new Promise((resolve, reject) => {
      try {
        this.cleanupSocket();
        this.handlers.onStatus?.('connecting');
        this.ws = new WebSocket(this.url);

        const onOpen = () => {
          this.handlers.onStatus?.('open');
          this.startPing();
          resolve();
        };
        const onError = (err: Error) => {
          this.handlers.onStatus?.('error', err.message);
          // Only reject if still connecting
          if (this.ws?.readyState === WebSocket.CONNECTING) {
            reject(err);
          }
        };
        const onClose = () => {
          this.stopPing();
          this.handlers.onStatus?.('closed');
          if (!this.intentionalClose) this.scheduleReconnect();
        };
        const onMessage = (data: WebSocket.RawData) => {
          let msg: ServerMessage;
          try {
            msg = JSON.parse(data.toString());
          } catch {
            return;
          }
          this.handlers.onMessage?.(msg);
        };

        this.ws.once('open', onOpen);
        this.ws.once('error', onError);
        this.ws.on('close', onClose);
        this.ws.on('message', onMessage);
      } catch (err) {
        reject(err);
      }
    });
  }

  sendChat(opts: {
    messages: ChatMessage[];
    modelId?: string;
    enableThinking?: boolean;
    forceCompress?: boolean;
    sessionId?: string;
  }): void {
    this.send({
      type: 'chat',
      messages: opts.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        modelId: m.modelId,
        thinking: m.thinking,
      })),
      modelId: opts.modelId,
      enableThinking: opts.enableThinking,
      forceCompress: opts.forceCompress,
      sessionId: opts.sessionId,
    });
  }

  /** Pack + optional LLM compress only (no assistant reply) */
  sendCompress(opts: {
    messages: ChatMessage[];
    modelId?: string;
    forceCompress?: boolean;
    sessionId?: string;
  }): void {
    this.send({
      type: 'compress',
      messages: opts.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        modelId: m.modelId,
        thinking: m.thinking,
      })),
      modelId: opts.modelId,
      forceCompress: opts.forceCompress !== false,
      sessionId: opts.sessionId,
    });
  }

  abort(): void {
    this.send({ type: 'abort' });
  }

  ping(): void {
    this.send({ type: 'ping' });
  }

  close(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPing();
    this.cleanupSocket();
  }

  private send(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ping();
    }, 20000);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.intentionalClose) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
        /* will retry again on close */
      });
    }, 2000);
  }

  private cleanupSocket(): void {
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }
}
