// ============================================================================
// WebSocket connection handler
// ============================================================================

import type { WebSocket } from 'ws';
import type { Runtime } from '../runtime.js';
import type { ClientMessage, ServerMessage } from '../types.js';
import { sanitizeError } from '../configManager.js';

export function attachWebSocketHandlers(
  wss: { on: (event: string, cb: (ws: WebSocket) => void) => void },
  rt: Runtime,
): void {
  wss.on('connection', (ws: WebSocket) => {
    console.log('[ws] Client connected');
    let currentAbort: AbortController | null = null;

    ws.on('message', async (data: Buffer | ArrayBuffer | Buffer[]) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' } satisfies ServerMessage));
        return;
      }

      switch (msg.type) {
        case 'chat': {
          if (currentAbort) currentAbort.abort();
          currentAbort = new AbortController();

          if (!rt.providers.canMakeRequest(msg.modelId)) {
            ws.send(
              JSON.stringify({
                type: 'error',
                message:
                  'No API credentials configured. Use Settings to add a model, or use demo mode.',
              } satisfies ServerMessage),
            );
            ws.send(JSON.stringify({ type: 'done' } satisfies ServerMessage));
            break;
          }

          try {
            // Immediate ack so UI never sits silent while agent prepares
            if (ws.readyState === 1) {
              ws.send(
                JSON.stringify({
                  type: 'progress',
                  stage: 'received',
                  message: '请求已收到，正在准备…',
                  percent: 5,
                } satisfies ServerMessage),
              );
            }

            await rt.agentLoop.run({
              messages: msg.messages,
              modelId: msg.modelId,
              enableThinking: msg.enableThinking,
              signal: currentAbort.signal,
              onEvent: (event) => {
                if (ws.readyState === 1 /* OPEN */) {
                  ws.send(JSON.stringify(event));
                }
              },
            });
          } catch (err: any) {
            if (ws.readyState === 1) {
              ws.send(
                JSON.stringify({
                  type: 'error',
                  message: sanitizeError(err),
                } satisfies ServerMessage),
              );
              ws.send(JSON.stringify({ type: 'done' } satisfies ServerMessage));
            }
          }
          break;
        }

        case 'abort': {
          if (currentAbort) {
            currentAbort.abort();
            currentAbort = null;
          }
          break;
        }

        case 'ping': {
          ws.send(JSON.stringify({ type: 'pong' } satisfies ServerMessage));
          break;
        }
      }
    });

    ws.on('close', () => {
      console.log('[ws] Client disconnected');
      if (currentAbort) {
        currentAbort.abort();
        currentAbort = null;
      }
    });
  });
}
