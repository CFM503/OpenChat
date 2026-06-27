// ============================================================================
// SessionList Component — Conversation history sidebar
// ============================================================================

import React from 'react';

export interface SessionInfo {
  id: string;
  title: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

interface SessionListProps {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

function formatTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function SessionList({ sessions, activeSessionId, onSelect, onNew, onDelete }: SessionListProps) {
  return (
    <div className="session-list">
      <button className="session-new-btn" onClick={onNew}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <span>New Chat</span>
      </button>

      <div className="session-items">
        {sessions.length === 0 ? (
          <div className="session-empty">No conversations yet</div>
        ) : (
          sessions.map(s => (
            <div
              key={s.id}
              className={`session-item ${s.id === activeSessionId ? 'active' : ''}`}
              onClick={() => onSelect(s.id)}
            >
              <div className="session-item-content">
                <div className="session-item-title">{s.title}</div>
                <div className="session-item-meta">
                  <span>{s.messageCount} messages</span>
                  <span>·</span>
                  <span>{formatTime(s.updatedAt)}</span>
                </div>
              </div>
              <button
                className="session-item-delete"
                onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
                title="Delete conversation"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
