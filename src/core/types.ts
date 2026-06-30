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
  disableTools?: boolean;
  useMaxTokens?: boolean;  // true = send max_tokens to API, false = let provider decide
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
}

// --- Application State ---

export type SearchProvider = 'tavily' | 'serpapi' | 'bing' | 'searxng';

// --- Workspace Types ---

export interface WorkspaceFile {
  id: string;
  name: string;
  language: string;
  content: string;
  lastModified: number;
}

// --- Workspace Types ---

export interface SkillInfo {
  name: string;
  description: string;
  shortcut: string;
  category?: string;
  builtin: boolean;
  content?: string;
}

// ── MCP Types ────────────────────────────────────────────────────────────────

export interface MCPServerStatus {
  name: string;
  running: boolean;
  tools: string[];
}

// ── Plugin Types ─────────────────────────────────────────────────────────────

export interface PluginInfo {
  name: string;
  version: string;
  description: string;
  author?: string;
  enabled: boolean;
  tools: Array<{
    name: string;
    description: string;
    isReadOnly: boolean;
    isDestructive: boolean;
  }>;
}

// ── Registry Types ───────────────────────────────────────────────────────────

export interface RegistryPackageInfo {
  name: string;
  type: 'plugin' | 'skill';
  version: string;
  description: string;
  author?: string;
  downloads?: number;
  tags?: string[];
  shortcut?: string;
  downloadUrl?: string;
}

export interface InstalledPackageInfo {
  name: string;
  type: 'plugin' | 'skill';
  version: string;
  source?: string;
  installedAt: string;
}
