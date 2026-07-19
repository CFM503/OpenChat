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
import { usePatches } from './hooks/usePatches';
import { usePanelLayout } from './hooks/usePanelLayout';
import { DiffReviewPanel } from './components/DiffReviewPanel';
import { ToastBanner, type ToastItem } from './components/ToastBanner';
import {
  formatPackBadge,
  formatPackTooltip,
  formatPackFooter,
} from './lib/statusLabels';
import { uid } from './lib/uid';
import { backendClient } from './services/api';

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
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [workingDirectory, setWorkingDirectory] = useState('');
  const [recentDirectories, setRecentDirectories] = useState<string[]>(() => {
    try {
      const s = localStorage.getItem('openchat_recent_cwds');
      return s ? (JSON.parse(s) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [switchingCwd, setSwitchingCwd] = useState(false);

  const pushToast = useCallback((kind: ToastItem['kind'], message: string, duration?: number) => {
    const id = uid('toast');
    setToasts(prev => [...prev.slice(-4), { id, kind, message, duration }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    localStorage.setItem('openchat_enable_thinking', String(enableThinking));
  }, [enableThinking]);

  useEffect(() => {
    localStorage.setItem('openchat_recent_cwds', JSON.stringify(recentDirectories.slice(0, 8)));
  }, [recentDirectories]);

  const backend = useBackend();
  const config = useConfig();
  const workspace = useWorkspace();
  const layout = usePanelLayout();

  // Sync cwd from backend on load / reconnect
  useEffect(() => {
    if (backend.connectionState !== 'online') return;
    void backendClient.getWorkingDirectory().then(p => {
      if (p) setWorkingDirectory(p);
    });
  }, [backend.connectionState]);

  const changeWorkingDirectory = useCallback(
    async (path: string) => {
      setSwitchingCwd(true);
      try {
        const r = await backendClient.setWorkingDirectory(path);
        if (!r.ok) return { ok: false as const, error: r.error };
        setWorkingDirectory(r.path);
        setRecentDirectories(prev => {
          const next = [r.path, ...prev.filter(x => x !== r.path)];
          return next.slice(0, 8);
        });
        // Clear open editors from previous project (paths invalid)
        // workspace doesn't expose clear — leave tabs; tree will refresh
        pushToast('success', `工作目录已切换：${r.path}`);
        return { ok: true as const, path: r.path };
      } finally {
        setSwitchingCwd(false);
      }
    },
    [pushToast],
  );

  const ensureSessionRef = useRef<() => Promise<string | null>>(async () => null);

  const patches = usePatches();

  const handleAgentFileTouched = useCallback(
    (filePath: string) => {
      layout.setRightPanelCollapsed(false);
      workspace.setRightPanelTab('code');
      void workspace.handleOpenDiskFile(filePath);
    },
    [layout, workspace],
  );

  const sessionsRef = useRef<{ ensureSession: () => Promise<string | null> } | null>(null);
  const isStreamingRef = useRef(false);

  const tasks = useTasks(
    config.activeModelId,
    isStreamingRef,
    backend.backendAvailableRef,
    {
      ensureSession: () => sessionsRef.current?.ensureSession() ?? Promise.resolve(null),
      onPendingPatch: p => {
        patches.upsertPatch(p);
        layout.setRightPanelCollapsed(false);
        pushToast('info', `任务暂存文件：${p.path}`);
      },
    },
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
    onPendingPatch: p => {
      patches.upsertPatch(p);
      layout.setRightPanelCollapsed(false);
      pushToast('info', `已暂存改动：${p.path}（请在下方审阅后「应用」）`);
    },
    chatTaskBridge: config.chatTaskBridge,
    onTaskBridgeCreate: (title, description) => {
      layout.setRightPanelCollapsed(false);
      workspace.setRightPanelTab('tasks');
      return tasks.createRunningTask(title, description);
    },
    onTaskEvent: ev => {
      tasks.handleTaskEvent(ev);
      if (ev.action === 'complete') {
        pushToast('success', ev.message || '任务已完成');
      } else if (ev.action === 'fail') {
        pushToast('error', ev.message || '任务失败');
      }
    },
  });

  const sessions = useSessions(
    chat.messages,
    chat.setMessages,
    chat.resetToWelcome,
    chat.isStreaming,
  );
  ensureSessionRef.current = sessions.ensureSession;
  sessionsRef.current = { ensureSession: sessions.ensureSession };
  isStreamingRef.current = chat.isStreaming;

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
      <ToastBanner toasts={toasts} onDismiss={dismissToast} />
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
                style={{ fontSize: '0.65rem', marginLeft: 8, maxWidth: 420 }}
                title={formatPackTooltip(chat.lastPackStats, chat.lastAgentRouting)}
              >
                {formatPackBadge(chat.lastPackStats, chat.lastAgentRouting)}
              </span>
            )}
            {patches.patches.length > 0 && (
              <span
                className="logo-badge"
                style={{
                  fontSize: '0.65rem',
                  marginLeft: 6,
                  background: 'rgba(212, 167, 44, 0.25)',
                  borderColor: '#d4a72c',
                }}
                title="有文件改动待确认，请在聊天区下方审阅并应用"
              >
                待应用 {patches.patches.length}
              </span>
            )}
            {workingDirectory && (
              <span
                className="logo-badge"
                style={{ fontSize: '0.6rem', marginLeft: 6, maxWidth: 220, cursor: 'pointer' }}
                title={`工作目录（点击打开设置）\n${workingDirectory}`}
                onClick={() => {
                  setSettingsTab('network');
                  setShowModelConfig(true);
                }}
              >
                📁 {workingDirectory.split(/[/\\]/).filter(Boolean).pop() || workingDirectory}
              </span>
            )}
          </div>
        </div>

        <div className="header-right">
          <button
            className="btn-ghost"
            onClick={() => void chat.handleCompressContext()}
            disabled={chat.isStreaming}
            title="压缩对话历史以节省上下文（可能打断部分缓存）"
          >
            <span>压缩</span>
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
              ? { flex: '1 1 auto', minWidth: 280, display: 'flex', flexDirection: 'column' }
              : { flex: `0 0 ${layout.leftPanelPct}%`, minWidth: 280, display: 'flex', flexDirection: 'column' }
          }
        >
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
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
                  ? formatPackFooter(chat.lastPackStats, chat.lastAgentRouting)
                  : null
              }
              onCompressContext={chat.handleCompressContext}
            />
          </div>
          <DiffReviewPanel
            patches={patches.patches}
            busy={patches.busy}
            onApply={async id => {
              try {
                const path = await patches.applyPatch(id);
                if (path) {
                  handleAgentFileTouched(path);
                  pushToast('success', `已写入磁盘：${path}`);
                  const running = tasks.tasks.find(t => t.status === 'running');
                  if (running) {
                    tasks.handleTaskEvent({
                      taskId: running.id,
                      action: 'log',
                      message: `已应用文件：${path}`,
                      level: 'success',
                    });
                  }
                }
              } catch (e: any) {
                pushToast('error', e?.message || '应用失败');
              }
            }}
            onReject={async id => {
              const p = patches.patches.find(x => x.id === id);
              await patches.rejectPatch(id);
              pushToast('warn', p ? `已拒绝：${p.path}` : '已拒绝改动');
            }}
            onApplyAll={async () => {
              try {
                const applied = await patches.applyAll(sessions.activeSessionId || undefined);
                for (const p of applied) handleAgentFileTouched(p);
                pushToast(
                  'success',
                  applied.length ? `已全部应用（${applied.length} 个文件）` : '没有可应用的改动',
                );
              } catch (e: any) {
                pushToast('error', e?.message || '全部应用失败');
              }
            }}
            onOpenFile={path => handleAgentFileTouched(path)}
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
                fileTreeRefreshKey={workingDirectory}
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
                    <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '20px 0' }} />
                    <h3 style={{ marginBottom: 12 }}>安全与任务</h3>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 12, fontSize: 13, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={config.requireFileApply}
                        onChange={e => config.setRequireFileApply(e.target.checked)}
                        style={{ marginTop: 3 }}
                      />
                      <span>
                        <strong>改文件需确认后再写入（Apply）</strong>
                        <br />
                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                          推荐开启。Agent 的 file_write / file_edit 先出 diff，点「应用」才写盘。
                          TUI 全自动可关闭。
                        </span>
                      </span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={config.chatTaskBridge}
                        onChange={e => config.setChatTaskBridge(e.target.checked)}
                        style={{ marginTop: 3 }}
                      />
                      <span>
                        <strong>聊天联动任务看板</strong>
                        <br />
                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                          每轮对话自动建一张 Running 任务，工具与完成状态同步到看板。
                          与右侧「Tasks」是同一套卡片，不是两套任务。
                        </span>
                      </span>
                    </label>
                    <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '20px 0' }} />
                    <h3 style={{ marginBottom: 8 }}>推荐默认</h3>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                      一键恢复：缓存优先、改文件需 Apply、任务桥接、模型温度/策略、自动选择便宜/编码模型。
                      <strong>不会清除 API Key</strong>。
                    </p>
                    <button
                      type="button"
                      className="btn-primary"
                      style={{ fontSize: 13 }}
                      onClick={() => {
                        config.applyRecommendedDefaults();
                        pushToast('success', '已应用推荐默认（缓存优先 · Apply · 任务桥接 · 路由启发式）');
                      }}
                    >
                      一键恢复推荐默认
                    </button>
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
                    workingDirectory={workingDirectory}
                    recentDirectories={recentDirectories}
                    switchingCwd={switchingCwd}
                    onChangeWorkingDirectory={changeWorkingDirectory}
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
