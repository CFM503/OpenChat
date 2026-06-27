// ============================================================================
// OpenChat — Main Application Component
// Orchestrates all panels, state, and interactions
// ============================================================================

import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatMessage, AgentTask, ModelConfig, WorkspaceFile, TaskAction, ChatAttachment } from './core/types';
import type { ToolEvent } from './services/api';
import { createParserState, feedChunk, finalize } from './core/streamParser';
import { ModelRouter, DEFAULT_MODELS } from './core/modelRouter';
import { TaskManager } from './core/taskStateMachine';
import { simulateStream } from './core/simulatedApi';
import { canMakeRealRequest, streamRealResponse } from './core/apiClient';
import { ChatPanel } from './components/ChatPanel';
import { WorkspacePanel } from './components/WorkspacePanel';
import { ModelConfigPanel } from './components/ModelConfigPanel';
import { ExtensionPanel } from './components/ExtensionPanel';
import { SearchSettings } from './components/SearchSettings';
import { NetworkSettings } from './components/NetworkSettings';
import { SessionList, type SessionInfo } from './components/SessionList';
import { searchWeb, type SearchProviderConfig } from './core/searchClient';
import type { SearchProvider } from './core/types';
import { backendClient } from './services/api';

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
  const [models, setModels] = useState<ModelConfig[]>(() => {
    try {  // M-6: Safe JSON.parse
      const saved = localStorage.getItem('openchat_models');
      return saved ? JSON.parse(saved) : [...DEFAULT_MODELS];
    } catch { return [...DEFAULT_MODELS]; }
  });
  const [activeModelId, setActiveModelId] = useState<string>(() => {
    try {  // M-6: Safe JSON.parse
      const saved = localStorage.getItem('openchat_active_model_id');
      const savedModels = localStorage.getItem('openchat_models');
      let modelList: ModelConfig[];
      try { modelList = savedModels ? JSON.parse(savedModels) : DEFAULT_MODELS; } catch { modelList = DEFAULT_MODELS; }
      if (saved && modelList.some((m: ModelConfig) => m.id === saved)) {
        return saved;
      }
      return modelList.length > 0 ? modelList[0].id : '';
    } catch { return DEFAULT_MODELS[0]?.id ?? ''; }
  });
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>(DEFAULT_FILES);
  const [activeFileId, setActiveFileId] = useState<string>(DEFAULT_FILES[0].id);
  const [rightPanelTab, setRightPanelTab] = useState<'code' | 'tasks'>('code');
  const [showModelConfig, setShowModelConfig] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'models' | 'search' | 'network' | 'extensions'>('models');
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(() => {
    const saved = localStorage.getItem('openchat_web_search_enabled');
    return saved === 'true';
  });
  const [searchProvider, setSearchProvider] = useState<SearchProvider>(() => {
    return (localStorage.getItem('openchat_search_provider') as SearchProvider) || 'tavily';
  });
  const [searchApiKey, setSearchApiKey] = useState(() => {
    // Migrate from old tavily key if present
    return localStorage.getItem('openchat_search_api_key') || localStorage.getItem('openchat_tavily_key') || '';
  });
  const [searchBaseUrl, setSearchBaseUrl] = useState(() => {
    return localStorage.getItem('openchat_search_base_url') || 'http://localhost:8888';
  });
  const [proxyUrl, setProxyUrl] = useState(() => {
    return localStorage.getItem('openchat_proxy_url') || '';
  });
  const [proxyEnabled, setProxyEnabled] = useState(() => {
    return localStorage.getItem('openchat_proxy_enabled') === 'true';
  });
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);
  const [backendAvailable, setBackendAvailable] = useState(false);

  // --- Refs ---
  const modelRouterRef = useRef(new ModelRouter(models));
  const taskManagerRef = useRef(new TaskManager());
  const streamAbortRef = useRef<AbortController | null>(null);
  const backendAvailableRef = useRef(false);  // H-11: Ref for stale closure fix

  // --- Effects ---
  // Check backend availability on mount
  useEffect(() => {
    backendClient.isAvailable().then(async (available) => {
      if (available) {
        setBackendAvailable(true);
        backendAvailableRef.current = true;  // H-11
        await backendClient.connect();
      }
    });
    // M-7: Cleanup - abort streams and disconnect on unmount
    return () => {
      streamAbortRef.current?.abort();
      backendClient.disconnect();
    };
  }, []);

  // Load config on mount
  useEffect(() => {
    const loadLocalConfig = async () => {
      // Initial state already loaded from localStorage via useState initializers
      const localModels = localStorage.getItem('openchat_models');
      const localActiveId = localStorage.getItem('openchat_active_model_id');
      const localSearch = localStorage.getItem('openchat_web_search_enabled');
      const localSearchProvider = localStorage.getItem('openchat_search_provider');
      const localSearchApiKey = localStorage.getItem('openchat_search_api_key') || localStorage.getItem('openchat_tavily_key');
      const localSearchBaseUrl = localStorage.getItem('openchat_search_base_url');

      try {
        const response = await fetch('/api/config');
        if (response.ok) {
          const config = await response.json();
          if (config && Object.keys(config).length > 0) {
            // Backend has data — use it
            if (config.models) {
              setModels(config.models);
              modelRouterRef.current = new ModelRouter(config.models);
            }
            if (config.activeModelId) {
              setActiveModelId(config.activeModelId);
            }
            if (config.webSearchEnabled !== undefined) {
              setWebSearchEnabled(config.webSearchEnabled);
            }
            if (config.searchProvider !== undefined) {
              setSearchProvider(config.searchProvider);
            }
            if (config.searchApiKey !== undefined) {
              setSearchApiKey(config.searchApiKey);
            } else if (config.tavilyApiKey !== undefined) {
              setSearchApiKey(config.tavilyApiKey);
            }
            if (config.searchBaseUrl !== undefined) {
              setSearchBaseUrl(config.searchBaseUrl);
            }
            if (config.proxyUrl !== undefined) {
              setProxyUrl(config.proxyUrl);
            }
            if ((config as any).proxyEnabled !== undefined) {
              setProxyEnabled((config as any).proxyEnabled);
            }
          } else if (localModels) {
            // Backend empty but localStorage has data — sync localStorage → backend
            try {
              await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  models: JSON.parse(localModels),
                  activeModelId: localActiveId ?? '',
                  webSearchEnabled: localSearch === 'true',
                  searchProvider: localSearchProvider ?? 'tavily',
                  searchApiKey: localSearchApiKey ?? '',
                  searchBaseUrl: localSearchBaseUrl ?? '',
                  proxyUrl: localStorage.getItem('openchat_proxy_url') ?? '',
                  proxyEnabled: localStorage.getItem('openchat_proxy_enabled') === 'true',
                }),
              });
            } catch { /* ignore sync errors */ }
          }
        }
      } catch {
        // Backend not running — localStorage values already loaded as initial state
        console.warn('Backend not available, using localStorage config');
      } finally {
        setIsConfigLoaded(true);
      }
    };
    loadLocalConfig();
  }, []);

  // Save config on state changes (localStorage immediate, remote debounced)
  useEffect(() => {
    if (!isConfigLoaded) return;

    localStorage.setItem('openchat_models', JSON.stringify(models));
    localStorage.setItem('openchat_active_model_id', activeModelId);
    localStorage.setItem('openchat_web_search_enabled', String(webSearchEnabled));
    localStorage.setItem('openchat_search_provider', searchProvider);
    localStorage.setItem('openchat_search_api_key', searchApiKey);
    localStorage.setItem('openchat_search_base_url', searchBaseUrl);
    localStorage.setItem('openchat_proxy_url', proxyUrl);
    localStorage.setItem('openchat_proxy_enabled', String(proxyEnabled));

    const timer = setTimeout(async () => {
      try {
        await fetch('/api/config', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            models,
            activeModelId,
            webSearchEnabled,
            searchProvider,
            searchApiKey,
            searchBaseUrl,
            proxyUrl,
            proxyEnabled,
          }),
        });
      } catch (err) {
        console.error('Failed to save local config:', err);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [models, activeModelId, webSearchEnabled, searchProvider, searchApiKey, searchBaseUrl, proxyUrl, proxyEnabled, isConfigLoaded]);

  // Load sessions on mount
  useEffect(() => {
    backendClient.getSessions().then(list => {
      setSessions(list.map(s => ({
        id: s.id,
        title: s.title,
        messageCount: s.messages.length,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })));
    }).catch(() => {});
  }, []);

  // Auto-save current session when messages change
  useEffect(() => {
    if (!activeSessionId || messages.length === 0) return;
    const timer = setTimeout(() => {
      backendClient.updateSession(activeSessionId, messages).catch(() => {});
    }, 1000);
    return () => clearTimeout(timer);
  }, [messages, activeSessionId]);

  // Session handlers
  const handleNewSession = useCallback(async () => {
    // Save current session if needed
    setMessages([]);
    setActiveSessionId(null);
  }, []);

  const handleSelectSession = useCallback(async (id: string) => {
    const session = await backendClient.getSession(id);
    if (session) {
      setActiveSessionId(id);
      setMessages(session.messages);
    }
  }, []);

  const handleDeleteSession = useCallback(async (id: string) => {
    await backendClient.deleteSession(id);
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeSessionId === id) {
      setActiveSessionId(null);
      setMessages([]);
    }
  }, [activeSessionId]);

  // Create session on first message if none active
  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (activeSessionId) return activeSessionId;
    const result = await backendClient.createSession();
    if (result) {
      setActiveSessionId(result.id);
      setSessions(prev => [{
        id: result.id,
        title: 'New Chat',
        messageCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }, ...prev]);
      return result.id;
    }
    return null;
  }, [activeSessionId]);

  const hasSearchKey = searchProvider === 'searxng' ? !!searchBaseUrl.trim() : !!searchApiKey.trim();

  const handleToggleWebSearch = useCallback((enabled: boolean) => {
    if (enabled && !hasSearchKey) {
      alert("Search API Key is missing. Please configure it in the Settings panel.");
      setShowModelConfig(true);
      return;
    }
    setWebSearchEnabled(enabled);
  }, [hasSearchKey]);

  const handleSendMessage = useCallback(
    async (content: string, attachments?: ChatAttachment[]) => {
      if (isStreaming) return;
      if (content.trim().length === 0 && (!attachments || attachments.length === 0)) return;

      // Auto-create session if none active
      await ensureSession();

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
      const abortController = new AbortController();
      streamAbortRef.current = abortController;

      // Start streaming
      let parserState = createParserState();
      let accumulatedContent = '';
      let accumulatedThinking = '';

      // Shared chunk handler for both real and simulated streams
      const handleChunk = (chunk: string) => {
        if (streamAbortRef.current?.signal.aborted) return;

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
        streamAbortRef.current = null;
      };

      let injectedMessages = [...messages, userMsg];

      if (webSearchEnabled && hasSearchKey) {
        // Set state to "Searching..."
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: `🔍 Searching the web for: "${content.trim()}"...`,
                }
              : m
          )
        );

        try {
          const searchConfig: SearchProviderConfig = {
            provider: searchProvider,
            apiKey: searchApiKey,
            baseUrl: searchBaseUrl,
          };
          const searchContext = await searchWeb(content.trim(), searchConfig);
          
          const systemMsg: ChatMessage = {
            id: uid('msg'),
            role: 'system',
            content: `Today's date: ${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}.\n\n${searchContext}`,
            timestamp: Date.now(),
          };
          
          injectedMessages = [...messages, systemMsg, userMsg];
          
          // Clear "Searching..." so assistant content starts fresh
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    content: '',
                  }
                : m
            )
          );
        } catch (err: any) {
          console.error('Search failed:', err);
          accumulatedContent = `⚠️ **Web Search Failed**: ${err.message}\n\n`;
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    content: accumulatedContent,
                    isStreaming: false,
                  }
                : m
            )
          );
          setIsStreaming(false);  // M-4: Stop streaming state
          streamAbortRef.current = null;
          return;  // M-4: Prevent falling through to API call
        }
      }

      // Decide: backend gateway, real API, or simulated demo
      const activeConfig = modelRouterRef.current.getModel(activeModelId);
      if (backendAvailableRef.current && backendClient.isConnected()) {  // H-11: Use ref for fresh value
        // ── Backend gateway (with tool execution) ──
        const toolEvents: ToolEvent[] = [];
        let assistantContent = '';

        const sent = await backendClient.sendMessage(injectedMessages, activeModelId, {
          onContent: (text) => {
            assistantContent += text;
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantMsgId
                  ? { ...m, content: assistantContent }
                  : m
              )
            );
          },
          onThinking: (text) => {
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantMsgId
                  ? { ...m, thinking: (m.thinking ?? '') + text }
                  : m
              )
            );
          },
          onToolEvent: (event) => {
            toolEvents.push(event);
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantMsgId
                  ? { ...m, toolEvents: [...toolEvents] }
                  : m
              )
            );
          },
          onDone: () => {
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantMsgId
                  ? { ...m, isStreaming: false }
                  : m
              )
            );
            setIsStreaming(false);
            streamAbortRef.current = null;
          },
          onError: (message) => {
            assistantContent += `\n\n⚠️ **Error**: ${message}`;
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantMsgId
                  ? { ...m, content: assistantContent, isStreaming: false }
                  : m
              )
            );
            setIsStreaming(false);
            streamAbortRef.current = null;
          },
        });

        // If WebSocket send failed, fall through to direct/demo
        if (!sent) {
          setBackendAvailable(false);
          backendAvailableRef.current = false;  // H-11: Keep ref in sync
          // Fall through to next branch
        } else {
          // Successfully sent via backend, done
          return;
        }
      }

      if (canMakeRealRequest(activeConfig)) {
        // Always try backend first (avoids CORS issues with local LLMs like LM Studio)
        if (!backendAvailableRef.current) {
          const reconnected = await backendClient.connect();
          if (reconnected) {
            backendAvailableRef.current = true;
            setBackendAvailable(true);
          }
        }

        if (backendAvailableRef.current && backendClient.isConnected()) {
          const sent = await backendClient.sendMessage(injectedMessages, activeModelId, {
            onContent: (text) => {
              accumulatedContent += text;
              setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: accumulatedContent } : m));
            },
            onThinking: () => {},
            onToolEvent: () => {},
            onDone: () => { handleDone(); },
            onError: (msg) => { accumulatedContent += `\n\n⚠️ **API Error**: ${msg}`; handleDone(); },
          });
          if (sent) return;
        }

        // Backend unavailable — show error instead of CORS-failing direct fetch
        accumulatedContent += `\n\n⚠️ **Backend not running**. Start with \`npm run dev:server\` or \`npm run dev:all\` to enable API calls.`;
        handleDone();
      } else {
        // ── Demo simulation fallback ──
        simulateStream(
          injectedMessages,
          handleChunk,
          handleDone,
          { speed: 60 }
        );
      }
    },
    [isStreaming, activeModelId, messages, webSearchEnabled, searchProvider, searchApiKey, searchBaseUrl, hasSearchKey, proxyUrl, proxyEnabled, ensureSession]
  );

  // --- Stop streaming handler ---
  const handleStopStreaming = useCallback(() => {
    if (backendAvailableRef.current) {  // H-11: Use ref
      backendClient.abort();
    }
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
    }
  }, []);  // H-11: No dependency on backendAvailable, using ref

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
              <span className={`status-dot ${backendAvailable ? 'status-dot-active' : ''}`} />
              <span className="model-label">
                {backendAvailable ? 'Agent' : (canMakeRealRequest(modelRouterRef.current.getModel(activeModelId)) ? 'Direct' : 'Demo')}
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
        {/* Session Sidebar */}
        {!sidebarCollapsed && (
          <div className="session-sidebar">
            <SessionList
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelect={handleSelectSession}
              onNew={handleNewSession}
              onDelete={handleDeleteSession}
            />
          </div>
        )}

        {/* Left Panel — Chat */}
        <div className="panel panel-left" id="chat-panel">
          <ChatPanel
            messages={messages}
            onSendMessage={handleSendMessage}
            isStreaming={isStreaming}
            onStopStreaming={handleStopStreaming}
            webSearchEnabled={webSearchEnabled}
            onToggleWebSearch={handleToggleWebSearch}
            hasSearchKey={hasSearchKey}
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

      {/* ── Settings Modal ──────────────────────────────────────────── */}
      {showModelConfig && (
        <div className="modal-overlay" onClick={() => setShowModelConfig(false)}>
          <div className="modal-content modal-large" style={{ display: 'flex', flexDirection: 'column', maxHeight: '85vh' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Settings</h2>
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
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              {/* Sidebar */}
              <div className="settings-sidebar">
                {([
                  { id: 'models' as const, icon: '🤖', label: 'Models' },
                  { id: 'search' as const, icon: '🔍', label: 'Search' },
                  { id: 'network' as const, icon: '🌐', label: 'Network' },
                  { id: 'extensions' as const, icon: '🧩', label: 'Extensions' },
                ]).map(item => (
                  <button
                    key={item.id}
                    className={`settings-sidebar-item ${settingsTab === item.id ? 'active' : ''}`}
                    onClick={() => setSettingsTab(item.id)}
                  >
                    <span>{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
              {/* Content */}
              <div className="settings-content">
                {settingsTab === 'models' && (
                  <ModelConfigPanel
                    models={models}
                    activeModelId={activeModelId}
                    onAddModel={handleAddModel}
                    onUpdateModel={handleUpdateModel}
                    onDeleteModel={handleDeleteModel}
                    onSetActive={setActiveModelId}
                  />
                )}
                {settingsTab === 'search' && (
                  <SearchSettings
                    searchProvider={searchProvider}
                    searchApiKey={searchApiKey}
                    searchBaseUrl={searchBaseUrl}
                    onUpdateSearchProvider={setSearchProvider}
                    onUpdateSearchApiKey={setSearchApiKey}
                    onUpdateSearchBaseUrl={setSearchBaseUrl}
                  />
                )}
                {settingsTab === 'network' && (
                  <NetworkSettings
                    proxyUrl={proxyUrl}
                    proxyEnabled={proxyEnabled}
                    onUpdateProxyUrl={setProxyUrl}
                    onUpdateProxyEnabled={setProxyEnabled}
                  />
                )}
                {settingsTab === 'extensions' && (
                  <ExtensionPanel />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
