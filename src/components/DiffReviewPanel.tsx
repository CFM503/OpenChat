// ============================================================================
// Diff review — pending agent file writes awaiting Apply
// ============================================================================

import React, { useState } from 'react';

export interface PendingPatchView {
  id: string;
  path: string;
  tool: 'file_write' | 'file_edit';
  oldContent: string;
  newContent: string;
  diffPreview?: string;
  taskId?: string;
}

interface DiffReviewPanelProps {
  patches: PendingPatchView[];
  onApply: (id: string) => void | Promise<void>;
  onReject: (id: string) => void | Promise<void>;
  onApplyAll: () => void | Promise<void>;
  onOpenFile?: (path: string) => void;
  busy?: boolean;
}

export function DiffReviewPanel({
  patches,
  onApply,
  onReject,
  onApplyAll,
  onOpenFile,
  busy,
}: DiffReviewPanelProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (patches.length === 0) return null;

  return (
    <div
      style={{
        borderTop: '1px solid var(--border-color)',
        background: 'var(--bg-surface)',
        maxHeight: 280,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-color)',
          gap: 8,
        }}
      >
        <div>
          <strong style={{ fontSize: 13 }}>
            待确认的文件改动（{patches.length}）
          </strong>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Agent 已暂存，未写入磁盘 · 请审阅后「应用」或「拒绝」
          </div>
        </div>
        <button
          type="button"
          className="btn-primary"
          style={{ fontSize: 12, padding: '4px 10px' }}
          disabled={busy}
          onClick={() => void onApplyAll()}
          title="将全部暂存改动写入磁盘"
        >
          全部应用
        </button>
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {patches.map(p => {
          const open = expanded[p.id] ?? true;
          return (
            <div
              key={p.id}
              style={{
                borderBottom: '1px solid var(--border-color)',
                padding: '8px 12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ fontSize: 12, padding: '2px 6px' }}
                  onClick={() => setExpanded(prev => ({ ...prev, [p.id]: !open }))}
                >
                  {open ? '▼' : '▶'}
                </button>
                <code
                  style={{ fontSize: 12, cursor: onOpenFile ? 'pointer' : 'default' }}
                  onClick={() => onOpenFile?.(p.path)}
                  title={p.path}
                >
                  {p.path}
                </code>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.tool}</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="btn-primary"
                    style={{ fontSize: 11, padding: '3px 8px' }}
                    disabled={busy}
                    onClick={() => void onApply(p.id)}
                    title="写入磁盘"
                  >
                    应用
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ fontSize: 11, padding: '3px 8px', border: '1px solid var(--border-color)' }}
                    disabled={busy}
                    onClick={() => void onReject(p.id)}
                    title="丢弃此改动"
                  >
                    拒绝
                  </button>
                </div>
              </div>
              {open && (
                <pre
                  style={{
                    marginTop: 8,
                    marginBottom: 0,
                    fontSize: 11,
                    lineHeight: 1.4,
                    maxHeight: 140,
                    overflow: 'auto',
                    background: 'var(--bg-base, #0d1117)',
                    padding: 8,
                    borderRadius: 6,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {(p.diffPreview || '').split('\n').map((line, i) => {
                    let color = 'var(--text-secondary)';
                    if (line.startsWith('+') && !line.startsWith('+++')) color = 'var(--color-success, #3fb950)';
                    else if (line.startsWith('-') && !line.startsWith('---')) color = 'var(--color-error, #f85149)';
                    else if (line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++')) {
                      color = 'var(--text-muted)';
                    }
                    return (
                      <div key={i} style={{ color }}>
                        {line || ' '}
                      </div>
                    );
                  })}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
