import { useState, useCallback, useRef } from 'react';
import type { ChatMessage, ChatAttachment, ToolEvent, ModelConfig, SearchProvider } from '../core/types';
import { createParserState, feedChunk, finalize } from '../core/streamParser';
import { simulateStream } from '../core/simulatedApi';
import { canMakeRealRequest } from '../core/apiClient';
import { searchWeb, type SearchProviderConfig } from '../core/searchClient';
import { backendClient } from '../services/api';
import type { ModelRouter } from '../core/modelRouter';
import { uid } from '../lib/uid';

const WELCOME: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content:
    'Welcome to **OpenChat**!\n\n' +
    '🔌 **Agent Mode**: `npm run dev:all` + configure a model (`Ctrl+,`).\n' +
    '📁 **Workspace**: open/edit/save files · ✅ **Tasks** · ⚡ **Skills** (`/`)\n' +
    '⌨️ `Ctrl+N` new · `Ctrl+B` sidebar · `Ctrl+E` export · `Esc` stop',
  timestamp: Date.now(),
};

export interface PackStats {
  estimatedTokens: number;
  strategy: string;
  keptMessages: number;
  droppedMessages: number;
}

export function useChat(opts: {
  activeModelId: string;
  modelRouterRef: React.MutableRefObject<ModelRouter>;
  backendAvailableRef: React.MutableRefObject<boolean>;
  markAvailable: () => void;
  markUnavailable: () => void;
  webSearchEnabled: boolean;
  searchProvider: SearchProvider;
  searchApiKey: string;
  searchBaseUrl: string;
  hasSearchKey: boolean;
  /** Updated each render; avoids circular hook order with useSessions */
  ensureSessionRef: React.MutableRefObject<() => Promise<string | null>>;
  onNeedSearchSettings?: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([{ ...WELCOME, id: uid('msg') }]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastPackStats, setLastPackStats] = useState<PackStats | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const handleStopStreaming = useCallback(() => {
    if (opts.backendAvailableRef.current) backendClient.abort();
    streamAbortRef.current?.abort();
  }, [opts.backendAvailableRef]);

  const handleSendMessage = useCallback(
    async (content: string, attachments?: ChatAttachment[]) => {
      if (isStreaming) return;
      if (content.trim().length === 0 && (!attachments || attachments.length === 0)) return;

      await opts.ensureSessionRef.current();

      const userMsg: ChatMessage = {
        id: uid('msg'),
        role: 'user',
        content: content.trim(),
        attachments: attachments || [],
        timestamp: Date.now(),
        modelId: opts.activeModelId,
      };
      const assistantMsgId = uid('msg');
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        thinking: '',
        timestamp: Date.now(),
        modelId: opts.activeModelId,
        isStreaming: true,
      };

      setMessages(prev => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);
      const abortController = new AbortController();
      streamAbortRef.current = abortController;

      let parserState = createParserState();
      let accumulatedContent = '';
      let accumulatedThinking = '';

      const handleChunk = (chunk: string) => {
        if (streamAbortRef.current?.signal.aborted) return;
        const result = feedChunk(parserState, chunk);
        parserState = result.state;
        for (const parsed of result.chunks) {
          if (parsed.type === 'thinking') accumulatedThinking += parsed.text;
          else accumulatedContent += parsed.text;
        }
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMsgId
              ? { ...m, content: accumulatedContent, thinking: accumulatedThinking }
              : m,
          ),
        );
      };

      const handleDone = () => {
        const remaining = finalize(parserState);
        for (const parsed of remaining) {
          if (parsed.type === 'thinking') accumulatedThinking += parsed.text;
          else accumulatedContent += parsed.text;
        }
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: accumulatedContent,
                  thinking: accumulatedThinking,
                  isStreaming: false,
                }
              : m,
          ),
        );
        setIsStreaming(false);
        streamAbortRef.current = null;
      };

      let injectedMessages = [...messagesRef.current, userMsg];

      if (opts.webSearchEnabled && opts.hasSearchKey) {
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMsgId
              ? { ...m, content: `🔍 Searching the web for: "${content.trim()}"...` }
              : m,
          ),
        );
        try {
          const searchConfig: SearchProviderConfig = {
            provider: opts.searchProvider,
            apiKey: opts.searchApiKey,
            baseUrl: opts.searchBaseUrl,
          };
          const searchContext = await searchWeb(content.trim(), searchConfig);
          const systemMsg: ChatMessage = {
            id: uid('msg'),
            role: 'system',
            content: `Today's date: ${new Date().toLocaleDateString('zh-CN', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}.\n\n${searchContext}`,
            timestamp: Date.now(),
          };
          injectedMessages = [...messagesRef.current, systemMsg, userMsg];
          setMessages(prev =>
            prev.map(m => (m.id === assistantMsgId ? { ...m, content: '' } : m)),
          );
        } catch (err: any) {
          accumulatedContent = `⚠️ **Web Search Failed**: ${err.message}\n\n`;
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantMsgId
                ? { ...m, content: accumulatedContent, isStreaming: false }
                : m,
            ),
          );
          setIsStreaming(false);
          streamAbortRef.current = null;
          return;
        }
      }

      const activeConfig = opts.modelRouterRef.current.getModel(opts.activeModelId);

      const runViaBackend = async (): Promise<boolean> => {
        const toolEvents: ToolEvent[] = [];
        let assistantContent = '';
        const sent = await backendClient.sendMessage(injectedMessages, opts.activeModelId, {
          onContent: text => {
            assistantContent += text;
            setMessages(prev =>
              prev.map(m => (m.id === assistantMsgId ? { ...m, content: assistantContent } : m)),
            );
          },
          onThinking: text => {
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantMsgId
                  ? { ...m, thinking: (m.thinking ?? '') + text }
                  : m,
              ),
            );
          },
          onToolEvent: event => {
            toolEvents.push(event);
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantMsgId ? { ...m, toolEvents: [...toolEvents] } : m,
              ),
            );
          },
          onPackStats: stats => setLastPackStats(stats),
          onDone: () => {
            setMessages(prev =>
              prev.map(m => (m.id === assistantMsgId ? { ...m, isStreaming: false } : m)),
            );
            setIsStreaming(false);
            streamAbortRef.current = null;
          },
          onError: message => {
            assistantContent += `\n\n⚠️ **Error**: ${message}`;
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantMsgId
                  ? { ...m, content: assistantContent, isStreaming: false }
                  : m,
              ),
            );
            setIsStreaming(false);
            streamAbortRef.current = null;
          },
        });
        return sent;
      };

      if (opts.backendAvailableRef.current && backendClient.isConnected()) {
        const sent = await runViaBackend();
        if (sent) return;
        opts.markUnavailable();
      }

      if (canMakeRealRequest(activeConfig as ModelConfig | undefined)) {
        if (!opts.backendAvailableRef.current) {
          const reconnected = await backendClient.connect();
          if (reconnected) opts.markAvailable();
        }
        if (opts.backendAvailableRef.current && backendClient.isConnected()) {
          if (await runViaBackend()) return;
        }
        accumulatedContent +=
          `\n\n⚠️ **Backend not running**. Start with \`npm run dev:all\`.`;
        handleDone();
      } else {
        simulateStream(injectedMessages, handleChunk, handleDone, {
          speed: 60,
          signal: abortController.signal,
        });
      }
    },
    [isStreaming, opts],
  );

  const handleRetryMessage = useCallback(
    (assistantMsgId: string) => {
      if (isStreaming) return;
      const msgs = messagesRef.current;
      const idx = msgs.findIndex(m => m.id === assistantMsgId);
      if (idx < 1) return;
      const userMsg = msgs.slice(0, idx).reverse().find(m => m.role === 'user');
      if (!userMsg) return;
      setMessages(prev => prev.filter(m => m.id !== assistantMsgId));
      setTimeout(() => handleSendMessage(userMsg.content, userMsg.attachments || []), 100);
    },
    [isStreaming, handleSendMessage],
  );

  const handleExportChat = useCallback(() => {
    const lines: string[] = ['# OpenChat Export', '', `Exported: ${new Date().toISOString()}`, ''];
    for (const m of messagesRef.current) {
      if (m.role === 'system') continue;
      lines.push(`## ${m.role === 'user' ? 'User' : 'Assistant'}`, '');
      if (m.thinking) {
        lines.push('<details><summary>Thinking</summary>', '', m.thinking, '', '</details>', '');
      }
      lines.push(m.content || '', '');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `openchat-export-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  return {
    messages,
    setMessages,
    isStreaming,
    lastPackStats,
    messagesRef,
    streamAbortRef,
    handleSendMessage,
    handleStopStreaming,
    handleRetryMessage,
    handleExportChat,
  };
}
