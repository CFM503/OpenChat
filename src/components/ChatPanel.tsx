// ============================================================================
// ChatPanel — messages, skills, attachments, live activity feedback
// ============================================================================

import React, { useState, useRef, useEffect, useMemo, memo, useCallback } from 'react';
import { Marked } from 'marked';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import html from 'highlight.js/lib/languages/xml';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', html);
hljs.registerLanguage('xml', html);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('go', go);
hljs.registerLanguage('java', java);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);

import type { ChatMessage, ChatAttachment, SkillInfo, ChatActivity } from '../core/types';
import { ToolOutput } from './ToolOutput';
import { SkillPicker } from './SkillPicker';
import { backendClient } from '../services/api';
import type { ConnectionState } from '../hooks/useBackend';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (content: string, attachments: ChatAttachment[]) => void;
  onRetryMessage?: (assistantMsgId: string) => void;
  isStreaming: boolean;
  onStopStreaming?: () => void;
  webSearchEnabled?: boolean;
  onToggleWebSearch?: (enabled: boolean) => void;
  hasSearchKey?: boolean;
  /** Deep thinking / CoT (default true) */
  enableThinking?: boolean;
  onToggleThinking?: (enabled: boolean) => void;
  activity?: ChatActivity;
  connectionState?: ConnectionState;
  onReconnect?: () => void;
  packStatsLabel?: string | null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Full markdown + syntax highlight (finished messages only) */
const markedFull = new Marked({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      let language = lang || 'text';
      if (!hljs.getLanguage(language)) language = 'text';
      // Never use highlightAuto — very expensive on long streams
      const highlighted = language !== 'text'
        ? hljs.highlight(text, { language, ignoreIllegals: true }).value
        : escapeHtml(text);
      return `<div class="code-block-wrapper"><pre><code class="hljs language-${language}">${highlighted}</code></pre><button class="code-copy-btn" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('code').textContent).then(()=>{this.textContent='Copied!';setTimeout(()=>{this.textContent='Copy'},2000)})">Copy</button></div>`;
    },
    link({ href, text }: { href: string; text: string }) {
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
    table(token: any) {
      return `<div class="table-wrapper"><table><thead>${token.header}</thead><tbody>${token.body}</tbody></table></div>`;
    },
  },
});

/** Cheap path while streaming: escape + basic newlines, skip hljs entirely */
function renderMarkdownFast(content: string): string {
  if (!content) return '';
  // Preserve fenced code as plain <pre> without highlight
  const withCode = content.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
    return `<div class="code-block-wrapper"><pre><code class="hljs">${escapeHtml(code)}</code></pre></div>`;
  });
  return withCode
    .split(/\n\n+/)
    .map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

function renderMarkdown(content: string, fast = false): string {
  if (!content) return '';
  if (fast) return renderMarkdownFast(content);
  try {
    return markedFull.parse(content) as string;
  } catch {
    return renderMarkdownFast(content);
  }
}

const markdownCache = new Map<string, string>();
const MARKDOWN_CACHE_MAX = 80;

function renderMarkdownCached(content: string, streaming: boolean): string {
  if (streaming) return renderMarkdown(content, true);
  const hit = markdownCache.get(content);
  if (hit) return hit;
  const html = renderMarkdown(content, false);
  if (markdownCache.size > MARKDOWN_CACHE_MAX) {
    const first = markdownCache.keys().next().value;
    if (first !== undefined) markdownCache.delete(first);
  }
  markdownCache.set(content, html);
  return html;
}

function CollapsibleThinking({ thinkingContent, streaming }: { thinkingContent: string; streaming?: boolean }) {
  const [isExpanded, setIsExpanded] = useState(true);
  const html = useMemo(
    () => (thinkingContent?.trim() ? renderMarkdownCached(thinkingContent, !!streaming) : ''),
    [thinkingContent, streaming],
  );
  if (!thinkingContent?.trim()) return null;
  return (
    <div className="thinking-block">
      <div className="thinking-header" onClick={() => setIsExpanded(p => !p)}>
        <span className="thinking-title">Thinking</span>
        <svg className={`thinking-chevron ${isExpanded ? 'expanded' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
      {isExpanded && (
        <div className="thinking-content" dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </div>
  );
}

const MessageBubble = memo(function MessageBubble({
  content,
  streaming,
}: {
  content: string;
  streaming?: boolean;
}) {
  const html = useMemo(
    () => renderMarkdownCached(content, !!streaming),
    [content, streaming],
  );
  return (
    <div className="message-bubble">
      <div dangerouslySetInnerHTML={{ __html: html }} />
      {streaming && content && <span className="stream-cursor" aria-hidden />}
    </div>
  );
});

const MessageRow = memo(function MessageRow({
  msg,
  showRetry,
  onRetry,
  activityLabel,
}: {
  msg: ChatMessage;
  showRetry: boolean;
  onRetry?: () => void;
  activityLabel?: string;
}) {
  return (
    <div className={`message-item ${msg.role === 'user' ? 'user' : 'assistant'}`}>
      {msg.role === 'assistant' && msg.thinking && (
        <CollapsibleThinking thinkingContent={msg.thinking} streaming={msg.isStreaming} />
      )}
      {msg.role === 'assistant' && msg.toolEvents && msg.toolEvents.length > 0 && (
        <div className="tool-events">
          {msg.toolEvents.map((evt, idx) => (
            <ToolOutput
              key={evt.toolCallId + '-' + idx}
              toolName={evt.name}
              status={
                evt.type === 'start' && !evt.result
                  ? 'running'
                  : evt.result?.success
                    ? 'success'
                    : 'error'
              }
              input={evt.input}
              output={evt.result?.output ?? evt.result?.error}
              duration={evt.result?.duration}
            />
          ))}
        </div>
      )}
      {msg.role === 'assistant' && !msg.content && !msg.thinking && msg.isStreaming && (
        <div className="message-bubble assistant-thinking">
          <div className="thinking-dots">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </div>
          <span className="thinking-label">{activityLabel || 'Waiting for model…'}</span>
        </div>
      )}
      {msg.content && (
        <MessageBubble content={msg.content} streaming={msg.isStreaming} />
      )}
      {msg.attachments && msg.attachments.length > 0 && (
        <div className="message-attachments">
          {msg.attachments.map((attach, idx) =>
            attach.type.startsWith('image/') ? (
              <div key={idx} className="message-attachment-image-wrapper">
                <img src={attach.content} alt={attach.name} className="message-attachment-image" />
              </div>
            ) : (
              <TextAttachmentCard key={idx} attachment={attach} />
            ),
          )}
        </div>
      )}
      <div className="message-info">
        <span>{msg.role === 'user' ? 'You' : 'Assistant'}</span>
        <span>·</span>
        <span>
          {new Date(msg.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </span>
        {msg.content && !msg.isStreaming && (
          <>
            <span>·</span>
            <MessageCopyButton content={msg.content} />
          </>
        )}
        {showRetry && onRetry && (
          <>
            <span>·</span>
            <RetryButton onClick={onRetry} />
          </>
        )}
      </div>
    </div>
  );
});

function MessageCopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="msg-copy-btn"
      onClick={() => {
        navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      title="Copy"
    >
      <span style={{ color: copied ? 'var(--color-success)' : 'inherit' }}>{copied ? 'Copied!' : 'Copy'}</span>
    </button>
  );
}

function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="msg-retry-btn" onClick={onClick} title="Retry">
      <span>Retry</span>
    </button>
  );
}

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
};

function TextAttachmentCard({ attachment }: { attachment: ChatAttachment }) {
  const [isExpanded, setIsExpanded] = useState(false);
  return (
    <div className="message-attachment-file-card">
      <div className="message-attachment-file-header" onClick={() => setIsExpanded(p => !p)}>
        <div className="message-attachment-file-header-left">
          <span className="staged-attachment-icon">📄</span>
          <div className="message-attachment-file-name" title={attachment.name}>{attachment.name}</div>
          <span className="message-attachment-file-size">({formatSize(attachment.size)})</span>
        </div>
      </div>
      {isExpanded && (
        <pre className="message-attachment-file-preview"><code>{attachment.content}</code></pre>
      )}
    </div>
  );
}

function ActivityBar({
  activity,
  isStreaming,
  packStatsLabel,
}: {
  activity?: ChatActivity;
  isStreaming: boolean;
  packStatsLabel?: string | null;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isStreaming || !activity || activity.phase === 'idle') {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(Math.floor((Date.now() - activity.startedAt) / 1000));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [isStreaming, activity?.phase, activity?.startedAt]);

  if (!isStreaming || !activity || activity.phase === 'idle') {
    if (packStatsLabel) {
      return (
        <div className="chat-activity idle">
          <span className="chat-activity-label">{packStatsLabel}</span>
        </div>
      );
    }
    return null;
  }

  const icon =
    activity.phase === 'searching' ? '🔍' :
    activity.phase === 'tool' ? '🔧' :
    activity.phase === 'thinking' ? '💭' :
    activity.phase === 'streaming' ? '✨' :
    activity.phase === 'error' ? '⚠️' :
    activity.phase === 'connecting' || activity.phase === 'sending' ? '📡' :
    '⏳';

  return (
    <div className={`chat-activity phase-${activity.phase}`}>
      <span className="chat-activity-pulse" />
      <span className="chat-activity-icon">{icon}</span>
      <span className="chat-activity-label">{activity.label}</span>
      {activity.detail && (
        <span className="chat-activity-detail" title={activity.detail}>{activity.detail}</span>
      )}
      <span className="chat-activity-time">{elapsed}s</span>
    </div>
  );
}

function ConnectionBanner({
  state,
  onReconnect,
}: {
  state?: ConnectionState;
  onReconnect?: () => void;
}) {
  if (!state || state === 'online' || state === 'checking') return null;
  return (
    <div className={`connection-banner ${state}`}>
      <span>
        {state === 'offline' && 'Backend offline — start with npm run dev:all (demo mode if no model key)'}
        {state === 'reconnecting' && 'Reconnecting to backend…'}
      </span>
      {onReconnect && (
        <button type="button" className="btn-ghost btn-sm" onClick={onReconnect}>
          Retry
        </button>
      )}
    </div>
  );
}

export function ChatPanel({
  messages,
  onSendMessage,
  onRetryMessage,
  isStreaming,
  onStopStreaming = () => {},
  webSearchEnabled = false,
  onToggleWebSearch = () => {},
  hasSearchKey = false,
  enableThinking = true,
  onToggleThinking = () => {},
  activity,
  connectionState,
  onReconnect,
  packStatsLabel,
}: ChatPanelProps) {
  const [inputText, setInputText] = useState('');
  const [stagedAttachments, setStagedAttachments] = useState<ChatAttachment[]>([]);
  const [showContext, setShowContext] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [showSkillPicker, setShowSkillPicker] = useState(false);
  const [skillFilter, setSkillFilter] = useState('');

  useEffect(() => {
    backendClient.getSkills().then(setSkills).catch(() => {});
  }, []);

  useEffect(() => {
    if (inputText === '/') {
      setShowSkillPicker(true);
      setSkillFilter('');
    } else if (inputText.startsWith('/') && !inputText.includes(' ')) {
      setShowSkillPicker(true);
      setSkillFilter(inputText.slice(1));
    } else {
      setShowSkillPicker(false);
    }
  }, [inputText]);

  const handleSkillSelect = async (skill: SkillInfo) => {
    setShowSkillPicker(false);
    const typed = inputText.trim();
    const shortcut = skill.shortcut.replace(/^\//, '');
    let args = '';
    if (typed.startsWith('/')) {
      const rest = typed.slice(1);
      if (rest === shortcut || rest.startsWith(shortcut + ' ')) {
        args = rest.slice(shortcut.length).trim();
      } else if (rest.startsWith(skill.name + ' ') || rest === skill.name) {
        args = rest.slice(skill.name.length).trim();
      }
    }
    const expanded = await backendClient.expandSkill(skill.name, undefined, args);
    setInputText(expanded || skill.content || skill.shortcut + (args ? ' ' + args : ' '));
  };

  const MAX_FILE_SIZE = 50 * 1024 * 1024;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(file => {
      if (file.size > MAX_FILE_SIZE) {
        alert(`File "${file.name}" is too large (${formatSize(file.size)}). Max 50MB.`);
        return;
      }
      const isImage = file.type.startsWith('image/');
      const reader = new FileReader();
      reader.onload = (event) => {
        setStagedAttachments(prev => [...prev, {
          name: file.name,
          type: file.type || 'text/plain',
          size: file.size,
          content: event.target?.result as string,
        }]);
      };
      if (isImage) reader.readAsDataURL(file);
      else reader.readAsText(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSend = () => {
    if (isStreaming) return;
    if (inputText.trim().length === 0 && stagedAttachments.length === 0) return;
    onSendMessage(inputText, stagedAttachments);
    setInputText('');
    setStagedAttachments([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Scroll at most once per frame while streaming
  useEffect(() => {
    let raf = 0;
    raf = requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: isStreaming ? 'auto' : 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
  }, [messages, isStreaming, activity?.label]);

  const visibleMessages = useMemo(
    () => messages.filter(m => m.role !== 'system'),
    [messages],
  );

  const activityLabel =
    activity?.phase === 'tool'
      ? activity.label
      : activity?.phase === 'searching'
        ? 'Searching…'
        : activity?.phase === 'connecting' || activity?.phase === 'sending'
          ? activity.label
          : 'Waiting for model…';

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h3>AI Assistant</h3>
        {isStreaming && (
          <div className="typing-indicator" title="Generating">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>
        )}
      </div>

      <ConnectionBanner state={connectionState} onReconnect={onReconnect} />
      <ActivityBar
        activity={activity}
        isStreaming={isStreaming}
        packStatsLabel={packStatsLabel}
      />

      <div className="chat-messages">
        {visibleMessages.map(msg => (
          <MessageRow
            key={msg.id}
            msg={msg}
            activityLabel={msg.isStreaming ? activityLabel : undefined}
            showRetry={
              msg.role === 'assistant' &&
              !msg.ephemeral &&
              !msg.content?.includes('Welcome to **OpenChat**') &&
              !isStreaming &&
              !!onRetryMessage
            }
            onRetry={onRetryMessage ? () => onRetryMessage(msg.id) : undefined}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        {showSkillPicker && skills.length > 0 && (
          <SkillPicker
            skills={skills}
            filter={skillFilter}
            onSelect={handleSkillSelect}
            onClose={() => setShowSkillPicker(false)}
          />
        )}
        <div className="chat-input-wrapper">
          {stagedAttachments.length > 0 && (
            <div className="staged-attachments-list">
              {stagedAttachments.map((attach, idx) => (
                <div key={idx} className="staged-attachment-card">
                  {attach.type.startsWith('image/') ? (
                    <img src={attach.content} className="staged-attachment-thumbnail" alt="" />
                  ) : (
                    <span className="staged-attachment-icon">📄</span>
                  )}
                  <div className="staged-attachment-info">
                    <span className="staged-attachment-name" title={attach.name}>{attach.name}</span>
                    <span className="staged-attachment-size">{formatSize(attach.size)}</span>
                  </div>
                  <button
                    className="staged-attachment-remove"
                    onClick={() => setStagedAttachments(p => p.filter((_, i) => i !== idx))}
                    title="Remove"
                    type="button"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <textarea
            className="chat-textarea"
            placeholder="Ask anything… (/ skills · Enter send · Shift+Enter newline)"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
            id="chat-input-textarea"
          />
          <div className="chat-input-footer">
            <div className="chat-input-actions">
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                multiple
                onChange={handleFileChange}
              />
              <button
                className="btn-icon-attach"
                onClick={() => fileInputRef.current?.click()}
                disabled={isStreaming}
                title="Attach files"
                type="button"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </button>
              <button
                className={`btn-web-search ${webSearchEnabled ? 'active' : ''}`}
                onClick={() => onToggleWebSearch(!webSearchEnabled)}
                disabled={isStreaming}
                title={
                  hasSearchKey
                    ? webSearchEnabled
                      ? 'Disable web search'
                      : 'Enable web search'
                    : 'Web search needs API key in Settings'
                }
                type="button"
                id="btn-web-search-toggle"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              </button>
              <button
                className={`btn-thinking-toggle ${enableThinking ? 'active' : ''}`}
                onClick={() => onToggleThinking(!enableThinking)}
                disabled={isStreaming}
                title={
                  enableThinking
                    ? 'Deep thinking ON — click to disable (faster, shorter answers)'
                    : 'Deep thinking OFF — click to enable reasoning / CoT'
                }
                type="button"
                id="btn-thinking-toggle"
                aria-pressed={enableThinking}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a7 7 0 0 0-4 12.7V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.3A7 7 0 0 0 12 2z" />
                  <path d="M9 21h6" />
                  <path d="M10 17v4" />
                  <path d="M14 17v4" />
                </svg>
              </button>
              <button
                className="btn-ghost"
                onClick={() => setShowContext(true)}
                disabled={isStreaming}
                title="Preview conversation payload"
                type="button"
                style={{ padding: '6px', border: '1px solid var(--border-color)', borderRadius: '6px' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            </div>
            {isStreaming ? (
              <button
                className="btn-primary"
                onClick={onStopStreaming}
                style={{ background: 'var(--color-error)' }}
                type="button"
              >
                <span>Stop</span>
              </button>
            ) : (
              <button
                className="btn-primary"
                onClick={handleSend}
                disabled={inputText.trim().length === 0 && stagedAttachments.length === 0}
                id="chat-send-btn"
                type="button"
              >
                <span>Send</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {showContext && (
        <div className="modal-overlay" onClick={() => setShowContext(false)}>
          <div className="modal-content" style={{ maxWidth: 720 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Conversation preview</h2>
              <button className="btn-icon" onClick={() => setShowContext(false)} type="button">✕</button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', padding: '0 20px' }}>
              What the client will send (welcome / empty shells omitted). Server may pack further.
            </p>
            <pre
              style={{
                margin: 16,
                padding: 12,
                maxHeight: '55vh',
                overflow: 'auto',
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                background: 'var(--bg-surface-elevated)',
                borderRadius: 8,
                whiteSpace: 'pre-wrap',
              }}
            >
              {JSON.stringify(
                messages
                  .filter(m => !m.ephemeral && !m.content?.includes('Welcome to **OpenChat**'))
                  .filter(m => !(m.isStreaming && !m.content && !m.toolEvents?.length))
                  .map(m => ({
                    role: m.role,
                    content:
                      typeof m.content === 'string' && m.content.length > 400
                        ? m.content.slice(0, 400) + '…'
                        : m.content,
                    tools: m.toolEvents?.map(t => t.name),
                  })),
                null,
                2,
              )}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
