// ============================================================================
// ChatPanel Component
// Handles message flow, stream parsing of <thinking> tags, collapsible accordion
// ============================================================================

import React, { useState, useRef, useEffect } from 'react';
import type { ChatMessage, ChatAttachment } from '../core/types';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (content: string, attachments: ChatAttachment[]) => void;
  isStreaming: boolean;
  webSearchEnabled?: boolean;
  onToggleWebSearch?: (enabled: boolean) => void;
  hasSearchKey?: boolean;
}

// Collapsible thinking section component
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
        <svg
          className={`thinking-chevron ${isExpanded ? 'expanded' : ''}`}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
      {isExpanded && (
        <div className="thinking-content">
          {thinkingContent}
        </div>
      )}
    </div>
  );
}

// Simple copy button component for code blocks
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button className="code-copy-btn" onClick={handleCopy}>
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

// Copy button component for message bubbles
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
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-success)' }}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
      <span style={{ color: copied ? 'var(--color-success)' : 'inherit' }}>
        {copied ? 'Copied!' : 'Copy'}
      </span>
    </button>
  );
}

// Simple HTML/Markdown custom renderer
function renderContent(content: string): React.ReactNode[] {
  if (!content) return [];

  const parts: React.ReactNode[] = [];
  const lines = content.split('\n');
  let insideCodeBlock = false;
  let codeBlockContent: string[] = [];
  let codeBlockLang = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (insideCodeBlock) {
        // End of code block
        const codeText = codeBlockContent.join('\n');
        parts.push(
          <pre key={`code-${i}`}>
            <CopyButton text={codeText} />
            <code className={codeBlockLang ? `language-${codeBlockLang}` : ''}>
              {codeText}
            </code>
          </pre>
        );
        insideCodeBlock = false;
        codeBlockContent = [];
        codeBlockLang = '';
      } else {
        // Start of code block
        insideCodeBlock = true;
        codeBlockLang = line.slice(3).trim();
      }
      continue;
    }

    if (insideCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Handle bolding, inline code, links in a simple line renderer
    parts.push(<span key={`line-${i}`}>{renderLineContent(line)}<br /></span>);
  }

  return parts;
}

function renderLineContent(line: string): React.ReactNode {
  const regex = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  const parts = line.split(regex);

  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

// Helper to format file size
const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
};

// Collapsible Text File Card
function TextAttachmentCard({
  attachment,
}: {
  attachment: ChatAttachment;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="message-attachment-file-card">
      <div
        className="message-attachment-file-header"
        onClick={() => setIsExpanded(prev => !prev)}
      >
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
          <div className="message-attachment-file-name" title={attachment.name}>
            {attachment.name}
          </div>
          <span className="message-attachment-file-size">
            ({formatSize(attachment.size)})
          </span>
        </div>
        <span className={`message-attachment-file-toggle ${isExpanded ? 'expanded' : ''}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
      </div>
      {isExpanded && (
        <pre className="message-attachment-file-preview">
          <code>{attachment.content}</code>
        </pre>
      )}
    </div>
  );
}

export function ChatPanel({
  messages,
  onSendMessage,
  isStreaming,
  webSearchEnabled = false,
  onToggleWebSearch = () => {},
  hasSearchKey = false,
}: ChatPanelProps) {
  const [inputText, setInputText] = useState('');
  const [stagedAttachments, setStagedAttachments] = useState<ChatAttachment[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      const isImage = file.type.startsWith('image/');
      const reader = new FileReader();

      reader.onload = (event) => {
        const fileContent = event.target?.result as string;

        const newAttachment: ChatAttachment = {
          name: file.name,
          type: file.type || 'text/plain',
          size: file.size,
          content: fileContent,
        };

        setStagedAttachments(prev => [...prev, newAttachment]);
      };

      if (isImage) {
        reader.readAsDataURL(file);
      } else {
        reader.readAsText(file);
      }
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleTriggerUpload = () => {
    fileInputRef.current?.click();
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
          <div className="typing-indicator" id="typing-indicator">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>
        )}
      </div>

      <div className="chat-messages" id="chat-messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`message-item ${msg.role === 'user' ? 'user' : 'assistant'}`}>
            {msg.role === 'assistant' && msg.thinking && (
              <CollapsibleThinking thinkingContent={msg.thinking} />
            )}
            {msg.content && (
              <div className="message-bubble">
                {renderContent(msg.content)}
              </div>
            )}
            {msg.attachments && msg.attachments.length > 0 && (
              <div className="message-attachments">
                {msg.attachments.map((attach, idx) => {
                  const isImg = attach.type.startsWith('image/');
                  if (isImg) {
                    return (
                      <div key={idx} className="message-attachment-image-wrapper">
                        <img
                          src={attach.content}
                          alt={attach.name}
                          className="message-attachment-image"
                          onClick={() => {
                            const w = window.open();
                            w?.document.write(`
                              <html>
                                <head><title>${attach.name}</title></head>
                                <body style="margin:0; background:#0a0e1a; display:flex; align-items:center; justify-content:center; min-height:100vh;">
                                  <img src="${attach.content}" style="max-width:100%; max-height:100vh; object-fit:contain;" />
                                </body>
                              </html>
                            `);
                          }}
                        />
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
              <span>•</span>
              <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              {msg.content && (
                <>
                  <span>•</span>
                  <MessageCopyButton content={msg.content} />
                </>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
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
                    <button
                      className="staged-attachment-remove"
                      onClick={() => handleRemoveStaged(idx)}
                      title="Remove file"
                    >
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
            placeholder="Ask anything... (Enter to send, Shift+Enter for newline)"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
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
                onClick={handleTriggerUpload}
                disabled={isStreaming}
                title="Attach files (images or text)"
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
                title={hasSearchKey ? (webSearchEnabled ? "Disable Web Search" : "Enable Web Search") : "Enable Web Search (Tavily API Key is missing, configure in Settings)"}
                type="button"
                id="btn-web-search-toggle"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              </button>
            </div>
            <button
              className="btn-primary"
              onClick={handleSend}
              disabled={isStreaming || (inputText.trim().length === 0 && stagedAttachments.length === 0)}
              id="chat-send-btn"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
              <span>Send</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
