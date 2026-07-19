// ============================================================================
// FileTree — Browse project files from the backend workspace
// ============================================================================

import React, { useState, useEffect, useCallback } from 'react';
import type { FsTreeEntry } from '../core/types';
import { backendClient } from '../services/api';

interface FileTreeProps {
  onOpenFile: (path: string) => void;
  activePath?: string | null;
  /** Bump to force reload after cwd switch */
  refreshKey?: string | number;
}

function TreeNode({
  entry,
  depth,
  onOpenFile,
  activePath,
}: {
  entry: FsTreeEntry;
  depth: number;
  onOpenFile: (path: string) => void;
  activePath?: string | null;
}) {
  const [open, setOpen] = useState(depth < 1);
  const isDir = entry.type === 'directory';
  const isActive = !isDir && activePath === entry.path;

  return (
    <div className="file-tree-node">
      <button
        className={`file-tree-item ${isActive ? 'active' : ''} ${isDir ? 'is-dir' : 'is-file'}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => {
          if (isDir) setOpen(prev => !prev);
          else onOpenFile(entry.path);
        }}
        title={entry.path}
      >
        <span className="file-tree-icon">
          {isDir ? (open ? '📂' : '📁') : '📄'}
        </span>
        <span className="file-tree-name">{entry.name}</span>
      </button>
      {isDir && open && entry.children?.map(child => (
        <TreeNode
          key={child.path}
          entry={child}
          depth={depth + 1}
          onOpenFile={onOpenFile}
          activePath={activePath}
        />
      ))}
    </div>
  );
}

export function FileTree({ onOpenFile, activePath, refreshKey }: FileTreeProps) {
  const [tree, setTree] = useState<FsTreeEntry[]>([]);
  const [root, setRoot] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await backendClient.getFsTree('.', 3);
    if (result) {
      setTree(result.tree);
      setRoot(result.root);
    } else {
      setError('Backend unavailable');
      setTree([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return (
    <div className="file-tree">
      <div className="file-tree-header">
        <span className="file-tree-title" title={root}>
          {root || 'Workspace'}
        </span>
        <button className="btn-icon" onClick={load} title="Refresh file tree" aria-label="Refresh">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
      </div>
      <div className="file-tree-body">
        {loading && <div className="file-tree-status">Loading…</div>}
        {error && <div className="file-tree-status error">{error}</div>}
        {!loading && !error && tree.length === 0 && (
          <div className="file-tree-status">Empty workspace</div>
        )}
        {!loading && tree.map(entry => (
          <TreeNode
            key={entry.path}
            entry={entry}
            depth={0}
            onOpenFile={onOpenFile}
            activePath={activePath}
          />
        ))}
      </div>
    </div>
  );
}
