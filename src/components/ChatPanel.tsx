// ============================================================================
// ChatPanel Component
// Full markdown rendering, code syntax highlighting, retry, and skills
// ============================================================================

import React, { useState, useRef, useEffect, useMemo } from 'react';
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

// Register common languages
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
import type { ChatMessage, ChatAttachment, ToolEvent, SkillInfo } from '../core/types';
import { ToolOutput } from './ToolOutput';
import { SkillPicker } from './SkillPicker';
import { backendClient } from '../services/api';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (content: string, attachments: ChatAttachment[]) => void;
  onRetryMessage?: (assistantMsgId: string) => void;
  isStreaming: boolean;
  onStopStreaming?: () => void;
  webSearchEnabled?: boolean;
  onToggleWebSearch?: (enabled: boolean) => void;
  hasSearchKey?: boolean;
  onViewContext?: () => void;
}

// ── Markdown Renderer ─────────────────────────────────────────────────────

const marked = new Marked({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      let language = lang || 'text';
      if (!hljs.getLanguage(language)) {
        language = 'text';
      }
      const highlighted = lang
        ? hljs.highlight(text, { language }).value
        : hljs.highlightAuto(text).value;
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

function renderMarkdown(content: string): string {
  if (!content) return '';
  try {
    return marked.parse(content) as string;
  } catch {
    return content;
  }
}

// ── Collapsible Thinking ──────────────────────────────────────────────────

function CollapsibleThinking({ thinkingContent }: { thinkingContent: string }) {
  const [isExpanded, setIsExpanded] = useState(true);
  if (!thinkingContent || thinkingContent.trim().length === 0) return null;

  return (
    <div className="thinking-block">
      <div className="thinking-header" onClick={() => setIsExpanded(prev => !prev)}>
        <span className="thinking-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: '6px' }}>
            <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1 0-3.12 3 3 0 0 1 0-4.88 2.5 2.5 0 0 1 0-3.12A2.5 2.5 0 0 1 9.5 2Z" />
            <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 0-3.12 3 3 0 0 0 0-4.88 2.5 2.5 0 0 0 0-3.12A2.5 2.5 0 0 0 14.5 2Z" />
          </svg>
          Thinking Process
        </span>
        <svg className={`thinking-chevron ${isExpanded ? 'expanded' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
      {isExpanded && (
        <div className="thinking-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(thinkingContent) }} />
      )}
    </div>
  );
}

// ── Message Copy Button ───────────────────────────────────────────────────

function MessageCopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button className="msg-copy-btn" onClick={handleCopy} title="Copy message content">
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--color-success)' }}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
      <span style={{ color: copied ? 'var(--color-success)' : 'inherit' }}>{copied ? 'Copied!' : 'Copy'}</span>
    </button>
  );
}

// ── Retry Button ──────────────────────────────────────────────────────────

function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="msg-retry-btn" onClick={onClick} title="Retry this response">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="23 4 23 10 17 10" />
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
      </svg>
      <span>Retry</span>
    </button>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
};

function TextAttachmentCard({ attachment }: { attachment: ChatAttachment }) {
  const [isExpanded, setIsExpanded] = useState(false);
  return (
    <div className="message-attachment-file-card">
      <div className="message-attachment-file-header" onClick={() => setIsExpanded(prev => !prev)}>
        <div className="message-attachment-file-header-left">
          <span className="staged-attachment-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </span>
          <div className="message-attachment-file-name" title={attachment.name}>{attachment.name}</div>
          <span className="message-attachment-file-size">({formatSize(attachment.size)})</span>
        </div>
        <span className={`message-attachment-file-toggle ${isExpanded ? 'expanded' : ''}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
      </div>
      {isExpanded && (
        <pre className="message-attachment-file-preview"><code>{attachment.content}</code></pre>
      )}
    </div>
  );
}

// ── Main ChatPanel ────────────────────────────────────────────────────────

export function ChatPanel({
  messages,
  onSendMessage,
  onRetryMessage,
  isStreaming,
  onStopStreaming = () => {},
  webSearchEnabled = false,
  onToggleWebSearch = () => {},
  hasSearchKey = false,
  onViewContext = () => {},
}: ChatPanelProps) {
  const [inputText, setInputText] = useState('');
  const [stagedAttachments, setStagedAttachments] = useState<ChatAttachment[]>([]);
  const [showContext, setShowContext] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Skill picker state
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
    const expanded = await backendClient.expandSkill(skill.name);
    if (expanded) {
      setInputText(expanded);
    } else {
      setInputText(skill.content || skill.shortcut + ' ');
    }
  };

  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(file => {
      if (file.size > MAX_FILE_SIZE) {
        alert(`File "${file.name}" is too large (${formatSize(file.size)}). Maximum size is 50MB.`);
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

  const handleRemoveStaged = (index: number) => {
    setStagedAttachments(prev => prev.filter((_, i) => i !== index));
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h3>AI Assistant</h3>
        {isStreaming && (
          <div className="typing-indicator">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>
        )}
      </div>

      <div className="chat-messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`message-item ${msg.role === 'user' ? 'user' : 'assistant'}`}>
            {msg.role === 'assistant' && msg.thinking && (
              <CollapsibleThinking thinkingContent={msg.thinking} />
            )}
            {msg.role === 'assistant' && msg.toolEvents && msg.toolEvents.length > 0 && (
              <div className="tool-events">
                {msg.toolEvents.map((evt, idx) => (
                  <ToolOutput
                    key={evt.toolCallId + '-' + idx}
                    toolName={evt.name}
                    status={evt.type === 'start' ? 'running' : (evt.result?.success ? 'success' : 'error')}
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
                <span className="thinking-label">Thinking...</span>
              </div>
            )}
            {msg.content && (
              <div className="message-bubble" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
            )}
            {msg.attachments && msg.attachments.length > 0 && (
              <div className="message-attachments">
                {msg.attachments.map((attach, idx) => {
                  const isImg = attach.type.startsWith('image/');
                  if (isImg) {
                    return (
                      <div key={idx} className="message-attachment-image-wrapper">
                        <img src={attach.content} alt={attach.name} className="message-attachment-image" />
                      </div>
                    );
                  } else {
                    return <TextAttachmentCard key={idx} attachment={attach} />;
                  }
                })}
              </div>
            )}
            <div className="message-info">
              <span>{msg.role === 'user' ? 'You' : 'Assistant'}</span>
              <span>·</span>
              <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              {msg.content && (
                <>
                  <span>·</span>
                  <MessageCopyButton content={msg.content} />
                </>
              )}
              {msg.role === 'assistant' && onRetryMessage && !isStreaming && (
                <>
                  <span>·</span>
                  <RetryButton onClick={() => onRetryMessage(msg.id)} />
                </>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        {showSkillPicker && skills.length > 0 && (
          <SkillPicker skills={skills} filter={skillFilter} onSelect={handleSkillSelect} onClose={() => setShowSkillPicker(false)} />
        )}
        <div className="chat-input-wrapper">
          {stagedAttachments.length > 0 && (
            <div className="staged-attachments-list">
              {stagedAttachments.map((attach, idx) => {
                const isImg = attach.type.startsWith('image/');
                return (
                  <div key={idx} className="staged-attachment-card">
                    {isImg ? (
                      <img src={attach.content} className="staged-attachment-thumbnail" alt="" />
                    ) : (
                      <span className="staged-attachment-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                      </span>
                    )}
                    <div className="staged-attachment-info">
                      <span className="staged-attachment-name" title={attach.name}>{attach.name}</span>
                      <span className="staged-attachment-size">{formatSize(attach.size)}</span>
                    </div>
                    <button className="staged-attachment-remove" onClick={() => handleRemoveStaged(idx)} title="Remove">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <textarea
            className="chat-textarea"
            placeholder="Ask anything... (/ for skills, Enter to send, Shift+Enter for newline)"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            id="chat-input-textarea"
          />
          <div className="chat-input-footer">
            <div className="chat-input-actions">
              <input type="file" ref={fileInputRef} style={{ display: 'none' }} multiple onChange={handleFileChange} />
              <button className="btn-icon-attach" onClick={() => fileInputRef.current?.click()} disabled={isStreaming} title="Attach files" type="button">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </button>
              <button
                className={`btn-web-search ${webSearchEnabled ? 'active' : ''}`}
                onClick={() => onToggleWebSearch(!webSearchEnabled)}
                disabled={isStreaming}
                title={hasSearchKey ? (webSearchEnabled ? 'Disable Web Search' : 'Enable Web Search') : 'Web Search (needs API key in Settings)'}
                type="button"
                id="btn-web-search-toggle"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              </button>
              <button
                className="btn-ghost"
                onClick={() => setShowContext(true)}
                disabled={isStreaming}
                title="View context sent to server"
                type="button"
                id="btn-view-context"
                style={{ padding: '6px', border: '1px solid var(--border-color)', borderRadius: '6px' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            </div>
            {isStreaming ? (
              <button className="btn-primary" onClick={onStopStreaming} style={{ background: 'var(--color-error)' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
                <span>Stop</span>
              </button>
            ) : (
              <button className="btn-primary" onClick={handleSend} disabled={inputText.trim().length === 0 && stagedAttachments.length === 0} id="chat-send-btn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
                <span>Send</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Context Viewer Modal */}
      {showContext && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setShowContext(false)}>
          <div style={{
            background: 'var(--bg-surface)', borderRadius: '12px', padding: '20px',
            maxWidth: '800px', width: '90%', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Context Sent to Server</h3>
              <button className="btn-ghost" onClick={() => setShowContext(false)} style={{ fontSize: '1.2rem', padding: '4px 8px' }}>✕</button>
            </div>
            <pre style={{
              flex: 1, overflow: 'auto', fontSize: '12px', fontFamily: 'var(--font-mono)',
              background: 'var(--bg-surface-elevated)', padding: '12px', borderRadius: '8px',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5,
            }}>
              {JSON.stringify(messages.map(m => ({
                role: m.role,
                content: m.content.length > 500 ? m.content.slice(0, 500) + '...' : m.content,
              })), null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
