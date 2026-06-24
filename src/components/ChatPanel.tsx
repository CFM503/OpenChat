// ============================================================================
// ChatPanel Component
// Handles message flow, stream parsing of <thinking> tags, collapsible accordion
// ============================================================================

import React, { useState, useRef, useEffect } from 'react';
import type { ChatMessage } from '../core/types';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (content: string) => void;
  isStreaming: boolean;
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
  // Regex to match inline code: `code`
  // Regex to match bold: **bold**
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

export function ChatPanel({ messages, onSendMessage, isStreaming }: ChatPanelProps) {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleSend = () => {
    if (inputText.trim().length === 0 || isStreaming) return;
    onSendMessage(inputText);
    setInputText('');
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
            <div className="message-info">
              <span>{msg.role === 'user' ? 'You' : 'Assistant'}</span>
              <span>•</span>
              <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        <div className="chat-input-wrapper">
          <textarea
            className="chat-textarea"
            placeholder="Ask anything... (Enter to send, Shift+Enter for newline)"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            id="chat-input-textarea"
          />
          <div className="chat-input-footer">
            <button
              className="btn-primary"
              onClick={handleSend}
              disabled={isStreaming || inputText.trim().length === 0}
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
