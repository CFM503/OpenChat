import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getConfig,
  healthCheck,
  listSessions,
  listSkills,
  listTools,
  makeApiBase,
  makeWsUrl,
  reloadExtensions,
  waitForHealth,
} from './api.js';
import { LineEditor } from './lineEditor.js';
import { enterAltScreen, leaveAltScreen, render, enableWindowsVt, type ScreenState } from './screen.js';
import type {
  ChatMessage,
  ProgressStage,
  ServerMessage,
  TuiOptions,
} from './types.js';
import { WsClient, type WsStatus } from './wsClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function readVersionSafe(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export async function runTui(opts: TuiOptions): Promise<void> {
  enableWindowsVt();
  const apiBase = makeApiBase(opts.host, opts.port);
  const wsUrl = makeWsUrl(opts.host, opts.port);

  let serverProc: ChildProcess | null = null;
  let healthOk = false;
  let canMakeRequest = false;
  let cwd = opts.cwd;
  let modelId = opts.modelId;
  let enableThinking = opts.enableThinking;
  let version = readVersionSafe();

  // ── Ensure backend ──────────────────────────────────────────────────
  process.stderr.write(`Connecting to ${apiBase} …\n`);
  try {
    const h = await healthCheck(apiBase);
    healthOk = true;
    canMakeRequest = h.canMakeRequest;
    cwd = h.workingDirectory || cwd;
  } catch {
    if (!opts.autoServe) {
      process.stderr.write(
        `Backend not reachable at ${apiBase}\nStart with: openchat serve\nOr: openchat tui --serve\n`,
      );
      process.exit(1);
    }
    process.stderr.write('Backend offline — starting server…\n');
    serverProc = spawnServer(opts);
    try {
      const h = await waitForHealth(apiBase, { attempts: 50, intervalMs: 200 });
      healthOk = true;
      canMakeRequest = h.canMakeRequest;
      cwd = h.workingDirectory || cwd;
    } catch (err: any) {
      process.stderr.write(`Failed to start backend: ${err.message || err}\n`);
      serverProc?.kill();
      process.exit(1);
    }
  }

  // Load default model from config if not set
  try {
    const cfg = await getConfig(apiBase);
    if (!modelId && cfg.activeModelId) modelId = cfg.activeModelId;
  } catch {
    /* optional */
  }

  // ── State ───────────────────────────────────────────────────────────
  const editor = new LineEditor();
  const messages: ChatMessage[] = [];
  let isStreaming = false;
  let wsStatus: WsStatus = 'connecting';
  let progress: ScreenState['progress'];
  let packStats: ScreenState['packStats'];
  /** True while running compress-only (no assistant bubble) */
  let isCompressingOnly = false;
  let statusNote: string | undefined;
  let errorBanner: string | undefined;
  let scrollOffset = 0;
  let showHelp = false;
  let interruptCount = 0;
  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  const startedAt = Date.now();
  let streamAssistantId: string | null = null;
  let lastContentFlush = 0;

  const state = (): ScreenState => ({
    version,
    host: opts.host,
    port: opts.port,
    modelId,
    enableThinking,
    wsStatus,
    healthOk,
    canMakeRequest,
    cwd,
    messages: [...messages],
    isStreaming,
    progress,
    packStats,
    statusNote,
    errorBanner,
    scrollOffset,
    showHelp,
    editor,
    startedAt,
  });

  const scheduleRender = (immediate = false) => {
    dirty = true;
    if (immediate) {
      if (renderTimer) {
        clearTimeout(renderTimer);
        renderTimer = null;
      }
      dirty = false;
      render(state());
      return;
    }
    // Throttle streaming paints ~30fps
    if (renderTimer) return;
    const delay = isStreaming ? 32 : 16;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      if (!dirty) return;
      dirty = false;
      render(state());
    }, delay);
  };

  // ── WebSocket ───────────────────────────────────────────────────────
  const ws = new WsClient(wsUrl, {
    onStatus: (s, detail) => {
      wsStatus = s;
      if (s === 'error' && detail) statusNote = detail;
      if (s === 'open') statusNote = undefined;
      if (s === 'closed') statusNote = 'reconnecting…';
      scheduleRender(true);
    },
    onMessage: (msg) => handleServerMessage(msg),
  });

  function handleServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'progress': {
        progress = {
          stage: msg.stage as ProgressStage,
          message: msg.message,
          percent: msg.percent,
          round: msg.round,
        };
        scheduleRender();
        break;
      }
      case 'pack_stats': {
        packStats = {
          estimatedTokens: msg.estimatedTokens,
          strategy: msg.strategy,
          keptMessages: msg.keptMessages,
          droppedMessages: msg.droppedMessages,
          compressed: msg.compressed,
          llmCompressed: msg.llmCompressed,
          summaryPreview: msg.summaryPreview,
        };
        // If manual compress, inject summary into transcript for next turns
        if (isCompressingOnly && (msg.summary || msg.llmCompressed || msg.compressed)) {
          const detail =
            `~${msg.estimatedTokens} tok · ${msg.strategy}` +
            (msg.droppedMessages ? ` · −${msg.droppedMessages}` : '') +
            (msg.llmCompressed ? ' · LLM' : msg.compressed ? ' · packed' : '');
          const body = msg.summary
            ? `\n\n# Conversation summary (older turns)\n${msg.summary}`
            : msg.summaryPreview
              ? `\n\n${msg.summaryPreview}`
              : '';
          // Replace previous compress system notes to avoid stacking
          for (let i = messages.length - 1; i >= 0; i--) {
            if (
              messages[i].role === 'system' &&
              messages[i].content.startsWith('📦 Context compressed')
            ) {
              messages.splice(i, 1);
            }
          }
          messages.push({
            id: uid('sys'),
            role: 'system',
            content: `📦 Context compressed — ${detail}${body}`,
            timestamp: Date.now(),
          });
        }
        scheduleRender(true);
        break;
      }
      case 'thinking': {
        if (!streamAssistantId) break;
        const m = messages.find((x) => x.id === streamAssistantId);
        if (m) {
          m.thinking = (m.thinking || '') + (msg.text || '');
          scheduleRender();
        }
        break;
      }
      case 'content': {
        if (!streamAssistantId) break;
        const m = messages.find((x) => x.id === streamAssistantId);
        if (m) {
          m.content += msg.text || '';
          const now = Date.now();
          if (now - lastContentFlush > 32) {
            lastContentFlush = now;
            scheduleRender();
          } else {
            scheduleRender();
          }
        }
        break;
      }
      case 'tool_start': {
        if (!streamAssistantId) break;
        const m = messages.find((x) => x.id === streamAssistantId);
        if (m) {
          if (!m.toolEvents) m.toolEvents = [];
          m.toolEvents.push({
            toolCallId: msg.toolCallId,
            name: msg.name,
            input: msg.input,
            status: 'running',
          });
          scheduleRender(true);
        }
        break;
      }
      case 'tool_result': {
        if (!streamAssistantId) break;
        const m = messages.find((x) => x.id === streamAssistantId);
        if (m?.toolEvents) {
          const te = m.toolEvents.find((t) => t.toolCallId === msg.toolCallId);
          if (te) {
            te.status = 'done';
            te.success = msg.result?.success;
            te.output = msg.result?.output;
            te.error = msg.result?.error;
            te.duration = msg.result?.duration;
          } else {
            m.toolEvents.push({
              toolCallId: msg.toolCallId,
              name: msg.name,
              status: 'done',
              success: msg.result?.success,
              output: msg.result?.output,
              error: msg.result?.error,
              duration: msg.result?.duration,
            });
          }
          scheduleRender(true);
        }
        break;
      }
      case 'error': {
        errorBanner = msg.message;
        if (isCompressingOnly) {
          isCompressingOnly = false;
          isStreaming = false;
          progress = undefined;
        }
        scheduleRender(true);
        break;
      }
      case 'done': {
        if (isCompressingOnly) {
          isCompressingOnly = false;
          isStreaming = false;
          progress = undefined;
          statusNote = packStats?.llmCompressed
            ? 'context LLM-compressed'
            : packStats?.compressed
              ? 'context packed'
              : 'compress finished';
          scheduleRender(true);
          break;
        }
        finishStream();
        break;
      }
      case 'pong':
        break;
    }
  }

  function finishStream(): void {
    if (streamAssistantId) {
      const m = messages.find((x) => x.id === streamAssistantId);
      if (m) {
        m.isStreaming = false;
        if (!m.content && !m.thinking && errorBanner) {
          m.content = `*(error)* ${errorBanner}`;
        } else if (!m.content && !m.thinking) {
          m.content = m.content || '';
        }
      }
    }
    isStreaming = false;
    streamAssistantId = null;
    progress = undefined;
    scheduleRender(true);
  }

  function sendChat(text: string): void {
    if (isStreaming) {
      statusNote = 'Already streaming — Esc to abort';
      scheduleRender(true);
      return;
    }
    if (ws.status !== 'open') {
      errorBanner = 'WebSocket not connected';
      scheduleRender(true);
      return;
    }

    errorBanner = undefined;
    showHelp = false;
    scrollOffset = 0;

    const userMsg: ChatMessage = {
      id: uid('user'),
      role: 'user',
      content: text,
      timestamp: Date.now(),
      modelId,
    };
    const assistantMsg: ChatMessage = {
      id: uid('asst'),
      role: 'assistant',
      content: '',
      thinking: '',
      timestamp: Date.now(),
      modelId,
      isStreaming: true,
      toolEvents: [],
    };
    messages.push(userMsg, assistantMsg);
    streamAssistantId = assistantMsg.id;
    isStreaming = true;
    progress = { stage: 'received', message: 'sending…', percent: 1 };
    scheduleRender(true);

    // Only send completed turns + current user (server builds assistant)
    const payloadMsgs = messages
      .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.id !== assistantMsg.id))
      .map((m) => ({
        id: m.id,
        role: m.role as ChatMessage['role'],
        content: m.content,
        thinking: m.thinking,
        timestamp: m.timestamp,
        modelId: m.modelId,
      }));

    ws.sendChat({
      messages: payloadMsgs,
      modelId,
      enableThinking,
    });
  }

  function abortStream(): void {
    if (!isStreaming) return;
    ws.abort();
    if (streamAssistantId) {
      const m = messages.find((x) => x.id === streamAssistantId);
      if (m) {
        m.isStreaming = false;
        if (!m.content) m.content = '*(aborted)*';
      }
    }
    isStreaming = false;
    streamAssistantId = null;
    progress = undefined;
    statusNote = 'aborted';
    scheduleRender(true);
  }

  async function handleSlash(line: string): Promise<boolean> {
    const raw = line.slice(1).trim();
    const [cmd, ...rest] = raw.split(/\s+/);
    const arg = rest.join(' ').trim();
    const name = (cmd || '').toLowerCase();

    switch (name) {
      case 'help':
      case 'h':
      case '?':
        showHelp = !showHelp;
        scheduleRender(true);
        return true;
      case 'clear':
      case 'new':
        messages.length = 0;
        errorBanner = undefined;
        progress = undefined;
        packStats = undefined;
        showHelp = false;
        statusNote = 'conversation cleared';
        scheduleRender(true);
        return true;
      case 'quit':
      case 'exit':
      case 'q':
        await shutdown(0);
        return true;
      case 'abort':
      case 'stop':
        abortStream();
        return true;
      case 'think': {
        if (!arg || arg === 'toggle') {
          enableThinking = !enableThinking;
        } else if (arg === 'on' || arg === '1' || arg === 'true') {
          enableThinking = true;
        } else if (arg === 'off' || arg === '0' || arg === 'false') {
          enableThinking = false;
        }
        statusNote = `thinking ${enableThinking ? 'on' : 'off'}`;
        scheduleRender(true);
        return true;
      }
      case 'model': {
        if (arg) {
          modelId = arg;
          statusNote = `model → ${modelId}`;
        } else {
          try {
            const cfg = await getConfig(apiBase);
            const list = (cfg.models || [])
              .map((m) => m.id || m.model || m.name)
              .filter(Boolean)
              .slice(0, 12);
            messages.push({
              id: uid('sys'),
              role: 'system',
              content:
                `Active: ${modelId || cfg.activeModelId || 'default'}\n` +
                (list.length ? `Configured: ${list.join(', ')}` : 'No models in config'),
              timestamp: Date.now(),
            });
          } catch (e: any) {
            errorBanner = e.message;
          }
        }
        scheduleRender(true);
        return true;
      }
      case 'status': {
        try {
          const h = await healthCheck(apiBase);
          healthOk = true;
          canMakeRequest = h.canMakeRequest;
          cwd = h.workingDirectory || cwd;
          messages.push({
            id: uid('sys'),
            role: 'system',
            content:
              `status=${h.status}  ws=${wsStatus}  tools=${h.tools.length}  ` +
              `skills=${h.skills}  plugins=${h.plugins}  canRequest=${h.canMakeRequest}\n` +
              `cwd=${h.workingDirectory}`,
            timestamp: Date.now(),
          });
        } catch (e: any) {
          healthOk = false;
          errorBanner = e.message;
        }
        scheduleRender(true);
        return true;
      }
      case 'tools': {
        try {
          const tools = await listTools(apiBase);
          messages.push({
            id: uid('sys'),
            role: 'system',
            content: tools.map((t) => `${t.name} — ${t.description?.slice(0, 80) || ''}`).join('\n'),
            timestamp: Date.now(),
          });
        } catch (e: any) {
          errorBanner = e.message;
        }
        scheduleRender(true);
        return true;
      }
      case 'skills': {
        try {
          const skills = await listSkills(apiBase);
          messages.push({
            id: uid('sys'),
            role: 'system',
            content: skills.length
              ? skills
                  .map((s) => `${s.shortcut || s.name}  [${s.source || '-'}]  ${s.description || ''}`)
                  .join('\n')
              : 'No skills loaded.',
            timestamp: Date.now(),
          });
        } catch (e: any) {
          errorBanner = e.message;
        }
        scheduleRender(true);
        return true;
      }
      case 'sessions': {
        try {
          const sessions = await listSessions(apiBase);
          messages.push({
            id: uid('sys'),
            role: 'system',
            content: sessions.length
              ? sessions
                  .map(
                    (s) =>
                      `${s.id}  ${(s.title || '').slice(0, 40)}  msgs=${s.messages?.length ?? '?'}`,
                  )
                  .join('\n')
              : 'No sessions.',
            timestamp: Date.now(),
          });
        } catch (e: any) {
          errorBanner = e.message;
        }
        scheduleRender(true);
        return true;
      }
      case 'reload': {
        try {
          const r = await reloadExtensions(apiBase);
          statusNote = `reloaded ${JSON.stringify(r)}`;
        } catch (e: any) {
          errorBanner = e.message;
        }
        scheduleRender(true);
        return true;
      }
      case 'compress':
      case 'zip':
      case 'pack': {
        if (isStreaming) {
          statusNote = 'Already busy — abort first';
          scheduleRender(true);
          return true;
        }
        if (ws.status !== 'open') {
          errorBanner = 'WebSocket not connected';
          scheduleRender(true);
          return true;
        }
        const payloadMsgs = messages
          .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
          .filter((m) => m.content?.trim())
          .map((m) => ({
            id: m.id,
            role: m.role as ChatMessage['role'],
            content: m.content,
            thinking: m.thinking,
            timestamp: m.timestamp,
            modelId: m.modelId,
          }));
        if (payloadMsgs.filter((m) => m.role === 'user' || m.role === 'assistant').length < 2) {
          messages.push({
            id: uid('sys'),
            role: 'system',
            content: 'Need more conversation history before compressing.',
            timestamp: Date.now(),
          });
          scheduleRender(true);
          return true;
        }
        errorBanner = undefined;
        isCompressingOnly = true;
        isStreaming = true;
        progress = { stage: 'packing', message: 'compressing context…', percent: 20 };
        statusNote = 'compressing…';
        scheduleRender(true);
        ws.sendCompress({
          messages: payloadMsgs,
          modelId,
          forceCompress: true,
        });
        return true;
      }
      default:
        messages.push({
          id: uid('sys'),
          role: 'system',
          content: `Unknown command /${name}. Try /help`,
          timestamp: Date.now(),
        });
        scheduleRender(true);
        return true;
    }
  }

  // ── Input / lifecycle ───────────────────────────────────────────────
  let shuttingDown = false;

  async function shutdown(code: number): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        /* ignore */
      }
    }
    process.stdin.removeAllListeners('data');
    leaveAltScreen();
    if (serverProc && !serverProc.killed) {
      try {
        serverProc.kill();
      } catch {
        /* ignore */
      }
    }
    process.exit(code);
  }

  process.on('SIGINT', () => {
    void shutdown(0);
  });
  process.on('SIGTERM', () => {
    void shutdown(0);
  });

  // Connect WS
  try {
    await ws.connect();
  } catch (err: any) {
    leaveAltScreen();
    process.stderr.write(`WebSocket connect failed: ${err.message || err}\n`);
    serverProc?.kill();
    process.exit(1);
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('TUI requires an interactive TTY.\n');
    await shutdown(1);
    return;
  }

  enterAltScreen();
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  scheduleRender(true);

  // Clock tick for elapsed time in footer
  const clock = setInterval(() => {
    if (!shuttingDown) scheduleRender();
  }, 1000);

  process.stdout.on('resize', () => scheduleRender(true));

  process.stdin.on('data', (data: string | Buffer) => {
    if (shuttingDown) return;
    const action = editor.handle(data);

    switch (action.type) {
      case 'submit': {
        interruptCount = 0;
        const text = action.value.trim();
        if (!text) {
          scheduleRender(true);
          break;
        }
        if (text.startsWith('/')) {
          void handleSlash(text).then(() => scheduleRender(true));
        } else {
          sendChat(text);
        }
        break;
      }
      case 'abort':
        interruptCount = 0;
        abortStream();
        break;
      case 'interrupt':
        if (isStreaming) {
          abortStream();
          interruptCount = 0;
        } else {
          interruptCount++;
          if (interruptCount >= 2) {
            clearInterval(clock);
            void shutdown(0);
          } else {
            statusNote = 'Ctrl+C again to quit';
            scheduleRender(true);
          }
        }
        break;
      case 'quit':
        clearInterval(clock);
        void shutdown(0);
        break;
      case 'clear':
        scheduleRender(true);
        break;
      case 'help':
        showHelp = !showHelp;
        scheduleRender(true);
        break;
      case 'scroll': {
        const page = Math.max(5, (process.stdout.rows || 24) - 8);
        if (action.dir === 'pageup') scrollOffset += page;
        else if (action.dir === 'pagedown') scrollOffset = Math.max(0, scrollOffset - page);
        else if (action.dir === 'up') scrollOffset += 1;
        else if (action.dir === 'down') scrollOffset = Math.max(0, scrollOffset - 1);
        else if (action.dir === 'home') scrollOffset = 99999;
        else if (action.dir === 'end') scrollOffset = 0;
        scheduleRender(true);
        break;
      }
      case 'change':
        interruptCount = 0;
        scheduleRender(true);
        break;
      default:
        break;
    }
  });

  // Stay alive until shutdown() → process.exit
  await new Promise<void>(() => {});
}

function spawnServer(opts: TuiOptions): ChildProcess {
  const entry = path.join(ROOT, 'server', 'src', 'index.ts');
  const env = {
    ...process.env,
    OPENCHAT_PORT: String(opts.port),
    OPENCHAT_CWD: opts.cwd || process.cwd(),
  };
  const tsxCli = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const child = spawn(process.execPath, [tsxCli, entry], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
  });
  // Quiet server logs while TUI is active (still surface crash)
  child.stderr?.on('data', (buf: Buffer) => {
    const s = buf.toString();
    if (/error|EADDRINUSE|listen/i.test(s)) {
      process.stderr.write(s);
    }
  });
  return child;
}
