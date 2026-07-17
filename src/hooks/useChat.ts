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
  truncatedTools?: number;
  compressed?: boolean;
  llmCompressed?: boolean;
  summaryChars?: number;
  summaryPreview?: string;
  summary?: string;
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

  const pipelineRef = useRef<Array<{ stage: string; label: string; done: boolean; active: boolean }>>([]);

  const STAGE_ORDER = [
    'received',
    'memory',
    'packing',
    'compressing',
    'model',
    'thinking',
    'tools',
    'generating',
  ] as const;

  const STAGE_LABELS: Record<string, string> = {
    received: '接收',
    memory: '记忆',
    packing: '整理',
    compressing: '压缩',
    model: '模型',
    thinking: '思考',
    tools: '工具',
    generating: '生成',
  };

  const setPhase = useCallback(
    (phase: ChatActivity['phase'], label: string, detail?: string, percent?: number) => {
      setActivity({
        phase,
        label,
        detail,
        startedAt: Date.now(),
        percent,
        pipeline: pipelineRef.current.length ? [...pipelineRef.current] : undefined,
      });
    },
    [],
  );

  const applyServerProgress = useCallback(
    (stage: string, message: string, percent?: number) => {
      const labels = STAGE_LABELS;
      const order = STAGE_ORDER as readonly string[];
      const idx = order.indexOf(stage === 'tools' ? 'tools' : stage);
      // Build / update pipeline
      const stagesToShow = order.filter(s => {
        // hide compressing unless we hit it
        if (s === 'compressing' && stage !== 'compressing' && !pipelineRef.current.some(p => p.stage === 'compressing')) {
          return false;
        }
        if (s === 'thinking' && stage !== 'thinking' && !pipelineRef.current.some(p => p.stage === 'thinking')) {
          return false;
        }
        if (s === 'tools' && stage !== 'tools' && !pipelineRef.current.some(p => p.stage === 'tools')) {
          // show tools only if we enter tools or already did
          return pipelineRef.current.some(p => p.stage === 'tools') || stage === 'tools';
        }
        return true;
      });

      const activeIdx = idx >= 0 ? idx : stagesToShow.length - 1;
      pipelineRef.current = stagesToShow.map((s, i) => ({
        stage: s,
        label: labels[s] || s,
        done: i < activeIdx || (i === activeIdx && (stage === 'generating' || stage === 'done')),
        active: i === activeIdx && stage !== 'done',
      }));

      // When generating, mark model/generating done appropriately
      if (stage === 'generating') {
        pipelineRef.current = pipelineRef.current.map(p =>
          p.stage === 'model' || p.stage === 'generating'
            ? { ...p, done: p.stage === 'model', active: p.stage === 'generating' }
            : p.stage === 'thinking'
              ? { ...p, done: true, active: false }
              : p,
        );
      }

      const phaseMap: Record<string, ChatActivity['phase']> = {
        received: 'received',
        memory: 'memory',
        packing: 'packing',
        compressing: 'compressing',
        model: 'model',
        thinking: 'thinking',
        tools: 'tool',
        generating: 'streaming',
      };
      setActivity({
        phase: phaseMap[stage] || 'sending',
        label: message,
        detail: percent != null ? `${percent}%` : undefined,
        startedAt: Date.now(),
        percent,
        pipeline: [...pipelineRef.current],
      });
    },
    [],
  );

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
      pipelineRef.current = [];
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
          },
          onProgress: p => {
            touchEvent();
            applyServerProgress(p.stage, p.message, p.percent);
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

  /**
   * Manual context compression: pack + optional LLM summary (no chat reply).
   * Injects a system note so later turns keep the summary in outbound history.
   */
  const handleCompressContext = useCallback(async () => {
    if (isStreaming) return;
    if (!opts.backendAvailableRef.current || !backendClient.isConnected()) {
      const reconnected = await backendClient.connect();
      if (reconnected) opts.markAvailable();
      if (!backendClient.isConnected()) {
        setMessages(prev => [
          ...prev,
          {
            id: uid('msg'),
            role: 'system',
            content: '⚠️ Backend offline — start server to compress context.',
            timestamp: Date.now(),
            ephemeral: true,
          },
        ]);
        return;
      }
    }

    const outbound = buildOutboundMessages(messagesRef.current);
    if (outbound.filter(m => m.role === 'user' || m.role === 'assistant').length < 2) {
      setMessages(prev => [
        ...prev,
        {
          id: uid('msg'),
          role: 'system',
          content: 'ℹ️ Need more conversation history before compressing.',
          timestamp: Date.now(),
          ephemeral: true,
        },
      ]);
      return;
    }

    setIsStreaming(true);
    setPhase('packing', 'Compressing context…');
    pipelineRef.current = [];
    touchEvent();

    let finalStats: PackStats | null = null;

    const sent = await backendClient.compressContext(
      outbound,
      opts.activeModelId,
      {
        onPackStats: stats => {
          touchEvent();
          finalStats = stats;
          setLastPackStats(stats);
        },
        onProgress: p => {
          touchEvent();
          applyServerProgress(p.stage, p.message, p.percent);
        },
        onDone: () => {
          setIsStreaming(false);
          setPhase('idle', '');
          const s = finalStats as PackStats | null;
          const detail = s
            ? `~${s.estimatedTokens} tok · ${s.strategy}` +
              (s.droppedMessages ? ` · dropped ${s.droppedMessages}` : '') +
              (s.llmCompressed ? ' · LLM summary' : s.compressed ? ' · packed' : '')
            : 'done';
          const summaryBody =
            s?.summary ||
            (s?.summaryPreview ? s.summaryPreview : '');
          setMessages(prev => [
            ...prev,
            {
              id: uid('msg'),
              role: 'system',
              content:
                `📦 **Context compressed** — ${detail}` +
                (summaryBody
                  ? `\n\n# Conversation summary (older turns)\n${summaryBody}`
                  : ''),
              timestamp: Date.now(),
              // Keep summary in outbound history for next turns
              ephemeral: false,
            },
          ]);
        },
        onError: message => {
          setIsStreaming(false);
          setPhase('error', message);
          setMessages(prev => [
            ...prev,
            {
              id: uid('msg'),
              role: 'system',
              content: `⚠️ **Compress failed**: ${message}`,
              timestamp: Date.now(),
              ephemeral: true,
            },
          ]);
        },
      },
      { forceCompress: true },
    );

    if (!sent) {
      setIsStreaming(false);
      setPhase('idle', '');
    }
  }, [isStreaming, opts, setPhase, touchEvent, applyServerProgress]);

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
    handleCompressContext,
    resetToWelcome,
  };
}
