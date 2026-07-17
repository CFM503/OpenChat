// ============================================================================
// ToolOutput Component — Renders tool call events in the chat stream
// ============================================================================

import React, { useState } from 'react';

interface ToolOutputProps {
  toolName: string;
  status: 'running' | 'success' | 'error';
  input?: string;
  output?: string;
  duration?: number;
}

const TOOL_ICONS: Record<string, string> = {
  bash: '💻',
  file_read: '📖',
  file_write: '✏️',
  file_edit: '📝',
  grep: '🔍',
  glob: '📂',
  git: '🔀',
  web_search: '🌐',
  web_fetch: '📥',
};

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + '…';
}

function formatInput(toolName: string, input: string): string {
  try {
    const parsed = JSON.parse(input);
    if (toolName === 'bash' && parsed.command) return String(parsed.command);
    if ((toolName === 'file_read' || toolName === 'file_write' || toolName === 'file_edit') && parsed.path) {
      return String(parsed.path);
    }
    if (toolName === 'grep' && parsed.pattern) return String(parsed.pattern);
    if (toolName === 'glob' && parsed.pattern) return String(parsed.pattern);
    if (toolName === 'git' && parsed.subcommand) {
      const args =
        typeof parsed.args === 'string'
          ? parsed.args
          : Array.isArray(parsed.args)
            ? parsed.args.map(String).join(' ')
            : parsed.args != null && typeof parsed.args === 'object'
              ? JSON.stringify(parsed.args)
              : '';
      return `git ${parsed.subcommand}${args ? ' ' + args : ''}`.trim();
    }
    if (toolName === 'web_search' && parsed.query) return String(parsed.query);
    if (toolName === 'web_fetch' && parsed.url) return String(parsed.url);
    // Avoid "[object Object]" if residual values are objects
    return truncate(
      typeof parsed === 'object' ? JSON.stringify(parsed) : String(parsed),
      80,
    );
  } catch {
    return truncate(input, 80);
  }
}

export function ToolOutput({ toolName, status, input, output, duration }: ToolOutputProps) {
  const [expanded, setExpanded] = useState(status === 'error');

  return (
    <div className={`tool-output tool-${status}`}>
      <div className="tool-header" onClick={() => setExpanded(prev => !prev)}>
        <span className="tool-icon">{TOOL_ICONS[toolName] ?? '🔧'}</span>
        <span className="tool-name">{toolName}</span>
        {input && (
          <span className="tool-input-preview">{formatInput(toolName, input)}</span>
        )}
        <span className={`tool-status-badge ${status}`}>
          {status === 'running' ? '⏳' : status === 'success' ? '✓' : '✗'}
        </span>
        {duration != null && (
          <span className="tool-duration">{duration}ms</span>
        )}
        <span className={`tool-toggle ${expanded ? 'expanded' : ''}`}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
      </div>
      {expanded && output && (
        <pre className="tool-output-content">
          <code>{output}</code>
        </pre>
      )}
    </div>
  );
}
