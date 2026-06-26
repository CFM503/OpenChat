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
  | { type: 'chat'; messages: ChatMessage[]; modelId?: string }
  | { type: 'abort' }
  | { type: 'ping' };

export type ServerMessage =
  | { type: 'content'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_start'; toolCallId: string; name: string; input: string }
  | { type: 'tool_result'; toolCallId: string; name: string; result: ToolResult }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'pong' };

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  duration: number;
}
