export interface TuiOptions {
  host: string;
  port: number;
  modelId?: string;
  enableThinking: boolean;
  /** Auto-start backend if health check fails */
  autoServe: boolean;
  cwd?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  thinking?: string;
  timestamp: number;
  modelId?: string;
  isStreaming?: boolean;
  toolEvents?: ToolEvent[];
}

export interface ToolEvent {
  toolCallId: string;
  name: string;
  input?: string;
  success?: boolean;
  output?: string;
  error?: string;
  duration?: number;
  status: 'running' | 'done';
}

export type ProgressStage =
  | 'received'
  | 'memory'
  | 'packing'
  | 'compressing'
  | 'model'
  | 'thinking'
  | 'tools'
  | 'generating'
  | 'done';

export type ServerMessage =
  | { type: 'content'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_start'; toolCallId: string; name: string; input: string }
  | {
      type: 'tool_result';
      toolCallId: string;
      name: string;
      result: {
        success: boolean;
        output: string;
        error?: string;
        duration: number;
      };
    }
  | {
      type: 'pack_stats';
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
    }
  | {
      type: 'progress';
      stage: ProgressStage;
      message: string;
      round?: number;
      percent?: number;
    }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'pong' };

export interface HealthInfo {
  status: string;
  tools: string[];
  workingDirectory: string;
  canMakeRequest: boolean;
  skills: number;
  plugins: number;
}

export interface LogLine {
  kind: 'user' | 'assistant' | 'thinking' | 'tool' | 'progress' | 'system' | 'error' | 'divider';
  text: string;
  /** Soft dim / secondary style */
  dim?: boolean;
}

export const STAGE_LABELS: Record<ProgressStage, string> = {
  received: '已接收',
  memory: '加载记忆',
  packing: '打包上下文',
  compressing: '压缩历史',
  model: '等待模型',
  thinking: '深度思考',
  tools: '执行工具',
  generating: '生成回复',
  done: '完成',
};
