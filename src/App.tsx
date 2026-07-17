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

  const backend = useBackend();
  const config = useConfig();
  const workspace = useWorkspace();
  const layout = usePanelLayout();

  const ensureSessionRef = useRef<() => Promise<string | null>>(async () => null);

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
    ensureSessionRef,
    onNeedSearchSettings: () => {
      setSettingsTab('search');
      setShowModelConfig(true);
    },
  });

  const sessions = useSessions(chat.messages, chat.setMessages);
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
      if (mod && e.key === 'b') {
        e.preventDefault();
        layout.setSidebarCollapsed(prev => !prev);
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
              <span className={`status-dot ${backend.backendAvailable ? 'status-dot-active' : ''}`} />
              <span className="model-label">{modeLabel}</span>
            </div>
            {chat.lastPackStats && (
              <span
                className="logo-badge"
                style={{ fontSize: '0.65rem', marginLeft: 8 }}
                title={`strategy=${chat.lastPackStats.strategy} kept=${chat.lastPackStats.keptMessages} dropped=${chat.lastPackStats.droppedMessages}`}
              >
                ~{chat.lastPackStats.estimatedTokens} tok
              </span>
            )}
          </div>
        </div>

        <div className="header-right">
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
            className={`btn-ghost ${workspace.rightPanelTab === 'tasks' ? 'active' : ''}`}
            onClick={() => workspace.setRightPanelTab('tasks')}
          >
            <span>Tasks</span>
            {tasks.tasks.length > 0 && (
              <span className="badge-count">{tasks.tasks.length}</span>
            )}
          </button>
          <button
            className={`btn-ghost ${workspace.rightPanelTab === 'code' ? 'active' : ''}`}
            onClick={() => workspace.setRightPanelTab('code')}
          >
            <span>Code</span>
          </button>
        </div>
      </header>

      <main
        className={`app-main ${layout.sidebarCollapsed ? 'sidebar-collapsed' : ''}`}
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
          style={{ flex: `0 0 ${layout.leftPanelPct}%`, minWidth: 280 }}
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
          />
        </div>

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
          />
        </div>
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
                    <h3 style={{ marginBottom: 12 }}>Agent routing (token cost)</h3>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                      Prefer a cheaper model for conversation summarization when the context packer
                      exceeds the budget. Main chat still uses the header model.
                    </p>
                    <div className="form-group">
                      <label>Cheap model (summarizer)</label>
                      <select
                        className="form-select"
                        value={config.cheapModelId}
                        onChange={e => config.setCheapModelId(e.target.value)}
                      >
                        <option value="">Same as active model</option>
                        {config.models.map(m => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>
                      Per-model context strategy: Models → Edit → Context strategy (minimal / balanced / full).
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
