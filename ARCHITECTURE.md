# OpenChat Architecture Evolution Blueprint

> **From React Canvas → Production AI Coding Platform**
> Inspired by OpenClaude's tool execution, provider system, and agent architecture

---

## 1. 总体架构建议

### 1.1 当前状态（v1.0.6）

```
┌─────────────────────────────────────────────────┐
│                  Browser (SPA)                   │
│  ┌─────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ ChatPanel│  │CodeEditor│  │  TaskBoard     │  │
│  └────┬────┘  └──────────┘  └────────────────┘  │
│       │                                          │
│  ┌────▼──────────────────────────────────────┐   │
│  │            App.tsx (State Owner)           │   │
│  └────┬──────────────────────────────────────┘   │
│       │                                          │
│  ┌────▼──────────────────────────────────────┐   │
│  │  core/ (modelRouter, apiClient, parser)    │   │
│  └────┬──────────────────────────────────────┘   │
│       │                                          │
│       ▼  fetch() 直连 LLM API                    │
│  [OpenAI / Ollama / Custom Endpoint]             │
└─────────────────────────────────────────────────┘

限制：纯前端，无法执行任何本地操作（文件、命令、git）
```

### 1.2 目标架构（v2.0）

```
┌──────────────────────────────────────────────────────────────────────┐
│                        用户界面层（可多入口）                          │
│                                                                      │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────────┐  │
│  │  Web UI (SPA) │   │  CLI (Ink)   │   │  VS Code Extension (opt) │  │
│  │  React+Vite   │   │  Terminal UI │   │  WebView Panel           │  │
│  └──────┬───────┘   └──────┬───────┘   └──────────┬───────────────┘  │
│         │                  │                       │                  │
│         └──────────────────┼───────────────────────┘                  │
│                            │                                          │
│                            ▼  WebSocket / HTTP                        │
├──────────────────────────────────────────────────────────────────────┤
│                     Backend Gateway (Node.js)                         │
│                                                                      │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────────────┐  │
│  │ API Router  │ │  Session   │ │  Stream    │ │  Config Manager  │  │
│  │ (Express)   │ │  Manager   │ │  Manager   │ │  (.openchat)     │  │
│  └─────┬──────┘ └────────────┘ └────────────┘ └──────────────────┘  │
│        │                                                              │
│  ┌─────▼──────────────────────────────────────────────────────────┐  │
│  │              Provider Gateway (OpenAI Shim)                     │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │  │
│  │  │ OpenAI   │  │ Ollama   │  │ Gemini   │  │ Anthropic    │   │  │
│  │  │ Compat.  │  │ Local    │  │          │  │ (direct)     │   │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────────┘   │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                 Tools / Skills Engine                           │  │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────────┐  │  │
│  │  │ Bash   │ │ File   │ │ Grep/  │ │ Git    │ │ Web Search │  │  │
│  │  │ Tool   │ │ Ops    │ │ Glob   │ │ Tool   │ │ Tool       │  │  │
│  │  └────────┘ └────────┘ └────────┘ └────────┘ └────────────┘  │  │
│  │                                                                │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │  Tool Execution Sandbox (child_process + path jail)     │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Agent Orchestrator                                            │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────────────────┐ │  │
│  │  │ Agent    │  │ Task     │  │  Session Memory              │ │  │
│  │  │ Router   │  │ State    │  │  (conversation persistence)  │ │  │
│  │  │          │  │ Machine  │  │                              │ │  │
│  │  └──────────┘  └──────────┘  └──────────────────────────────┘ │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.3 推荐目录结构

```
openchat/
├── bin/                          # CLI 入口
│   └── openchat                  # #!/usr/bin/env node launcher
├── server/                       # Backend Gateway（新增）
│   ├── src/
│   │   ├── index.ts              # Express/Hono server entry
│   │   ├── gateway.ts            # API gateway + WebSocket hub
│   │   ├── sessionManager.ts     # Session CRUD + persistence
│   │   ├── configManager.ts      # .openchat read/write (replaces vite plugin)
│   │   ├── providerGateway.ts    # Multi-provider routing + OpenAI shim
│   │   ├── streamManager.ts      # SSE/WS streaming orchestration
│   │   └── tools/                # Tool execution layer
│   │       ├── registry.ts       # Tool registration + discovery
│   │       ├── executor.ts       # Sandboxed execution engine
│   │       ├── BashTool.ts       # Shell execution
│   │       ├── FileTool.ts       # Read/Write/Edit
│   │       ├── GrepTool.ts       # Content search
│   │       ├── GlobTool.ts       # File pattern matching
│   │       ├── GitTool.ts        # Git operations
│   │       └── WebTool.ts        # Search + Fetch (existing searchClient)
│   └── tsconfig.json
├── src/                          # Frontend (existing, refactored)
│   ├── core/                     # Pure logic (mostly unchanged)
│   │   ├── types.ts              # Extended types (tools, sessions, agents)
│   │   ├── modelRouter.ts        # Kept for frontend-side config UI
│   │   ├── streamParser.ts       # Unchanged
│   │   ├── taskStateMachine.ts   # Extended for real tool execution
│   │   └── simulatedApi.ts       # Unchanged (demo mode)
│   ├── hooks/                    # Custom React hooks (extracted from App.tsx)
│   │   ├── useChat.ts            # Chat state + streaming logic
│   │   ├── useConfig.ts          # Config persistence (debounced)
│   │   ├── useModels.ts          # Model CRUD
│   │   ├── useTasks.ts           # Task state machine bindings
│   │   └── useWorkspace.ts       # File workspace state
│   ├── components/               # Existing + new components
│   │   ├── ChatPanel.tsx
│   │   ├── ModelConfigPanel.tsx   # Enhanced with profiles
│   │   ├── TaskBoard.tsx          # Enhanced with real tool output
│   │   ├── WorkspacePanel.tsx
│   │   ├── ToolOutput.tsx         # NEW: render tool call results
│   │   ├── SessionSidebar.tsx     # NEW: session list + management
│   │   └── TerminalPanel.tsx      # NEW: embedded terminal view
│   ├── services/                 # Frontend API client
│   │   └── api.ts                # HTTP/WS client to backend
│   ├── App.tsx                   # Slimmed-down orchestrator
│   ├── main.tsx
│   └── index.css
├── cli/                          # CLI source (new)
│   ├── src/
│   │   ├── index.ts              # Commander.js entry
│   │   ├── commands/
│   │   │   ├── chat.ts           # `openchat chat` (interactive)
│   │   │   ├── run.ts            # `openchat run "task"` (one-shot)
│   │   │   ├── serve.ts          # `openchat serve` (start backend)
│   │   │   ├── config.ts         # `openchat config` (manage settings)
│   │   │   └── bg.ts             # Background session management
│   │   └── ui/                   # Ink terminal components
│   │       ├── ChatUI.tsx
│   │       └── StatusUI.tsx
│   └── tsconfig.json
├── shared/                       # Shared types between frontend/backend/cli
│   └── types.ts
├── vite.config.ts                # Frontend-only Vite config
├── package.json                  # Monorepo or unified
└── tsconfig.json                 # Root config
```

---

## 2. 优先级功能列表

### P0 — MVP（4-6 周）：让 AI 真正"做事"

| # | 功能 | 理由 | 难度 | 依赖 |
|---|------|------|------|------|
| 1 | **Backend Gateway** | 所有工具执行的前提；前端无法直接运行命令 | ⭐⭐ | Express/Hono + ws |
| 2 | **Tool Registry + Executor** | OpenClaude 核心理念：工具驱动而非聊天驱动 | ⭐⭐⭐ | child_process, sandbox |
| 3 | **BashTool** | 最基础的"做事"能力——运行命令 | ⭐⭐ | 安全沙箱 |
| 4 | **FileTool (Read/Write/Edit)** | AI 需要读写项目文件 | ⭐⭐ | path jail |
| 5 | **GrepTool + GlobTool** | 代码搜索是 agent 工作流的基础 | ⭐ | ripgrep / fs |
| 6 | **WebSocket Streaming** | 替代前端直连 LLM，统一经过后端 | ⭐⭐ | ws 库 |
| 7 | **Session 持久化** | 对话历史跨页面刷新保留 | ⭐⭐ | SQLite / JSON |
| 8 | **Tool Output UI** | 在 Chat 中渲染工具调用结果（文件 diff、命令输出） | ⭐⭐ | ChatPanel 扩展 |

### P1 — 中期（2-3 月）：多 Provider + Agent + CLI

| # | 功能 | 理由 | 难度 | 依赖 |
|---|------|------|------|------|
| 9 | **Provider Profiles** | OpenClaude 精髓：一键切换 provider | ⭐⭐ | 配置系统 |
| 10 | **OpenAI Shim Layer** | 统一接口适配所有 OpenAI 兼容 API | ⭐⭐⭐ | provider 设计 |
| 11 | **Agent Routing** | 不同 agent 用不同模型（Explore 用便宜模型，Coder 用强模型） | ⭐⭐⭐ | provider shim |
| 12 | **CLI 入口** | `openchat` 命令行，支持 `--bg` 后台模式 | ⭐⭐⭐ | Commander + Ink |
| 13 | **Task Kanban 真实执行** | Task 状态机驱动真实 tool calls，而非手动按钮 | ⭐⭐⭐ | Tool engine + agent loop |
| 14 | **GitTool** | Git status/diff/commit 操作 | ⭐⭐ | child_process |
| 15 | **多步 Tool Calling** | LLM 返回 tool_calls → 执行 → 回传结果 → 继续 | ⭐⭐⭐ | 流式 tool call 解析 |
| 16 | **Conversation Memory** | 自动摘要历史上下文 | ⭐⭐ | LLM 摘要调用 |

### P2 — 长期（3-6 月）：生产级稳定性

| # | 功能 | 理由 | 难度 | 依赖 |
|---|------|------|------|------|
| 17 | **MCP 协议支持** | 接入外部工具生态 | ⭐⭐⭐ | @modelcontextprotocol/sdk |
| 18 | **VS Code 扩展** | 编辑器内嵌体验 | ⭐⭐⭐⭐ | VS Code API |
| 19 | **Background Tasks** | 后台执行长时间任务 | ⭐⭐ | 进程管理 |
| 20 | **凭证加密存储** | 生产安全要求 | ⭐⭐ | keytar / OS keychain |
| 21 | **Docker 部署** | 容器化 self-hosting | ⭐⭐ | Dockerfile |
| 22 | **多 Agent 协作** | Coordinator 模式 | ⭐⭐⭐⭐ | Agent 框架 |
| 23 | **gRPC API** | 为外部集成提供标准化接口 | ⭐⭐⭐ | @grpc/grpc-js |

---

## 3. 具体实现建议

### 3.1 Backend Gateway（核心新增）

**文件: `server/src/index.ts`**

```typescript
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { ConfigManager } from './configManager.js';
import { SessionManager } from './sessionManager.js';
import { ProviderGateway } from './providerGateway.js';
import { ToolRegistry } from './tools/registry.js';
import { StreamManager } from './streamManager.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const config = new ConfigManager();     // .openchat 文件读写
const sessions = new SessionManager();  // 会话持久化
const providers = new ProviderGateway(config);  // 多 provider 路由
const tools = new ToolRegistry();       // 工具注册表
const streams = new StreamManager(wss, providers, tools, sessions);

// REST API
app.use(express.json());
app.get('/api/config', (req, res) => res.json(config.load()));
app.post('/api/config', (req, res) => { config.save(req.body); res.json({ ok: true }); });
app.get('/api/sessions', (req, res) => res.json(sessions.list()));
app.get('/api/sessions/:id', (req, res) => res.json(sessions.get(req.params.id)));
app.delete('/api/sessions/:id', (req, res) => { sessions.delete(req.params.id); res.json({ ok: true }); });

// WebSocket: 客户端 ←→ 后端的全双工通道
wss.on('connection', (ws) => streams.handleConnection(ws));

server.listen(3001, () => console.log('OpenChat backend on :3001'));
```

### 3.2 Tool 系统设计

**文件: `server/src/tools/registry.ts`**

```typescript
// 参考 OpenClaude 的 buildTool() 模式，简化为适合 OpenChat 的版本

export interface ToolDefinition<Input = unknown, Output = unknown> {
  name: string;                      // e.g. "bash", "file_read", "grep"
  description: string;               // LLM 可见的工具描述
  inputSchema: Record<string, unknown>; // JSON Schema for function calling
  isReadOnly: boolean;               // 是否只读（安全分类）
  isDestructive: boolean;            // 是否有破坏性（需确认）

  execute(input: Input, ctx: ToolContext): Promise<ToolResult<Output>>;
}

export interface ToolContext {
  workingDirectory: string;          // 项目根目录
  sessionId: string;
  abortSignal: AbortSignal;
  permissionMode: 'ask' | 'auto' | 'bypass';
  onPermissionRequest?: (desc: string) => Promise<boolean>;
}

export interface ToolResult<T> {
  success: boolean;
  output: T;
  error?: string;
  duration: number;                  // 执行耗时
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** 返回所有工具的 OpenAI function-calling 格式定义 */
  toFunctionDefinitions(): Array<{
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }> {
    return Array.from(this.tools.values()).map(t => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));
  }
}
```

**文件: `server/src/tools/BashTool.ts`**

```typescript
import { spawn } from 'child_process';
import type { ToolDefinition, ToolContext, ToolResult } from './registry.js';

interface BashInput {
  command: string;
  timeout?: number;  // 默认 30s
  cwd?: string;
}

export const BashTool: ToolDefinition<BashInput, string> = {
  name: 'bash',
  description: 'Execute a shell command and return stdout/stderr',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The command to execute' },
      timeout: { type: 'number', description: 'Timeout in ms (default 30000)' },
      cwd: { type: 'string', description: 'Working directory' },
    },
    required: ['command'],
  },
  isReadOnly: false,
  isDestructive: false,  // 由安全层根据命令内容动态判断

  async execute(input, ctx): Promise<ToolResult<string>> {
    const start = Date.now();
    const timeout = input.timeout ?? 30000;
    const cwd = input.cwd ?? ctx.workingDirectory;

    // 安全检查：危险命令拦截
    if (isDangerousCommand(input.command)) {
      return {
        success: false,
        output: '',
        error: `Blocked dangerous command: ${input.command}`,
        duration: Date.now() - start,
      };
    }

    return new Promise((resolve) => {
      const proc = spawn(input.command, {
        shell: true,
        cwd,
        env: { ...process.env, OPENCHAT_SESSION: ctx.sessionId },
      });

      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d) => (stdout += d));
      proc.stderr.on('data', (d) => (stderr += d));

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        resolve({
          success: false,
          output: stdout,
          error: `Command timed out after ${timeout}ms`,
          duration: Date.now() - start,
        });
      }, timeout);

      proc.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          success: code === 0,
          output: stdout + (stderr ? `\n[stderr]\n${stderr}` : ''),
          error: code !== 0 ? `Exit code: ${code}` : undefined,
          duration: Date.now() - start,
        });
      });

      ctx.abortSignal.addEventListener('abort', () => proc.kill('SIGTERM'));
    });
  },
};

function isDangerousCommand(cmd: string): boolean {
  const blocked = [/rm\s+-rf\s+\/(?!tmp)/, /mkfs/, /dd\s+of=\/dev/, /:(){ :|:& };:/];
  return blocked.some(p => p.test(cmd));
}
```

**文件: `server/src/tools/FileTool.ts`**

```typescript
import fs from 'fs/promises';
import path from 'path';

export const FileReadTool: ToolDefinition<{ path: string }, string> = {
  name: 'file_read',
  description: 'Read a file from the filesystem',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or relative file path' },
    },
    required: ['path'],
  },
  isReadOnly: true,
  isDestructive: false,

  async execute(input, ctx) {
    const absPath = path.resolve(ctx.workingDirectory, input.path);

    // Path jail: 确保不逃逸项目目录
    if (!absPath.startsWith(ctx.workingDirectory)) {
      return { success: false, output: '', error: 'Path outside workspace', duration: 0 };
    }

    try {
      const content = await fs.readFile(absPath, 'utf-8');
      return { success: true, output: content, duration: 0 };
    } catch (err: any) {
      return { success: false, output: '', error: err.message, duration: 0 };
    }
  },
};

export const FileWriteTool: ToolDefinition<
  { path: string; content: string },
  void
> = {
  name: 'file_write',
  description: 'Write content to a file (creates or overwrites)',
  // ...
  isReadOnly: false,
  isDestructive: true,
};
```

### 3.3 Provider Gateway（多 Provider 路由）

**文件: `server/src/providerGateway.ts`**

```typescript
// 参考 OpenClaude 的 providerProfile + openaiShim 设计
// 核心思想：所有 provider 适配为 OpenAI Chat Completions 格式

interface ProviderProfile {
  id: string;
  name: string;
  type: 'openai' | 'ollama' | 'anthropic' | 'gemini' | 'custom';
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
  headers?: Record<string, string>;
}

export class ProviderGateway {
  private profiles: Map<string, ProviderProfile> = new Map();
  private activeProfileId: string = '';

  constructor(config: ConfigManager) {
    const saved = config.load();
    if (saved.profiles) {
      for (const p of saved.profiles) this.profiles.set(p.id, p);
    }
    this.activeProfileId = saved.activeProfileId ?? '';
  }

  /**
   * 核心：将请求统一转为 OpenAI Chat Completions 格式发送
   * 这是 OpenClaude openaiShim 的简化版
   */
  async streamCompletion(params: {
    profileId?: string;
    model?: string;
    messages: Array<{ role: string; content: string }>;
    tools?: Array<{ type: 'function'; function: any }>;
    signal?: AbortSignal;
  }): AsyncGenerator<StreamChunk> {
    const profile = this.profiles.get(params.profileId ?? this.activeProfileId);
    if (!profile) throw new Error('No active provider profile');

    const model = params.model ?? profile.defaultModel;
    const body: Record<string, any> = {
      model,
      messages: params.messages,
      stream: true,
    };

    if (params.tools?.length) {
      body.tools = params.tools;
      body.tool_choice = 'auto';
    }

    // Ollama 特殊处理
    if (profile.type === 'ollama') {
      return this.streamOllama(profile, body);
    }

    // 通用 OpenAI 兼容格式（覆盖 openai, anthropic-proxy, gemini-proxy, custom）
    return this.streamOpenAICompatible(profile, body, params.signal);
  }

  private async *streamOpenAICompatible(
    profile: ProviderProfile,
    body: Record<string, any>,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    const url = `${profile.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(profile.apiKey && { Authorization: `Bearer ${profile.apiKey}` }),
      ...profile.headers,
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!resp.ok) throw new Error(`Provider error ${resp.status}: ${await resp.text()}`);

    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (trimmed.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(trimmed.slice(6));
            const delta = parsed.choices?.[0]?.delta;
            if (delta) {
              yield {
                type: delta.tool_calls ? 'tool_call' : 'content',
                content: delta.content ?? '',
                toolCalls: delta.tool_calls,
              };
            }
          } catch { /* skip malformed */ }
        }
      }
    }
  }
}

interface StreamChunk {
  type: 'content' | 'tool_call' | 'thinking';
  content: string;
  toolCalls?: any[];
}
```

### 3.4 多步 Tool Calling Loop（核心 Agent 循环）

这是让 OpenChat 从"聊天"升级为"做事"的关键。

**文件: `server/src/agentLoop.ts`**

```typescript
/**
 * Agent Loop: LLM ↔ Tool 交互循环
 *
 * 1. 发送消息 + 工具定义给 LLM
 * 2. LLM 返回 content + tool_calls
 * 3. 执行 tool_calls，收集结果
 * 4. 将 tool results 作为新消息追加
 * 5. 重复直到 LLM 不再请求工具调用
 */
export class AgentLoop {
  constructor(
    private providers: ProviderGateway,
    private tools: ToolRegistry,
    private sessions: SessionManager,
  ) {}

  async *run(params: {
    sessionId: string;
    messages: ChatMessage[];
    signal?: AbortSignal;
  }): AsyncGenerator<AgentEvent> {
    const ctx: ToolContext = {
      workingDirectory: process.cwd(),
      sessionId: params.sessionId,
      abortSignal: params.signal ?? new AbortController().signal,
      permissionMode: 'auto',
    };

    let messages = [...params.messages];
    const toolDefs = this.tools.toFunctionDefinitions();

    // 安全阀：最多 10 轮工具调用防止无限循环
    for (let round = 0; round < 10; round++) {
      let responseContent = '';
      let toolCalls: any[] = [];

      // 1. 流式请求 LLM
      for await (const chunk of this.providers.streamCompletion({
        messages,
        tools: toolDefs,
        signal: ctx.abortSignal,
      })) {
        if (chunk.type === 'content') {
          responseContent += chunk.content;
          yield { type: 'content', text: chunk.content };
        }
        if (chunk.type === 'tool_call' && chunk.toolCalls) {
          toolCalls.push(...chunk.toolCalls);
        }
      }

      // 2. 如果没有工具调用，结束循环
      if (toolCalls.length === 0) break;

      // 3. 将 assistant 消息（含 tool_calls）追加到历史
      messages.push({
        role: 'assistant',
        content: responseContent,
        tool_calls: toolCalls,
      });

      // 4. 执行所有工具调用
      for (const tc of toolCalls) {
        const tool = this.tools.get(tc.function.name);
        if (!tool) {
          yield { type: 'tool_error', toolName: tc.function.name, error: 'Tool not found' };
          continue;
        }

        yield { type: 'tool_start', toolName: tc.function.name, input: tc.function.arguments };

        const input = JSON.parse(tc.function.arguments);
        const result = await tool.execute(input, ctx);

        yield {
          type: 'tool_result',
          toolName: tc.function.name,
          result,
        };

        // 5. 将工具结果作为 tool message 追加
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }
    }

    // 保存完整对话到 session
    this.sessions.update(params.sessionId, messages);
  }
}

type AgentEvent =
  | { type: 'content'; text: string }
  | { type: 'tool_start'; toolName: string; input: string }
  | { type: 'tool_result'; toolName: string; result: ToolResult<any> }
  | { type: 'tool_error'; toolName: string; error: string };
```

### 3.5 前端改造：App.tsx 瘦身 + Hook 提取

**文件: `src/hooks/useChat.ts`**（从 App.tsx 提取）

```typescript
export function useChat(ws: WebSocket | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (content: string, attachments?: ChatAttachment[]) => {
    if (!ws || isStreaming) return;

    const userMsg: ChatMessage = {
      id: uid('msg'), role: 'user', content: content.trim(),
      attachments: attachments ?? [], timestamp: Date.now(),
    };

    const assistantMsg: ChatMessage = {
      id: uid('msg'), role: 'assistant', content: '',
      isStreaming: true, timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);

    // 通过 WebSocket 发送到后端
    ws.send(JSON.stringify({ type: 'chat', messages: [...messages, userMsg] }));
  }, [ws, isStreaming, messages]);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    ws?.send(JSON.stringify({ type: 'abort' }));
  }, [ws]);

  // WebSocket 事件处理
  useEffect(() => {
    if (!ws) return;
    const handler = (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case 'content':
          // 流式文本更新（复用 streamParser 处理 thinking）
          updateAssistantMessage(data.text);
          break;
        case 'tool_start':
          // 显示 "🔧 Running bash: npm test..."
          appendToolIndicator(data.toolName, data.input);
          break;
        case 'tool_result':
          // 渲染工具输出（文件 diff、命令输出等）
          appendToolResult(data.toolName, data.result);
          break;
        case 'done':
          setIsStreaming(false);
          break;
      }
    };
    ws.addEventListener('message', handler);
    return () => ws.removeEventListener('message', handler);
  }, [ws]);

  return { messages, isStreaming, sendMessage, stopStreaming };
}
```

### 3.6 Tool Output UI 组件

**文件: `src/components/ToolOutput.tsx`**

```typescript
interface ToolOutputProps {
  toolName: string;
  status: 'running' | 'success' | 'error';
  input?: string;
  output?: string;
  duration?: number;
}

export function ToolOutput({ toolName, status, input, output, duration }: ToolOutputProps) {
  const [expanded, setExpanded] = useState(status === 'error');

  const icons: Record<string, string> = {
    bash: '💻',
    file_read: '📖',
    file_write: '✏️',
    file_edit: '📝',
    grep: '🔍',
    glob: '📂',
    git: '🔀',
    web_search: '🌐',
  };

  return (
    <div className={`tool-output tool-${status}`}>
      <div className="tool-header" onClick={() => setExpanded(prev => !prev)}>
        <span className="tool-icon">{icons[toolName] ?? '🔧'}</span>
        <span className="tool-name">{toolName}</span>
        {input && <span className="tool-input-preview">{truncate(input, 60)}</span>}
        <span className={`tool-status-badge ${status}`}>{status}</span>
        {duration != null && <span className="tool-duration">{duration}ms</span>}
      </div>
      {expanded && output && (
        <pre className="tool-output-content">
          <CopyButton text={output} />
          <code>{output}</code>
        </pre>
      )}
    </div>
  );
}
```

### 3.7 Task Kanban 与真实执行集成

**改造 `src/core/taskStateMachine.ts`**

```typescript
// 扩展 TaskAction 增加 EXECUTE
export type TaskAction = 'START' | 'COMPLETE' | 'FAIL' | 'RETRY' | 'CANCEL' | 'EXECUTE';

// AgentTask 增加工具相关字段
export interface AgentTask {
  // ... existing fields
  toolCalls?: ToolCallRecord[];  // 记录执行了哪些工具
  workingDirectory?: string;      // 工作目录
}

export interface ToolCallRecord {
  toolName: string;
  input: string;
  output: string;
  success: boolean;
  timestamp: number;
}
```

当用户在 Kanban 点击 "Start"，后端 agent loop 被触发，task 的 `assignee` 负责选择 agent 和 model，工具执行记录实时更新到 task 的 logs 中。

---

## 4. 与 OpenClaude 融合点

| OpenChat 现有 | OpenClaude 参考 | 融合策略 |
|---|---|---|
| `core/modelRouter.ts` (2 个 provider) | `providerProfile.ts` (16+ profiles) | **扩展** — 增加 profile 概念，保留现有 UI |
| `core/apiClient.ts` (直接 fetch) | `openaiShim.ts` (统一 shim 层) | **替换** — API 调用统一经过后端 gateway |
| `core/taskStateMachine.ts` (手动按钮) | `TaskCreateTool` + `TaskUpdateTool` (agent 驱动) | **扩展** — 增加 EXECUTE action，由 agent loop 驱动 |
| `core/searchClient.ts` (Tavily) | `WebSearchTool` (DuckDuckGo + Firecrawl) | **扩展** — 保留 Tavily，增加更多搜索引擎 |
| 无工具系统 | `src/Tool.ts` + `buildTool()` | **新建** — 创建 ToolRegistry + 各 Tool 实现 |
| 无 CLI | `bin/openclaude` + Commander + Ink | **新建** — `bin/openchat` + CLI commands |
| 无 session 持久化 | `bgRegistry.ts` + `SessionMemory` | **新建** — JSON/SQLite session 存储 |
| 无 agent 路由 | `agentRouting.ts` (per-agent model) | **新建** — 配置不同 agent 用不同模型 |
| Vite plugin `/api/config` | `settings.json` + `ConfigManager` | **迁移** — 配置管理移到后端 |
| `simulatedApi.ts` (demo 模式) | 无（真实 API only） | **保留** — demo 模式仍有价值用于展示 |

### 可直接复用的 OpenClaude 设计模式

1. **`buildTool()` 工厂模式** — 简化版，去掉 Anthropic SDK 依赖
2. **Provider Profile 配置结构** — JSON 格式，UI 渲染 provider 列表
3. **Agent Routing 配置** — `agentRouting` + `agentModels` 字段
4. **Path Jail 安全策略** — 文件操作限制在项目目录内
5. **Bash 命令安全检查** — 危险命令拦截列表
6. **Background Session 管理** — `ps` / `logs` / `kill` 命令设计
7. **Tool Output 渲染格式** — 工具调用结果的结构化展示

---

## 5. 下一步行动计划

### 第一步：Backend Gateway + 2 个核心 Tool（1-2 周）

**目标：** 最小可验证的"AI 能做事"循环

1. 创建 `server/` 目录，搭建 Express + WebSocket 后端
2. 实现 `ToolRegistry` + `BashTool` + `FileReadTool`
3. 实现 `ProviderGateway`（迁移现有 apiClient 逻辑到后端）
4. 实现基础 `AgentLoop`（LLM → tool_calls → execute → 回传）
5. 前端通过 WebSocket 连接后端，替代直接 fetch
6. 在 ChatPanel 中渲染 ToolOutput 组件

**验证标准：** 用户在 Web UI 输入 "列出项目中的所有 TypeScript 文件"，AI 调用 `bash` 执行 `find . -name "*.ts"`，结果在聊天气泡中正确显示。

### 第二步：完善 Tool 生态 + Session（2-3 周）

1. 添加 `FileWriteTool`、`FileEditTool`、`GrepTool`、`GlobTool`、`GitTool`
2. 实现 path jail 安全策略
3. Session 持久化（JSON 文件，存储在 `~/.openchat/sessions/`）
4. Task Kanban 接入真实 agent loop
5. 扩展 `ModelConfigPanel` 为 Provider Profiles 管理

### 第三步：CLI + 多 Provider（3-4 周）

1. 创建 `bin/openchat` CLI 入口
2. 实现 `openchat serve`（启动后端）、`openchat chat`（终端交互）
3. OpenAI Shim 层（适配 Ollama、Gemini 等）
4. Agent Routing 配置

---

## 6. 安全与风险注意事项

### 6.1 工具执行安全

| 风险 | 缓解措施 |
|---|---|
| AI 执行 `rm -rf /` | 命令黑名单 + 用户确认（非 auto 模式） |
| 文件操作逃逸项目目录 | Path Jail: 所有路径 resolve 后检查前缀 |
| 长时间命令挂起 | 所有 bash 命令强制 timeout（默认 30s） |
| 无限工具调用循环 | Agent loop 硬限制 10 轮 |
| 并发工具冲突 | 工具标记 `isConcurrencySafe`，非安全的串行执行 |

### 6.2 凭证安全

| 风险 | 缓解措施 |
|---|---|
| API Key 明文存储 | MVP 阶段接受（.openchat 已 gitignore），后续加密 |
| 前端暴露 Key | **关键**：后端 gateway 后，前端不再持有 API Key |
| WebSocket 未认证 | 本地运行场景下风险低，远程部署需加 token |

### 6.3 架构风险

| 风险 | 缓解措施 |
|---|---|
| 后端增加部署复杂度 | `openchat serve` 一键启动；dev 模式前后端联动 |
| WebSocket 断连 | 自动重连 + 消息队列暂存 |
| 多 Provider 兼容性 | 先只支持 OpenAI 兼容格式（覆盖 90% provider），逐步适配 |
| 性能（Node.js 单线程） | 工具执行用 child_process 不阻塞主循环 |

### 6.4 跨平台注意

- **Windows**: bash 命令需要 `shell: true` + `cmd.exe`，或检测 Git Bash 路径
- **路径分隔符**: 全部使用 `path.resolve()` / `path.join()`，不硬编码 `/`
- **PowerShell**: 考虑作为 Windows 默认 shell 选项（参考 OpenClaude 的 PowerShellTool）

---

## 7. 技术选型建议

| 组件 | 推荐 | 理由 |
|---|---|---|
| Backend 框架 | **Hono** (非 Express) | 更轻量、TypeScript 原生、支持多种 runtime |
| WebSocket | **ws** | Node.js 标准库级别，稳定可靠 |
| CLI 框架 | **Commander.js** | 成熟、API 简洁 |
| Terminal UI | **Ink** (React for CLI) | OpenChat 团队已熟悉 React，降低学习成本 |
| Session 存储 | **JSON 文件** (MVP) → **SQLite** (后期) | MVP 简单够用，后期可平滑迁移 |
| Schema 校验 | **Zod** | TypeScript 生态标准，可推导类型 |
| 进程管理 | **child_process** (内置) | 无需额外依赖 |

**不推荐在 MVP 引入的：**
- MCP SDK（复杂度高，后期再考虑）
- gRPC（REST + WebSocket 已够用）
- Docker（先做好本地体验）
- VS Code 扩展（独立项目，后期启动）

---

*此文档随项目演进持续更新。每完成一个里程碑，回顾并调整后续计划。*
