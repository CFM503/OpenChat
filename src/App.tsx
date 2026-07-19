// ============================================================================
// OpenChat — Application shell (composition only)
// ============================================================================

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { canMakeRealRequest } from './core/apiClient';
import { ChatPanel } from './components/ChatPanel';
import { WorkspacePanel } from './components/WorkspacePanel';
import { ModelConfigPanel } from './components/ModelConfigPanel';
import { ExtensionPanel } from './components/ExtensionPanel';
import { SearchSettings } from './components/SearchSettings';
import { NetworkSettings } from './components/NetworkSettings';
import { SessionList } from './components/SessionList';
import { useBackend } from './hooks/useBackend';
import { useConfig } from './hooks/useConfig';
import { useSessions } from './hooks/useSessions';
import { useChat } from './hooks/useChat';
import { useWorkspace } from './hooks/useWorkspace';
import { useTasks } from './hooks/useTasks';
import { usePanelLayout } from './hooks/usePanelLayout';

export function App() {
  const [showModelConfig, setShowModelConfig] = useState(false);
  const [settingsTab, setSettingsTab] = useState<
    'models' | 'search' | 'network' | 'extensions' | 'routing'
  >('models');
  const [enableThinking, setEnableThinking] = useState(() => {
    const saved = localStorage.getItem('openchat_enable_thinking');
    // Default ON so reasoning models keep previous behavior
    return saved === null ? true : saved === 'true';
  });

  useEffect(() => {
    localStorage.setItem('openchat_enable_thinking', String(enableThinking));
  }, [enableThinking]);

  const backend = useBackend();
  const config = useConfig();
  const workspace = useWorkspace();
  const layout = usePanelLayout();

  const ensureSessionRef = useRef<() => Promise<string | null>>(async () => null);

  const handleAgentFileTouched = useCallback(
    (filePath: string) => {
      layout.setRightPanelCollapsed(false);
      workspace.setRightPanelTab('code');
      void workspace.handleOpenDiskFile(filePath);
    },
    [layout, workspace],
  );

  const chat = useChat({
    activeModelId: config.activeModelId,
    modelRouterRef: config.modelRouterRef,
    backendAvailableRef: backend.backendAvailableRef,
    markAvailable: backend.markAvailable,
    markUnavailable: backend.markUnavailable,
    webSearchEnabled: config.webSearchEnabled,
    searchProvider: config.searchProvider,
    searchApiKey: config.searchApiKey,
    searchBaseUrl: config.searchBaseUrl,
    hasSearchKey: config.hasSearchKey,
    enableThinking,
    ensureSessionRef,
    onNeedSearchSettings: () => {
      setSettingsTab('search');
      setShowModelConfig(true);
    },
    onAgentFileTouched: handleAgentFileTouched,
  });

  const sessions = useSessions(
    chat.messages,
    chat.setMessages,
    chat.resetToWelcome,
    chat.isStreaming,
  );
  ensureSessionRef.current = sessions.ensureSession;

  const tasks = useTasks(
    config.activeModelId,
    chat.isStreaming,
    backend.backendAvailableRef,
  );

  const handleToggleWebSearch = useCallback(
    (enabled: boolean) => {
      if (enabled && !config.hasSearchKey) {
        alert('Search API Key is missing. Please configure it in Settings.');
        setSettingsTab('search');
        setShowModelConfig(true);
        return;
      }
      config.setWebSearchEnabled(enabled);
    },
    [config],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === ',') {
        e.preventDefault();
        setShowModelConfig(prev => !prev);
      }
      if (mod && e.key === 'n') {
        e.preventDefault();
        sessions.handleNewSession();
      }
      if (mod && e.key === 'b' && !e.shiftKey) {
        e.preventDefault();
        layout.setSidebarCollapsed(prev => !prev);
      }
      if (mod && e.shiftKey && (e.key === 'B' || e.key === 'b')) {
        e.preventDefault();
        layout.toggleRightPanel();
      }
      if (mod && e.key === 'e') {
        e.preventDefault();
        chat.handleExportChat();
      }
      if (e.key === 'Escape' && chat.isStreaming) {
        e.preventDefault();
        chat.handleStopStreaming();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [sessions, layout, chat]);

  const activeModel = config.modelRouterRef.current.getModel(config.activeModelId);
  const modeLabel = backend.backendAvailable
    ? 'Agent'
    : canMakeRealRequest(activeModel)
      ? 'Direct'
      : 'Demo';

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="header-left">
          <button
            className="btn-icon sidebar-toggle"
            onClick={() => layout.setSidebarCollapsed(prev => !prev)}
            aria-label="Toggle sidebar"
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
                <path
                  d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                  stroke="url(#logoGrad)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <span className="logo-text">OpenChat</span>
            <span className="logo-badge">ALPHA</span>
          </div>
        </div>

        <div className="header-center">
          <div className="model-selector">
            <select
              value={config.activeModelId}
              onChange={e => config.setActiveModelId(e.target.value)}
              className="model-select"
            >
              {config.models.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <div className="model-indicator">
              <span
                className={`status-dot ${
                  backend.connectionState === 'online'
                    ? 'status-dot-active'
                    : backend.connectionState === 'reconnecting'
                      ? 'status-dot-warn'
                      : ''
                }`}
              />
              <span className="model-label">
                {backend.connectionState === 'offline'
                  ? 'Offline'
                  : backend.connectionState === 'reconnecting'
                    ? 'Reconnecting'
                    : modeLabel}
              </span>
            </div>
            {chat.lastPackStats && (
              <span
                className="logo-badge"
                style={{ fontSize: '0.65rem', marginLeft: 8 }}
                title={
                  `strategy=${chat.lastPackStats.strategy}` +
                  ` kept=${chat.lastPackStats.keptMessages}` +
                  ` dropped=${chat.lastPackStats.droppedMessages}` +
                  (chat.lastPackStats.agentModelName
                    ? ` agent=${chat.lastPackStats.agentModelName}`
                    : chat.lastAgentRouting
                      ? ` agent=${chat.lastAgentRouting.agentModelName}`
                      : '') +
                  (chat.lastPackStats.summaryModelName
                    ? ` summary=${chat.lastPackStats.summaryModelName}`
                    : chat.lastAgentRouting
                      ? ` summary=${chat.lastAgentRouting.summaryModelName}`
                      : '') +
                  (chat.lastPackStats.truncatedTools
                    ? ` toolsTrunc=${chat.lastPackStats.truncatedTools}`
                    : '') +
                  (chat.lastPackStats.appendOnly ? ' appendOnly' : '') +
                  (chat.lastPackStats.promptCacheSession ? ' sessionCache' : '') +
                  (chat.lastPackStats.cachedTokens != null
                    ? ` cached=${chat.lastPackStats.cachedTokens}`
                    : '') +
                  (chat.lastPackStats.promptTokens != null
                    ? ` prompt=${chat.lastPackStats.promptTokens}`
                    : '') +
                  (chat.lastPackStats.cacheHitRate != null
                    ? ` hit=${Math.round(chat.lastPackStats.cacheHitRate * 100)}%`
                    : '') +
                  (chat.lastPackStats.totalCachedTokens != null
                    ? ` totalCached=${chat.lastPackStats.totalCachedTokens}`
                    : '') +
                  (chat.lastPackStats.llmCompressed
                    ? ' llmCompressed'
                    : chat.lastPackStats.compressed
                      ? ' packed'
                      : '') +
                  (chat.lastPackStats.summaryPreview
                    ? `\n${chat.lastPackStats.summaryPreview}`
                    : '')
                }
              >
                ~{chat.lastPackStats.estimatedTokens} tok
                {(chat.lastPackStats.agentModelName || chat.lastAgentRouting?.agentModelName)
                  ? ` · ${chat.lastPackStats.agentModelName || chat.lastAgentRouting?.agentModelName}`
                  : ''}
                {chat.lastPackStats.cachedTokens != null && chat.lastPackStats.cachedTokens > 0
                  ? ` · cache ${chat.lastPackStats.cachedTokens}`
                  : chat.lastPackStats.appendOnly
                    ? ' · cache+'
                    : ''}
                {chat.lastPackStats.cacheHitRate != null && chat.lastPackStats.cacheHitRate > 0
                  ? ` ${Math.round(chat.lastPackStats.cacheHitRate * 100)}%`
                  : ''}
                {chat.lastPackStats.llmCompressed
                  ? ' · zip'
                  : chat.lastPackStats.compressed
                    ? ' · pack'
                    : ''}
              </span>
            )}
          </div>
        </div>

        <div className="header-right">
          <button
            className="btn-ghost"
            onClick={() => void chat.handleCompressContext()}
            disabled={chat.isStreaming}
            title="Compress conversation context (token budget + LLM summary)"
          >
            <span>Compress</span>
          </button>
          <button className="btn-ghost" onClick={chat.handleExportChat} title="Export (Ctrl+E)">
            <span>Export</span>
          </button>
          <button
            className="btn-ghost"
            onClick={() => setShowModelConfig(prev => !prev)}
            title="Settings (Ctrl+,)"
          >
            <span>Settings</span>
          </button>
          <button
            className={`btn-ghost ${!layout.rightPanelCollapsed && workspace.rightPanelTab === 'tasks' ? 'active' : ''}`}
            onClick={() => {
              layout.setRightPanelCollapsed(false);
              workspace.setRightPanelTab('tasks');
            }}
            title="Task board"
          >
            <span>Tasks</span>
            {tasks.tasks.length > 0 && (
              <span className="badge-count">{tasks.tasks.length}</span>
            )}
          </button>
          <button
            className={`btn-ghost ${!layout.rightPanelCollapsed && workspace.rightPanelTab === 'code' ? 'active' : ''}`}
            onClick={() => {
              layout.setRightPanelCollapsed(false);
              workspace.setRightPanelTab('code');
            }}
            title="Code canvas"
          >
            <span>Code</span>
          </button>
          <button
            className={`btn-ghost ${layout.rightPanelCollapsed ? 'active' : ''}`}
            onClick={layout.toggleRightPanel}
            title={
              layout.rightPanelCollapsed
                ? 'Show workspace (Ctrl+Shift+B)'
                : 'Hide workspace (Ctrl+Shift+B)'
            }
            aria-pressed={layout.rightPanelCollapsed}
            aria-label="Toggle right workspace panel"
          >
            <span>{layout.rightPanelCollapsed ? 'Show panel' : 'Hide panel'}</span>
          </button>
        </div>
      </header>

      <main
        className={`app-main ${layout.sidebarCollapsed ? 'sidebar-collapsed' : ''} ${layout.rightPanelCollapsed ? 'right-collapsed' : ''}`}
        ref={el => {
          layout.mainRef.current = el;
        }}
      >
        {!layout.sidebarCollapsed && (
          <div className="session-sidebar">
            <SessionList
              sessions={sessions.sessions}
              activeSessionId={sessions.activeSessionId}
              onSelect={sessions.handleSelectSession}
              onNew={sessions.handleNewSession}
              onDelete={sessions.handleDeleteSession}
            />
          </div>
        )}

        <div
          className="panel panel-left"
          style={
            layout.rightPanelCollapsed
              ? { flex: '1 1 auto', minWidth: 280 }
              : { flex: `0 0 ${layout.leftPanelPct}%`, minWidth: 280 }
          }
        >
          <ChatPanel
            messages={chat.messages}
            onSendMessage={chat.handleSendMessage}
            onRetryMessage={chat.handleRetryMessage}
            isStreaming={chat.isStreaming}
            onStopStreaming={chat.handleStopStreaming}
            webSearchEnabled={config.webSearchEnabled}
            onToggleWebSearch={handleToggleWebSearch}
            hasSearchKey={config.hasSearchKey}
            enableThinking={enableThinking}
            onToggleThinking={setEnableThinking}
            activity={chat.activity}
            connectionState={backend.connectionState}
            onReconnect={backend.reconnect}
            packStatsLabel={
              chat.lastPackStats && !chat.isStreaming
                ? `Context ~${chat.lastPackStats.estimatedTokens} tok · ${chat.lastPackStats.strategy}` +
                  (chat.lastPackStats.agentModelName || chat.lastAgentRouting?.agentModelName
                    ? ` · agent ${chat.lastPackStats.agentModelName || chat.lastAgentRouting?.agentModelName}`
                    : '') +
                  (chat.lastPackStats.llmCompressed &&
                  (chat.lastPackStats.summaryModelName || chat.lastAgentRouting?.summaryModelName)
                    ? ` · zip via ${chat.lastPackStats.summaryModelName || chat.lastAgentRouting?.summaryModelName}`
                    : '') +
                  (chat.lastPackStats.appendOnly || chat.lastPackStats.promptCacheSession
                    ? ' · session cache'
                    : '') +
                  (chat.lastPackStats.cachedTokens != null && chat.lastPackStats.cachedTokens > 0
                    ? ` · ${chat.lastPackStats.cachedTokens} cached` +
                      (chat.lastPackStats.cacheHitRate != null
                        ? ` (${Math.round(chat.lastPackStats.cacheHitRate * 100)}%)`
                        : '')
                    : '') +
                  (chat.lastPackStats.droppedMessages
                    ? ` · −${chat.lastPackStats.droppedMessages} msgs`
                    : '') +
                  (chat.lastPackStats.llmCompressed
                    ? ' · LLM compressed'
                    : chat.lastPackStats.compressed
                      ? ' · packed'
                      : '')
                : null
            }
            onCompressContext={chat.handleCompressContext}
          />
        </div>

        {!layout.rightPanelCollapsed && (
          <>
            <div className="panel-divider" onMouseDown={layout.startResize} title="Drag to resize">
              <div className="divider-handle" />
            </div>

            <div className="panel panel-right" style={{ flex: '1 1 auto', minWidth: 280 }}>
              <WorkspacePanel
                activeTab={workspace.rightPanelTab}
                onTabChange={workspace.setRightPanelTab}
                tasks={tasks.tasks}
                onCreateTask={tasks.handleCreateTask}
                onTaskAction={tasks.handleTaskAction}
                workspaceFiles={workspace.workspaceFiles}
                onFileChange={workspace.handleFileChange}
                onAddFile={workspace.handleAddFile}
                onCloseFile={workspace.handleCloseFile}
                onSaveFile={workspace.handleSaveFile}
                onOpenDiskFile={workspace.handleOpenDiskFile}
                activeFileId={workspace.activeFileId}
                onSelectFile={workspace.setActiveFileId}
                onCollapse={() => layout.setRightPanelCollapsed(true)}
              />
            </div>
          </>
        )}
      </main>

      {showModelConfig && (
        <div className="modal-overlay" onClick={() => setShowModelConfig(false)}>
          <div
            className="modal-content modal-large"
            style={{ display: 'flex', flexDirection: 'column', maxHeight: '85vh' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>Settings</h2>
              <button className="btn-icon" onClick={() => setShowModelConfig(false)} aria-label="Close">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              <div className="settings-sidebar">
                {(
                  [
                    { id: 'models' as const, icon: '🤖', label: 'Models' },
                    { id: 'routing' as const, icon: '🧭', label: 'Routing' },
                    { id: 'search' as const, icon: '🔍', label: 'Search' },
                    { id: 'network' as const, icon: '🌐', label: 'Network' },
                    { id: 'extensions' as const, icon: '🧩', label: 'Extensions' },
                  ] as const
                ).map(item => (
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
              <div className="settings-content">
                {settingsTab === 'models' && (
                  <ModelConfigPanel
                    models={config.models}
                    activeModelId={config.activeModelId}
                    onAddModel={config.handleAddModel}
                    onUpdateModel={config.handleUpdateModel}
                    onDeleteModel={config.handleDeleteModel}
                    onSetActive={config.setActiveModelId}
                  />
                )}
                {settingsTab === 'routing' && (
                  <div>
                    <h3 style={{ marginBottom: 12 }}>Agent routing (multi-model)</h3>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                      Split work across models to save money and keep quality:
                      <strong> cheap</strong> for history compression,
                      <strong> coding</strong> for the tool/agent loop,
                      header model as the default when overrides are empty.
                    </p>
                    <div className="form-group" style={{ marginBottom: 14 }}>
                      <label>Coding / agent model</label>
                      <select
                        className="form-select"
                        value={config.codingModelId}
                        onChange={e => config.setCodingModelId(e.target.value)}
                      >
                        <option value="">Same as header (active) model</option>
                        {config.models.map(m => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({m.model})
                          </option>
                        ))}
                      </select>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                        Used for chat + tools (bash, files, git…). Pick your strongest coding model here.
                      </span>
                    </div>
                    <div className="form-group">
                      <label>Cheap model (summarizer)</label>
                      <select
                        className="form-select"
                        value={config.cheapModelId}
                        onChange={e => config.setCheapModelId(e.target.value)}
                      >
                        <option value="">Same as header (active) model</option>
                        {config.models.map(m => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({m.model})
                          </option>
                        ))}
                      </select>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                        Used when context is compressed (/compress or auto). Prefer a small/fast model.
                      </span>
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 16 }}>
                      Tip: header model can stay as your daily default; set coding = Claude/DeepSeek-V3 and
                      cheap = flash/mini. Context strategy still lives under Models → Edit.
                    </p>
                  </div>
                )}
                {settingsTab === 'search' && (
                  <SearchSettings
                    searchProvider={config.searchProvider}
                    searchApiKey={config.searchApiKey}
                    searchBaseUrl={config.searchBaseUrl}
                    onUpdateSearchProvider={config.setSearchProvider}
                    onUpdateSearchApiKey={config.setSearchApiKey}
                    onUpdateSearchBaseUrl={config.setSearchBaseUrl}
                  />
                )}
                {settingsTab === 'network' && (
                  <NetworkSettings
                    proxyUrl={config.proxyUrl}
                    proxyEnabled={config.proxyEnabled}
                    allowedDirectories={config.allowedDirectories}
                    onUpdateProxyUrl={config.setProxyUrl}
                    onUpdateProxyEnabled={config.setProxyEnabled}
                    onUpdateAllowedDirectories={config.setAllowedDirectories}
                  />
                )}
                {settingsTab === 'extensions' && <ExtensionPanel />}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
