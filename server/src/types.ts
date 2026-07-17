// ============================================================================
// Shared Types — Used by both frontend and backend
// ============================================================================

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  thinking?: string;
  timestamp: number;
  modelId?: string;
  isStreaming?: boolean;
  attachments?: ChatAttachment[];
  toolCalls?: ToolCallRequest[];
  toolCallId?: string;
}

export interface ChatAttachment {
  name: string;
  type: string;
  size: number;
  content: string;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolCallResult {
  toolCallId: string;
  name: string;
  success: boolean;
  output: string;
  error?: string;
  duration: number;
}

// ── WebSocket Protocol ──────────────────────────────────────────────────────

export type ClientMessage =
  | {
      type: 'chat';
      messages: ChatMessage[];
      modelId?: string;
      /** When false, ask the provider to skip chain-of-thought / deep thinking */
      enableThinking?: boolean;
    }
  | { type: 'abort' }
  | { type: 'ping' };

/** Ordered pipeline stages for progressive UX (user always knows "where we are") */
export type ProgressStage =
  | 'received'     // WS accepted the request
  | 'memory'       // loading project memory / skills catalog
  | 'packing'      // token budget pack
  | 'compressing'  // optional LLM summary of old turns
  | 'model'        // waiting for first token from provider
  | 'thinking'     // model is emitting reasoning
  | 'tools'        // tool round in progress
  | 'generating'   // streaming answer text
  | 'done';         // finished (optional mirror of done event)

export type ServerMessage =
  | { type: 'content'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_start'; toolCallId: string; name: string; input: string }
  | { type: 'tool_result'; toolCallId: string; name: string; result: ToolResult }
  | {
      type: 'pack_stats';
      estimatedTokens: number;
      strategy: string;
      keptMessages: number;
      droppedMessages: number;
    }
  | {
      type: 'progress';
      stage: ProgressStage;
      /** Short message for UI */
      message: string;
      /** Agent tool round (1-based), when stage is tools/model */
      round?: number;
      /** 0–100 optional soft progress */
      percent?: number;
    }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'pong' };

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  duration: number;
}
