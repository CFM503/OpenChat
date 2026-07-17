// ============================================================================
// WorkspacePanel Component
// File tree + code editor + Task Board
// ============================================================================

import React, { useState } from 'react';
import type { AgentTask, TaskAction, WorkspaceFile } from '../core/types';
import { TaskBoard } from './TaskBoard';
import { FileTree } from './FileTree';

interface WorkspacePanelProps {
  activeTab: 'code' | 'tasks';
  onTabChange: (tab: 'code' | 'tasks') => void;
  tasks: AgentTask[];
  onCreateTask: (title: string, description: string, assignee: string, priority: AgentTask['priority']) => void;
  onTaskAction: (taskId: string, action: TaskAction, payload?: string) => void;
  workspaceFiles: WorkspaceFile[];
  onFileChange: (id: string, content: string) => void;
  onAddFile: (name: string, language: string) => void;
  onCloseFile: (id: string) => void;
  onSaveFile: (id: string) => void;
  onOpenDiskFile: (path: string) => void;
  activeFileId: string | null;
  onSelectFile: (id: string) => void;
}

export function WorkspacePanel({
  activeTab,
  onTabChange,
  tasks,
  onCreateTask,
  onTaskAction,
  workspaceFiles,
  onFileChange,
  onAddFile,
  onCloseFile,
  onSaveFile,
  onOpenDiskFile,
  activeFileId,
  onSelectFile,
}: WorkspacePanelProps) {
  const [showAddFile, setShowAddFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileLang, setNewFileLang] = useState('typescript');
  const [showTree, setShowTree] = useState(true);

  const activeFile = workspaceFiles.find(f => f.id === activeFileId);
  const activePath = activeFile?.filePath ?? null;

  const handleAddFileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName.trim()) return;
    onAddFile(newFileName.trim(), newFileLang);
    setNewFileName('');
    setShowAddFile(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      if (activeFileId) onSaveFile(activeFileId);
    }
  };

  return (
    <div className="workspace-container">
      {/* Workspace Tabs */}
      <div className="workspace-tabs" id="workspace-tabs">
        <button
          className={`tab-btn ${activeTab === 'code' ? 'active' : ''}`}
          onClick={() => onTabChange('code')}
          id="tab-code-btn"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
          Code Canvas
        </button>
        <button
          className={`tab-btn ${activeTab === 'tasks' ? 'active' : ''}`}
          onClick={() => onTabChange('tasks')}
          id="tab-tasks-btn"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          Task Workspace
        </button>
      </div>

      {/* Workspace Active Pane */}
      <div className="workspace-content">
        {activeTab === 'code' ? (
          <div className="editor-with-tree">
            {showTree && (
              <aside className="file-tree-aside">
                <FileTree onOpenFile={onOpenDiskFile} activePath={activePath} />
              </aside>
            )}
            <div className="editor-container" id="editor-container">
              {/* Editor File Bar */}
              <div className="editor-file-bar">
                <button
                  className="btn-icon"
                  onClick={() => setShowTree(v => !v)}
                  title={showTree ? 'Hide file tree' : 'Show file tree'}
                  aria-label="Toggle file tree"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M3 12h18M3 18h18" />
                  </svg>
                </button>
                <div className="editor-tabs" id="editor-tabs">
                  {workspaceFiles.map(file => (
                    <div
                      key={file.id}
                      className={`file-tab ${file.id === activeFileId ? 'active' : ''}`}
                    >
                      <button
                        className="file-tab-label"
                        onClick={() => onSelectFile(file.id)}
                        title={file.filePath || file.name}
                      >
                        <span>{file.dirty ? '● ' : ''}📄 {file.name}</span>
                      </button>
                      <button
                        className="file-tab-close"
                        onClick={(e) => { e.stopPropagation(); onCloseFile(file.id); }}
                        title="Close"
                        aria-label={`Close ${file.name}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    className="file-tab"
                    style={{ opacity: 0.7 }}
                    onClick={() => setShowAddFile(true)}
                    id="btn-add-file-open"
                  >
                    <span>+ New File</span>
                  </button>
                </div>
                {activeFile && (
                  <div className="editor-file-actions">
                    {activeFile.filePath && (
                      <button
                        className="btn-ghost btn-sm"
                        onClick={() => onSaveFile(activeFile.id)}
                        disabled={!activeFile.dirty}
                        title="Save (Ctrl+S)"
                      >
                        💾 Save
                      </button>
                    )}
                    <span className="logo-badge" style={{ fontSize: '0.7rem' }}>
                      {activeFile.language}
                    </span>
                  </div>
                )}
              </div>

              {/* Editor body */}
              {activeFile ? (
                <div className="editor-body">
                  <textarea
                    className="code-textarea"
                    value={activeFile.content}
                    onChange={e => onFileChange(activeFile.id, e.target.value)}
                    onKeyDown={handleKeyDown}
                    id="code-editor-textarea"
                    spellCheck={false}
                  />
                </div>
              ) : (
                <div className="editor-empty">
                  No open files. Browse the file tree or create a new file.
                </div>
              )}
            </div>
          </div>
        ) : (
          <TaskBoard tasks={tasks} onCreateTask={onCreateTask} onTaskAction={onTaskAction} />
        )}
      </div>

      {/* Add File Modal */}
      {showAddFile && (
        <div className="modal-overlay" onClick={() => setShowAddFile(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Create New Workspace File</h2>
              <button className="btn-icon" onClick={() => setShowAddFile(false)} id="btn-add-file-close">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleAddFileSubmit} className="model-form" style={{ padding: '24px' }}>
              <div className="form-group">
                <label>File Name</label>
                <input
                  type="text"
                  className="form-input"
                  required
                  placeholder="e.g. index.js, app.py"
                  value={newFileName}
                  onChange={e => setNewFileName(e.target.value)}
                  id="new-file-name-input"
                />
              </div>
              <div className="form-group">
                <label>Programming Language</label>
                <select
                  className="form-select"
                  value={newFileLang}
                  onChange={e => setNewFileLang(e.target.value)}
                  id="new-file-lang-select"
                >
                  <option value="javascript">JavaScript</option>
                  <option value="typescript">TypeScript</option>
                  <option value="python">Python</option>
                  <option value="html">HTML</option>
                  <option value="css">CSS</option>
                  <option value="json">JSON</option>
                  <option value="markdown">Markdown</option>
                </select>
              </div>
              <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowAddFile(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" id="new-file-submit-btn">
                  Create File
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
