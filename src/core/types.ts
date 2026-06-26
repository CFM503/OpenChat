// ============================================================================
// OpenChat Core Types
// ============================================================================

// --- Model Routing Types ---

export type ModelProvider = 'openai' | 'ollama' | 'custom';

export interface ModelConfig {
  id: string;
  name: string;
  provider: ModelProvider;
  endpoint: string;
  apiKey?: string;
  model: string;
  maxTokens: number;
  temperature: number;
  isDefault: boolean;
}

export interface ModelRouteRequest {
  modelId: string;
  messages: ChatMessage[];
  stream: boolean;
}

export interface ModelRouteResponse {
  content: string;
  thinking?: string;
  model: string;
  tokensUsed: number;
}

// --- Chat Types ---

export interface ChatAttachment {
  name: string;
  type: string; // MIME type, e.g. image/png, text/plain
  size: number; // File size in bytes
  content: string; // base64 data URL for images/binaries, raw text for code/text files
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: string;
  timestamp: number;
  modelId?: string;
  isStreaming?: boolean;
  attachments?: ChatAttachment[];
  toolEvents?: ToolEvent[];
}

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

export interface ParsedStreamChunk {
  type: 'thinking' | 'content';
  text: string;
}

export interface StreamParserState {
  buffer: string;
  insideThinking: boolean;
  thinkingBuffer: string;
  contentBuffer: string;
}

// --- Agent Task State Machine Types ---

export type TaskStatus = 'pending' | 'running' | 'success' | 'failed';

export type TaskAction = 'START' | 'COMPLETE' | 'FAIL' | 'RETRY' | 'CANCEL';

export interface AgentTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  assignee: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  createdAt: number;
  updatedAt: number;
  result?: string;
  error?: string;
  logs: TaskLog[];
}

export interface TaskLog {
  timestamp: number;
  message: string;
  level: 'info' | 'warn' | 'error' | 'success';
}

export interface TaskTransition {
  from: TaskStatus;
  action: TaskAction;
  to: TaskStatus;
  guard?: (task: AgentTask) => boolean;
}

// --- Workspace Types ---

export interface WorkspaceFile {
  id: string;
  name: string;
  language: string;
  content: string;
  lastModified: number;
}

// --- Application State ---

export interface AppState {
  models: ModelConfig[];
  activeModelId: string | null;
  messages: ChatMessage[];
  tasks: AgentTask[];
  workspaceFiles: WorkspaceFile[];
  sidebarCollapsed: boolean;
  activeTab: 'chat' | 'tasks' | 'models' | 'files';
  rightPanelTab: 'code' | 'tasks';
  webSearchEnabled: boolean;
  tavilyApiKey?: string;
}
