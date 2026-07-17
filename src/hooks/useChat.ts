import { useState, useCallback, useRef, useEffect } from 'react';
import type {
  ChatMessage,
  ChatAttachment,
  ToolEvent,
  ModelConfig,
  SearchProvider,
  ChatActivity,
} from '../core/types';
import { createParserState, feedChunk, finalize } from '../core/streamParser';
import { simulateStream } from '../core/simulatedApi';
import { canMakeRealRequest } from '../core/apiClient';
import { searchWeb, type SearchProviderConfig } from '../core/searchClient';
import { backendClient } from '../services/api';
import type { ModelRouter } from '../core/modelRouter';
import { uid } from '../lib/uid';
import { createStreamBatcher } from '../lib/streamBatch';

const WELCOME_MARKER = 'Welcome to **OpenChat**';

function makeWelcome(): ChatMessage {
  return {
    id: uid('msg'),
    role: 'assistant',
    content:
      'Welcome to **OpenChat**!\n\n' +
      '🔌 Configure a model in ⚙️ Settings, then chat — I can use tools, files, and skills.\n' +
      '📁 Workspace on the right · ✅ Tasks · `/` for skills · `Esc` to stop',
    timestamp: Date.now(),
    ephemeral: true,
  };
}

/** Messages safe to send to the model (no welcome / empty / system noise) */
export function buildOutboundMessages(
  all: ChatMessage[],
  extra?: ChatMessage[],
): ChatMessage[] {
  const list = [...all, ...(extra || [])];
  return list.filter(m => {
    if (m.ephemeral) return false;
    if (m.role === 'assistant' && m.content?.includes(WELCOME_MARKER)) return false;
    if (m.role === 'system') return true; // search injection etc.
    if (m.role === 'user') return !!(m.content?.trim() || m.attachments?.length);
    if (m.role === 'assistant') {
      // skip empty streaming shells
      if (m.isStreaming && !m.content && !m.thinking && !m.toolEvents?.length) return false;
      return !!(m.content?.trim() || m.thinking || m.toolEvents?.length);
    }
    return true;
  });
}

function mergeToolEvent(prev: ToolEvent[] | undefined, event: ToolEvent): ToolEvent[] {
  const list = [...(prev || [])];
  const idx = list.findIndex(e => e.toolCallId === event.toolCallId);
  if (idx >= 0) {
    list[idx] = {
      ...list[idx],
      ...event,
      // keep input from start if result has none
      input: event.input ?? list[idx].input,
      name: event.name || list[idx].name,
    };
  } else {
    list.push(event);
  }
  return list;
}

export interface PackStats {
  estimatedTokens: number;
  strategy: string;
  keptMessages: number;
  droppedMessages: number;
}

const STALE_WARN_MS = 25_000;
const STALE_TIMEOUT_MS = 120_000;

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
  /** false = skip deep thinking / CoT when provider supports it */
  enableThinking: boolean;
  ensureSessionRef: React.MutableRefObject<() => Promise<string | null>>;
  onNeedSearchSettings?: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([makeWelcome()]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activity, setActivity] = useState<ChatActivity>({
    phase: 'idle',
    label: '',
    startedAt: Date.now(),
  });
  const [lastPackStats, setLastPackStats] = useState<PackStats | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const lastEventAtRef = useRef(0);
  const assistantMsgIdRef = useRef<string | null>(null);
  const activityPhaseRef = useRef(activity.phase);
  activityPhaseRef.current = activity.phase;

  const setPhase = useCallback((phase: ChatActivity['phase'], label: string, detail?: string) => {
    setActivity({ phase, label, detail, startedAt: Date.now() });
  }, []);

  const touchEvent = useCallback(() => {
    lastEventAtRef.current = Date.now();
  }, []);

  // Stale stream watchdog — reassure user / surface hang
  useEffect(() => {
    if (!isStreaming) return;
    const t = setInterval(() => {
      const idle = Date.now() - lastEventAtRef.current;
      if (idle > STALE_TIMEOUT_MS) {
        setPhase(
          'thinking',
          'Still waiting for the model…',
          'No data for 2 minutes — check network or Stop and retry',
        );
      } else if (idle > STALE_WARN_MS && activityPhaseRef.current !== 'tool') {
        setPhase(
          'thinking',
          'Model is taking longer than usual…',
          `No new tokens for ${Math.round(idle / 1000)}s`,
        );
      }
    }, 3000);
    return () => clearInterval(t);
  }, [isStreaming, setPhase]);

  const handleStopStreaming = useCallback(() => {
    if (opts.backendAvailableRef.current) backendClient.abort();
    streamAbortRef.current?.abort();
    setIsStreaming(false);
    setPhase('idle', '');
    const id = assistantMsgIdRef.current;
    if (id) {
      setMessages(prev =>
        prev.map(m =>
          m.id === id
            ? {
                ...m,
                isStreaming: false,
                content:
                  m.content ||
                  '*(Stopped)*',
              }
            : m,
        ),
      );
    }
    streamAbortRef.current = null;
    assistantMsgIdRef.current = null;
  }, [opts.backendAvailableRef, setPhase]);

  const handleSendMessage = useCallback(
    async (content: string, attachments?: ChatAttachment[]) => {
      if (isStreaming) return;
      if (content.trim().length === 0 && (!attachments || attachments.length === 0)) return;

      setPhase('connecting', 'Preparing session…');
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
      assistantMsgIdRef.current = assistantMsgId;
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
      touchEvent();
      const abortController = new AbortController();
      streamAbortRef.current = abortController;

      let parserState = createParserState();
      let accumulatedContent = '';
      let accumulatedThinking = '';
      let phaseStreamingSet = false;
      // Pending tool events applied in the same rAF flush as text
      let pendingToolEvents: ToolEvent[] | null = null;

      const applyUi = () => {
        setMessages(prev =>
          prev.map(m => {
            if (m.id !== assistantMsgId) return m;
            const next: ChatMessage = {
              ...m,
              content: accumulatedContent,
              thinking: accumulatedThinking,
            };
            if (pendingToolEvents) {
              next.toolEvents = pendingToolEvents;
              pendingToolEvents = null;
            }
            return next;
          }),
        );
      };

      const batcher = createStreamBatcher(applyUi);

      const finishStream = (extra?: { content?: string; error?: boolean }) => {
        const remaining = finalize(parserState);
        for (const parsed of remaining) {
          if (parsed.type === 'thinking') accumulatedThinking += parsed.text;
          else accumulatedContent += parsed.text;
        }
        if (extra?.content) accumulatedContent += extra.content;
        batcher.flushNow();
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
        assistantMsgIdRef.current = null;
        batcher.cancel();
        setPhase(extra?.error ? 'error' : 'idle', extra?.error ? 'Error' : '');
      };

      const handleChunk = (chunk: string) => {
        if (streamAbortRef.current?.signal.aborted) return;
        touchEvent();
        if (!phaseStreamingSet) {
          phaseStreamingSet = true;
          setPhase('streaming', 'Generating reply…');
        }
        const result = feedChunk(parserState, chunk);
        parserState = result.state;
        for (const parsed of result.chunks) {
          if (parsed.type === 'thinking') accumulatedThinking += parsed.text;
          else accumulatedContent += parsed.text;
        }
        batcher.schedule();
      };

      // Build payload without welcome / empty assistants
      let injectedMessages = buildOutboundMessages(messagesRef.current, [userMsg]);

      // ── Optional web search ──────────────────────────────────────
      if (opts.webSearchEnabled && opts.hasSearchKey) {
        setPhase('searching', 'Searching the web…', content.trim().slice(0, 60));
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMsgId
              ? { ...m, content: '' }
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
          touchEvent();
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
          injectedMessages = buildOutboundMessages(messagesRef.current, [systemMsg, userMsg]);
        } catch (err: any) {
          accumulatedContent = `⚠️ **Web Search Failed**: ${err.message}\n\n`;
          finishStream({ error: true });
          return;
        }
      }

      const activeConfig = opts.modelRouterRef.current.getModel(opts.activeModelId);

      const runViaBackend = async (): Promise<boolean> => {
        setPhase('sending', 'Contacting agent…');
        touchEvent();
        let gotFirstToken = false;

        const sent = await backendClient.sendMessage(
          injectedMessages,
          opts.activeModelId,
          {
          onContent: text => {
            touchEvent();
            if (!gotFirstToken) {
              gotFirstToken = true;
              phaseStreamingSet = true;
              setPhase('streaming', 'Generating reply…');
            }
            accumulatedContent += text;
            batcher.schedule();
          },
          onThinking: text => {
            // UI still drops thinking if toggle is off (server should already suppress)
            if (!opts.enableThinking) return;
            touchEvent();
            setPhase('thinking', 'Reasoning…');
            accumulatedThinking += text;
            batcher.schedule();
          },
          onToolEvent: event => {
            touchEvent();
            // Flush text first so tool cards appear after current buffer
            batcher.flushNow();
            if (event.type === 'start') {
              setPhase('tool', `Running tool: ${event.name}`, event.input?.slice(0, 80));
            } else {
              setPhase(
                'tool',
                event.result?.success ? `✓ ${event.name}` : `✗ ${event.name}`,
                event.result?.success ? undefined : event.result?.error,
              );
            }
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantMsgId
                  ? { ...m, toolEvents: mergeToolEvent(m.toolEvents, event) }
                  : m,
              ),
            );
          },
          onPackStats: stats => {
            touchEvent();
            setLastPackStats(stats);
            setPhase(
              'sending',
              'Context packed',
              `~${stats.estimatedTokens} tokens · ${stats.strategy}`,
            );
          },
          onDone: () => {
            finishStream();
          },
          onError: message => {
            accumulatedContent += (accumulatedContent ? '\n\n' : '') + `⚠️ **Error**: ${message}`;
            finishStream({ error: true });
          },
          },
          { enableThinking: opts.enableThinking },
        );
        return sent;
      };

      // Prefer connected backend
      if (opts.backendAvailableRef.current && backendClient.isConnected()) {
        setPhase('connecting', 'Connected — starting agent…');
        const sent = await runViaBackend();
        if (sent) return;
        opts.markUnavailable();
      }

      if (canMakeRealRequest(activeConfig as ModelConfig | undefined)) {
        setPhase('connecting', 'Connecting to backend…');
        if (!opts.backendAvailableRef.current || !backendClient.isConnected()) {
          const reconnected = await backendClient.connect();
          if (reconnected) opts.markAvailable();
        }
        if (opts.backendAvailableRef.current && backendClient.isConnected()) {
          if (await runViaBackend()) return;
        }
        accumulatedContent =
          `⚠️ **Backend not running**.\n\nStart with \`npm run dev:all\` (or \`npm run dev:server\`) so the agent can call tools and models.`;
        finishStream({ error: true });
      } else {
        setPhase('streaming', 'Demo mode…');
        simulateStream(injectedMessages, handleChunk, () => finishStream(), {
          speed: 60,
          signal: abortController.signal,
        });
      }
    },
    [isStreaming, opts, setPhase, touchEvent],
  );

  const handleRetryMessage = useCallback(
    (assistantMsgId: string) => {
      if (isStreaming) return;
      const msgs = messagesRef.current;
      const idx = msgs.findIndex(m => m.id === assistantMsgId);
      if (idx < 1) return;
      const target = msgs[idx];
      if (target.ephemeral || target.content?.includes(WELCOME_MARKER)) return;
      const userMsg = msgs.slice(0, idx).reverse().find(m => m.role === 'user');
      if (!userMsg) return;
      // Remove failed assistant + keep user; re-send
      setMessages(prev => prev.filter(m => m.id !== assistantMsgId));
      setTimeout(() => handleSendMessage(userMsg.content, userMsg.attachments || []), 80);
    },
    [isStreaming, handleSendMessage],
  );

  const handleExportChat = useCallback(() => {
    const lines: string[] = ['# OpenChat Export', '', `Exported: ${new Date().toISOString()}`, ''];
    for (const m of messagesRef.current) {
      if (m.role === 'system' || m.ephemeral) continue;
      if (m.content?.includes(WELCOME_MARKER)) continue;
      lines.push(`## ${m.role === 'user' ? 'User' : 'Assistant'}`, '');
      if (m.thinking) {
        lines.push('<details><summary>Thinking</summary>', '', m.thinking, '', '</details>', '');
      }
      if (m.toolEvents?.length) {
        lines.push('### Tools', '');
        for (const te of m.toolEvents) {
          lines.push(`- \`${te.name}\` ${te.type}${te.result ? ` (${te.result.success ? 'ok' : 'err'})` : ''}`);
        }
        lines.push('');
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

  /** Reset chat UI to welcome (used by new session) */
  const resetToWelcome = useCallback(() => {
    setMessages([makeWelcome()]);
    setLastPackStats(null);
    setPhase('idle', '');
  }, [setPhase]);

  return {
    messages,
    setMessages,
    isStreaming,
    activity,
    lastPackStats,
    messagesRef,
    streamAbortRef,
    handleSendMessage,
    handleStopStreaming,
    handleRetryMessage,
    handleExportChat,
    resetToWelcome,
  };
}
