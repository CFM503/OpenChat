// ============================================================================
// OpenChat — Main Application Component
// Orchestrates all panels, state, and interactions
// ============================================================================

import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatMessage, AgentTask, ModelConfig, WorkspaceFile, TaskAction, ChatAttachment } from './core/types';
import { createParserState, feedChunk, finalize } from './core/streamParser';
import { ModelRouter, DEFAULT_MODELS } from './core/modelRouter';
import { TaskManager } from './core/taskStateMachine';
import { simulateStream } from './core/simulatedApi';
import { canMakeRealRequest, streamRealResponse } from './core/apiClient';
import { ChatPanel } from './components/ChatPanel';
import { WorkspacePanel } from './components/WorkspacePanel';
import { ModelConfigPanel } from './components/ModelConfigPanel';

// ── Unique ID generator ────────────────────────────────────────────────────
let idCounter = 0;
function uid(prefix: string = 'id'): string {
  return `${prefix}_${Date.now()}_${++idCounter}`;
}

// ── Default workspace files ────────────────────────────────────────────────
const DEFAULT_FILES: WorkspaceFile[] = [
  {
    id: 'file_default_1',
    name: 'main.py',
    language: 'python',
    content: `# OpenChat Workspace — main.py
# Start coding here or ask the AI assistant for help!

def hello():
    """A simple greeting function."""
    print("Welcome to OpenChat!")

if __name__ == "__main__":
    hello()
`,
    lastModified: Date.now(),
  },
  {
    id: 'file_default_2',
    name: 'utils.ts',
    language: 'typescript',
    content: `// Utility functions

export function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function generateId(): string {
  return crypto.randomUUID();
}
`,
    lastModified: Date.now(),
  },
];

// ── App Component ──────────────────────────────────────────────────────────
export function App() {
  // --- State ---
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: uid('msg'),
      role: 'assistant',
      content: 'Welcome to **OpenChat**! I\'m your AI coding assistant.\n\n🔌 **Real Mode**: Configure your API key in ⚙️ Settings (`Ctrl+,`) to connect to OpenAI, Ollama, or any compatible endpoint.\n\n🎮 **Demo Mode**: No API key? No problem — send a message to see a simulated streaming response with `<thinking>` block support!',
      timestamp: Date.now(),
    },
  ]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [models, setModels] = useState<ModelConfig[]>([...DEFAULT_MODELS]);
  const [activeModelId, setActiveModelId] = useState<string>(DEFAULT_MODELS[0].id);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>(DEFAULT_FILES);
  const [activeFileId, setActiveFileId] = useState<string>(DEFAULT_FILES[0].id);
  const [rightPanelTab, setRightPanelTab] = useState<'code' | 'tasks'>('code');
  const [showModelConfig, setShowModelConfig] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // --- Refs ---
  const modelRouterRef = useRef(new ModelRouter([...DEFAULT_MODELS]));
  const taskManagerRef = useRef(new TaskManager());
  const streamAbortRef = useRef(false);

  // --- Chat handlers ---
  const handleSendMessage = useCallback(
    (content: string, attachments?: ChatAttachment[]) => {
      if (isStreaming) return;
      if (content.trim().length === 0 && (!attachments || attachments.length === 0)) return;

      const userMsg: ChatMessage = {
        id: uid('msg'),
        role: 'user',
        content: content.trim(),
        attachments: attachments || [],
        timestamp: Date.now(),
        modelId: activeModelId,
      };

      const assistantMsgId = uid('msg');
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        thinking: '',
        timestamp: Date.now(),
        modelId: activeModelId,
        isStreaming: true,
      };

      setMessages(prev => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);
      streamAbortRef.current = false;

      // Start streaming
      let parserState = createParserState();
      let accumulatedContent = '';
      let accumulatedThinking = '';

      // Shared chunk handler for both real and simulated streams
      const handleChunk = (chunk: string) => {
        if (streamAbortRef.current) return;

        const result = feedChunk(parserState, chunk);
        parserState = result.state;

        for (const parsed of result.chunks) {
          if (parsed.type === 'thinking') {
            accumulatedThinking += parsed.text;
          } else {
            accumulatedContent += parsed.text;
          }
        }

        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: accumulatedContent,
                  thinking: accumulatedThinking,
                }
              : m
          )
        );
      };

      const handleDone = () => {
        // Finalize
        const remaining = finalize(parserState);
        for (const parsed of remaining) {
          if (parsed.type === 'thinking') {
            accumulatedThinking += parsed.text;
          } else {
            accumulatedContent += parsed.text;
          }
        }

        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: accumulatedContent,
                  thinking: accumulatedThinking,
                  isStreaming: false,
                }
              : m
          )
        );
        setIsStreaming(false);
      };

      // Decide: real API or simulated demo
      const activeConfig = modelRouterRef.current.getModel(activeModelId);
      if (canMakeRealRequest(activeConfig)) {
        // ── Real API call ──
        const abortController = new AbortController();
        streamRealResponse(
          modelRouterRef.current,
          activeModelId,
          [...messages, userMsg],
          handleChunk,
          handleDone,
          (error: Error) => {
            // On error, show the error message in the assistant bubble
            accumulatedContent += `\n\n⚠️ **API Error**: ${error.message}`;
            handleDone();
          },
          abortController.signal
        );
      } else {
        // ── Demo simulation fallback ──
        simulateStream(
          [...messages, userMsg],
          handleChunk,
          handleDone,
          { speed: 60 }
        );
      }
    },
    [isStreaming, activeModelId, messages]
  );

  // --- Model handlers ---
  const handleAddModel = useCallback((config: ModelConfig) => {
    modelRouterRef.current.addModel(config);
    setModels(modelRouterRef.current.getAllModels());
  }, []);

  const handleUpdateModel = useCallback((config: ModelConfig) => {
    modelRouterRef.current.addModel(config);
    setModels(modelRouterRef.current.getAllModels());
  }, []);

  const handleDeleteModel = useCallback(
    (id: string) => {
      modelRouterRef.current.removeModel(id);
      setModels(modelRouterRef.current.getAllModels());
      if (activeModelId === id) {
        const remaining = modelRouterRef.current.getAllModels();
        setActiveModelId(remaining.length > 0 ? remaining[0].id : '');
      }
    },
    [activeModelId]
  );

  // --- Task handlers ---
  const handleCreateTask = useCallback(
    (title: string, description: string, assignee: string, priority: AgentTask['priority']) => {
      const task = taskManagerRef.current.create(title, description, assignee, priority);
      setTasks(taskManagerRef.current.getTasks());
      return task;
    },
    []
  );

  const handleTaskAction = useCallback((taskId: string, action: TaskAction, payload?: string) => {
    try {
      taskManagerRef.current.dispatch(taskId, action, payload);
      setTasks(taskManagerRef.current.getTasks());
    } catch (err) {
      console.error('Task action failed:', err);
    }
  }, []);

  // --- File handlers ---
  const handleFileChange = useCallback((id: string, content: string) => {
    setWorkspaceFiles(prev =>
      prev.map(f => (f.id === id ? { ...f, content, lastModified: Date.now() } : f))
    );
  }, []);

  const handleAddFile = useCallback((name: string, language: string) => {
    const newFile: WorkspaceFile = {
      id: uid('file'),
      name,
      language,
      content: `// ${name}\n`,
      lastModified: Date.now(),
    };
    setWorkspaceFiles(prev => [...prev, newFile]);
    setActiveFileId(newFile.id);
  }, []);

  // --- Keyboard shortcut for model config ---
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        setShowModelConfig(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // --- Render ---
  return (
    <div className="app-root">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <header className="app-header">
        <div className="header-left">
          <button
            className="btn-icon sidebar-toggle"
            onClick={() => setSidebarCollapsed(prev => !prev)}
            aria-label="Toggle sidebar"
            id="sidebar-toggle"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12h18M3 6h18M3 18h18" />
            </svg>
          </button>
          <div className="logo">
            <div className="logo-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <defs>
                  <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#6366f1" />
                    <stop offset="50%" stopColor="#8b5cf6" />
                    <stop offset="100%" stopColor="#06b6d4" />
                  </linearGradient>
                </defs>
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="url(#logoGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="logo-text">OpenChat</span>
            <span className="logo-badge">ALPHA</span>
          </div>
        </div>

        <div className="header-center">
          <div className="model-selector" id="model-selector">
            <select
              value={activeModelId}
              onChange={e => setActiveModelId(e.target.value)}
              className="model-select"
            >
              {models.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <div className="model-indicator">
              <span className="status-dot status-dot-active" />
              <span className="model-label">
                {models.find(m => m.id === activeModelId)?.provider ?? 'unknown'}
              </span>
            </div>
          </div>
        </div>

        <div className="header-right">
          <button
            className="btn-ghost"
            onClick={() => setShowModelConfig(prev => !prev)}
            id="btn-model-config"
            title="Model Settings (Ctrl+,)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
            <span>Settings</span>
          </button>
          <button
            className={`btn-ghost ${rightPanelTab === 'tasks' ? 'active' : ''}`}
            onClick={() => setRightPanelTab('tasks')}
            id="btn-show-tasks"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
            </svg>
            <span>Tasks</span>
            {tasks.length > 0 && <span className="badge-count">{tasks.length}</span>}
          </button>
          <button
            className={`btn-ghost ${rightPanelTab === 'code' ? 'active' : ''}`}
            onClick={() => setRightPanelTab('code')}
            id="btn-show-code"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="16,18 22,12 16,6" />
              <polyline points="8,6 2,12 8,18" />
            </svg>
            <span>Code</span>
          </button>
        </div>
      </header>

      {/* ── Main Content ─────────────────────────────────────────────── */}
      <main className={`app-main ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        {/* Left Panel — Chat */}
        <div className="panel panel-left" id="chat-panel">
          <ChatPanel
            messages={messages}
            onSendMessage={handleSendMessage}
            isStreaming={isStreaming}
          />
        </div>

        {/* Divider */}
        <div className="panel-divider" id="panel-divider">
          <div className="divider-handle" />
        </div>

        {/* Right Panel — Workspace */}
        <div className="panel panel-right" id="workspace-panel">
          <WorkspacePanel
            activeTab={rightPanelTab}
            onTabChange={setRightPanelTab}
            tasks={tasks}
            onCreateTask={handleCreateTask}
            onTaskAction={handleTaskAction}
            workspaceFiles={workspaceFiles}
            onFileChange={handleFileChange}
            onAddFile={handleAddFile}
            activeFileId={activeFileId}
            onSelectFile={setActiveFileId}
          />
        </div>
      </main>

      {/* ── Model Config Modal ───────────────────────────────────────── */}
      {showModelConfig && (
        <div className="modal-overlay" onClick={() => setShowModelConfig(false)}>
          <div className="modal-content modal-large" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Model Configuration</h2>
              <button
                className="btn-icon"
                onClick={() => setShowModelConfig(false)}
                id="btn-close-model-config"
                aria-label="Close"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <ModelConfigPanel
              models={models}
              activeModelId={activeModelId}
              onAddModel={handleAddModel}
              onUpdateModel={handleUpdateModel}
              onDeleteModel={handleDeleteModel}
              onSetActive={setActiveModelId}
            />
          </div>
        </div>
      )}
    </div>
  );
}
