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
      /** Force LLM history compression even if under threshold */
      forceCompress?: boolean;
      /**
       * UI conversation session id (ses_…). Enables server-side append-only
       * prompt cache across user turns.
       */
      sessionId?: string;
      /** Link this agent run to a Task Board card */
      taskId?: string;
      taskTitle?: string;
    }
  /** Run pack + optional LLM compress only (no model reply); for UI /compress */
  | {
      type: 'compress';
      messages: ChatMessage[];
      modelId?: string;
      /** default true for manual compress */
      forceCompress?: boolean;
      sessionId?: string;
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
      /** Tool outputs truncated for budget */
      truncatedTools?: number;
      /** True when hard-drop or LLM summary reduced history */
      compressed?: boolean;
      /** True when an LLM summarizer pass ran successfully */
      llmCompressed?: boolean;
      /** Chars in rolling conversation summary (if any) */
      summaryChars?: number;
      /** Short preview of the summary for UI */
      summaryPreview?: string;
      /** Full summary text when LLM compress ran (for client history injection) */
      summary?: string;
      /** Session used append-only prompt path (cross-turn cache) */
      appendOnly?: boolean;
      /** True when this request reused frozen session prefix */
      promptCacheSession?: boolean;
      /** Provider-reported cached input tokens (this request) */
      cachedTokens?: number;
      /** Provider cache write / creation tokens */
      cacheWriteTokens?: number;
      promptTokens?: number;
      completionTokens?: number;
      /** 0–1 when computable */
      cacheHitRate?: number;
      /** Cumulative cached tokens in this server session */
      totalCachedTokens?: number;
      /** Model id used for agent tool loop this turn */
      agentModelId?: string;
      agentModelName?: string;
      /** Model id used for summarization (if any) */
      summaryModelId?: string;
      summaryModelName?: string;
    }
  | {
      /** Multi-model routing decision for this turn */
      type: 'agent_routing';
      primaryModelId: string;
      primaryModelName: string;
      agentModelId: string;
      agentModelName: string;
      summaryModelId: string;
      summaryModelName: string;
      /** agent model differs from header/primary */
      agentIsOverride?: boolean;
      summaryIsSeparate?: boolean;
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
      /** Model currently being called (when relevant) */
      modelId?: string;
      modelName?: string;
    }
  | {
      type: 'pending_patch';
      id: string;
      path: string;
      tool: 'file_write' | 'file_edit';
      oldContent: string;
      newContent: string;
      diffPreview?: string;
      taskId?: string;
    }
  | {
      type: 'task_event';
      taskId: string;
      action: 'start' | 'log' | 'complete' | 'fail';
      message?: string;
      level?: 'info' | 'warn' | 'error' | 'success';
    }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'pong' };

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  duration: number;
  /** Staged file change awaiting user Apply (requireFileApply mode) */
  pendingPatch?: {
    id: string;
    path: string;
    tool: 'file_write' | 'file_edit';
    oldContent: string;
    newContent: string;
    diffPreview?: string;
  };
}
