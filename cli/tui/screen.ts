import { c, fit, wrap, icons, visibleLen, stripAnsi } from './theme.js';
import type { ChatMessage, ProgressStage } from './types.js';
import { STAGE_LABELS } from './types.js';
import type { LineEditor } from './lineEditor.js';
import type { WsStatus } from './wsClient.js';

export interface ScreenState {
  version: string;
  host: string;
  port: number;
  modelId?: string;
  enableThinking: boolean;
  wsStatus: WsStatus;
  healthOk: boolean;
  canMakeRequest: boolean;
  cwd?: string;
  messages: ChatMessage[];
  isStreaming: boolean;
  progress?: { stage: ProgressStage; message: string; percent?: number; round?: number };
  packStats?: {
    estimatedTokens: number;
    strategy: string;
    keptMessages?: number;
    droppedMessages?: number;
    compressed?: boolean;
    llmCompressed?: boolean;
    summaryPreview?: string;
  };
  statusNote?: string;
  errorBanner?: string;
  scrollOffset: number; // lines from bottom (0 = stick to bottom)
  showHelp: boolean;
  editor: LineEditor;
  startedAt: number;
}

const BOX = {
  h: '─',
  v: '│',
  tl: '┌',
  tr: '┐',
  bl: '└',
  br: '┘',
  l: '├',
  r: '┤',
};

function size() {
  return {
    cols: Math.max(process.stdout.columns || 80, 40),
    rows: Math.max(process.stdout.rows || 24, 12),
  };
}

function bar(cols: number, left: string, right = '', bg = c.bgHeader): string {
  const pad = Math.max(0, cols - visibleLen(left) - visibleLen(right) - 2);
  return (
    bg +
    c.brightWhite +
    ' ' +
    left +
    ' '.repeat(pad) +
    right +
    ' ' +
    c.reset
  );
}

function percentBar(pct: number, width: number): string {
  const p = Math.max(0, Math.min(100, pct));
  const filled = Math.round((p / 100) * width);
  const empty = Math.max(0, width - filled);
  return (
    c.brightCyan +
    '█'.repeat(filled) +
    c.gray +
    '░'.repeat(empty) +
    c.reset +
    c.dim +
    ` ${p}%` +
    c.reset
  );
}

function statusDot(ws: WsStatus): string {
  if (ws === 'open') return c.brightGreen + '●' + c.reset;
  if (ws === 'connecting') return c.brightYellow + '●' + c.reset;
  if (ws === 'error') return c.brightRed + '●' + c.reset;
  return c.gray + '●' + c.reset;
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${String(s % 60).padStart(2, '0')}s`;
}

function buildChatLines(state: ScreenState, contentWidth: number): string[] {
  const lines: string[] = [];
  const pushWrap = (prefix: string, text: string, color = '') => {
    const prefixPlain = stripAnsi(prefix);
    const indent = ' '.repeat(Math.min(prefixPlain.length, 4));
    const firstWidth = Math.max(8, contentWidth - prefixPlain.length);
    const restWidth = Math.max(8, contentWidth - indent.length);
    const wrapped = wrap(text, firstWidth);
    if (wrapped.length === 0) {
      lines.push(prefix);
      return;
    }
    lines.push(prefix + color + wrapped[0] + c.reset);
    for (let i = 1; i < wrapped.length; i++) {
      lines.push(indent + color + wrapped[i] + c.reset);
    }
  };

  if (state.messages.length === 0 && !state.showHelp) {
    lines.push('');
    lines.push(
      c.dim +
        '  ' +
        icons.spark +
        '  Welcome to OpenChat TUI — type a message, or /help for commands' +
        c.reset,
    );
    lines.push(c.dim + '  Tips: Enter send · Esc/Ctrl+C abort · ↑↓ history · PgUp/PgDn scroll' + c.reset);
    lines.push('');
  }

  for (const msg of state.messages) {
    if (msg.role === 'user') {
      lines.push('');
      pushWrap(
        c.brightCyan + c.bold + `  ${icons.user} you  ` + c.reset,
        msg.content,
        c.brightWhite,
      );
    } else if (msg.role === 'assistant') {
      lines.push('');
      const header =
        c.brightMagenta +
        c.bold +
        `  ${icons.assistant} openchat` +
        c.reset +
        (msg.isStreaming ? c.dim + '  streaming…' + c.reset : '');
      lines.push(header);

      if (msg.thinking) {
        const thinkLines = wrap(msg.thinking.trim(), contentWidth - 6);
        const maxThink = msg.isStreaming ? 6 : 4;
        const shown = thinkLines.slice(-maxThink);
        if (thinkLines.length > maxThink) {
          lines.push(
            c.dim +
              `     ${icons.think} thinking (+${thinkLines.length - maxThink} lines)` +
              c.reset,
          );
        } else {
          lines.push(c.dim + `     ${icons.think} thinking` + c.reset);
        }
        for (const tl of shown) {
          lines.push(c.dim + c.italic + '     ' + tl + c.reset);
        }
      }

      if (msg.toolEvents?.length) {
        for (const te of msg.toolEvents) {
          if (te.status === 'running') {
            lines.push(
              c.cyan +
                `     ${icons.tool} ${te.name}` +
                c.dim +
                '  running…' +
                c.reset,
            );
            if (te.input) {
              const preview = te.input.replace(/\s+/g, ' ').slice(0, contentWidth - 12);
              lines.push(c.dim + '       ' + preview + c.reset);
            }
          } else {
            const mark = te.success ? c.brightGreen + icons.ok : c.brightRed + icons.fail;
            const dur = te.duration != null ? c.dim + ` ${te.duration}ms` + c.reset : '';
            lines.push(`     ${mark}${c.reset} ${c.cyan}${te.name}${c.reset}${dur}`);
            const out = (te.error || te.output || '').replace(/\s+/g, ' ').trim();
            if (out) {
              lines.push(c.dim + '       ' + out.slice(0, contentWidth - 12) + c.reset);
            }
          }
        }
      }

      if (msg.content) {
        const body = wrap(msg.content, contentWidth - 4);
        for (const bl of body) {
          lines.push('    ' + c.white + bl + c.reset);
        }
      } else if (msg.isStreaming && !msg.thinking && !msg.toolEvents?.length) {
        lines.push(c.dim + '    …' + c.reset);
      }
    } else if (msg.role === 'system') {
      lines.push('');
      pushWrap(c.yellow + `  ${icons.system} ` + c.reset, msg.content, c.yellow);
    }
  }

  // Live progress footer inside chat area while streaming
  if (state.isStreaming && state.progress) {
    lines.push('');
    const label = STAGE_LABELS[state.progress.stage] || state.progress.stage;
    const round =
      state.progress.round != null ? c.dim + ` r${state.progress.round}` + c.reset : '';
    lines.push(
      c.brightBlue +
        `  ${icons.progress} ${label}` +
        c.reset +
        round +
        c.dim +
        `  ${state.progress.message}` +
        c.reset,
    );
    if (state.progress.percent != null) {
      lines.push('     ' + percentBar(state.progress.percent, Math.min(24, contentWidth - 12)));
    }
  }

  if (state.errorBanner) {
    lines.push('');
    lines.push(c.brightRed + '  ✗ ' + state.errorBanner + c.reset);
  }

  if (state.showHelp) {
    lines.push('');
    lines.push(c.bold + c.brightCyan + '  Commands' + c.reset);
    const help = [
      ['/help', 'Show this help'],
      ['/clear', 'Clear conversation'],
      ['/model [id]', 'Show or set model id'],
      ['/think on|off', 'Toggle deep thinking'],
      ['/abort', 'Abort current stream (Esc)'],
      ['/status', 'Backend & connection status'],
      ['/tools', 'List tools'],
      ['/skills', 'List skills'],
      ['/sessions', 'List saved sessions'],
      ['/reload', 'Reload skills & plugins'],
      ['/compress', 'Pack + LLM-compress conversation context'],
      ['/quit', 'Exit TUI'],
    ];
    for (const [cmd, desc] of help) {
      lines.push(
        '  ' + c.brightWhite + cmd.padEnd(16) + c.reset + c.dim + desc + c.reset,
      );
    }
    lines.push(
      c.dim +
        '  Keys: Enter send · ↑↓ history · PgUp/PgDn scroll · Ctrl+L redraw · Ctrl+C abort/quit' +
        c.reset,
    );
    lines.push('');
  }

  return lines;
}

export function render(state: ScreenState): void {
  const { cols, rows } = size();
  const out: string[] = [];

  // Header
  const model = state.modelId || 'default';
  const think = state.enableThinking ? 'think:on' : 'think:off';
  const left =
    c.bold +
    c.brightMagenta +
    `${icons.spark} OpenChat TUI` +
    c.reset +
    c.bgHeader +
    c.dim +
    `  v${state.version}` +
    c.reset +
    c.bgHeader;
  const right =
    statusDot(state.wsStatus) +
    c.bgHeader +
    ' ' +
    c.brightWhite +
    `${state.host}:${state.port}` +
    c.reset +
    c.bgHeader +
    c.dim +
    ` · ${model} · ${think}` +
    c.reset +
    c.bgHeader;
  out.push(bar(cols, left, right, c.bgHeader));

  // Subheader meta
  const metaBits: string[] = [];
  if (state.cwd) metaBits.push(c.dim + state.cwd + c.reset);
  if (state.packStats) {
    const ps = state.packStats;
    const flags = [
      ps.llmCompressed ? 'llm-zip' : ps.compressed ? 'packed' : null,
      ps.droppedMessages ? `−${ps.droppedMessages}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    metaBits.push(
      c.dim +
        `~${ps.estimatedTokens} tok · ${ps.strategy}` +
        (flags ? ` · ${flags}` : '') +
        c.reset,
    );
  }
  if (state.canMakeRequest === false) {
    metaBits.push(c.brightYellow + 'no API credentials' + c.reset);
  }
  if (state.statusNote) metaBits.push(c.cyan + state.statusNote + c.reset);
  const metaLine =
    c.bgStatus +
    ' ' +
    fit(metaBits.join(c.bgStatus + c.dim + ' · ' + c.reset + c.bgStatus), cols - 2) +
    ' ' +
    c.reset;
  out.push(metaLine);

  // Divider
  out.push(c.gray + BOX.h.repeat(cols) + c.reset);

  // Chat body
  const inputRows = 2;
  const footerRows = 1;
  const chrome = 3 + inputRows + footerRows; // header+meta+div + input area + status
  const bodyRows = Math.max(3, rows - chrome);
  const contentWidth = cols - 1;
  const allLines = buildChatLines(state, contentWidth);

  let start: number;
  if (state.scrollOffset <= 0) {
    start = Math.max(0, allLines.length - bodyRows);
  } else {
    const maxOff = Math.max(0, allLines.length - bodyRows);
    const off = Math.min(state.scrollOffset, maxOff);
    start = Math.max(0, allLines.length - bodyRows - off);
  }
  const visible = allLines.slice(start, start + bodyRows);
  while (visible.length < bodyRows) visible.push('');

  for (const line of visible) {
    out.push(fit(line, cols, 'right'));
  }

  // Input box
  out.push(c.gray + BOX.l + BOX.h.repeat(Math.max(0, cols - 2)) + BOX.r + c.reset);

  const editor = state.editor;
  const promptPlain = state.isStreaming ? '  … ' : `  ${icons.user} `;
  const avail = Math.max(8, cols - promptPlain.length - 1);
  const cursor = editor.cursor;
  let hScroll = 0;
  if (cursor > avail - 1) hScroll = cursor - (avail - 1);
  if (hScroll > 0 && editor.value.length - hScroll < avail) {
    hScroll = Math.max(0, editor.value.length - avail);
  }
  const shown = editor.value.slice(hScroll, hScroll + avail);
  const cursorInShown = Math.max(0, Math.min(shown.length, cursor - hScroll));
  const before = shown.slice(0, cursorInShown);
  const after = shown.slice(cursorInShown);
  const caretChar = after[0] || ' ';
  const rest = after.slice(1);
  const inputVisual =
    c.bgInput +
    (state.isStreaming ? c.brightYellow : c.brightCyan) +
    promptPlain +
    c.reset +
    c.bgInput +
    c.brightWhite +
    before +
    c.inverse +
    caretChar +
    c.reset +
    c.bgInput +
    c.brightWhite +
    rest +
    c.reset +
    c.bgInput +
    ' '.repeat(Math.max(0, avail - shown.length - (after[0] ? 0 : 1) + (after[0] ? 0 : 0))) +
    c.reset;

  out.push(fit(inputVisual, cols, 'right'));

  // Status footer
  const elapsed = formatElapsed(Date.now() - state.startedAt);
  const scrollHint =
    state.scrollOffset > 0 ? c.yellow + ` scroll↑${state.scrollOffset}` + c.reset + c.bgStatus : '';
  const footerLeft =
    c.dim +
    '/help · /clear · /quit' +
    c.reset +
    c.bgStatus +
    (scrollHint ? '  ' + scrollHint + c.bgStatus : '');
  const footerRight =
    c.dim +
    elapsed +
    (state.isStreaming ? ' · live' : '') +
    c.reset +
    c.bgStatus;
  out.push(bar(cols, footerLeft, footerRight, c.bgStatus));

  // Paint: home + clear-down each frame (flicker-light on modern terminals)
  const frame = '\x1b[H\x1b[J' + out.join('\n');
  process.stdout.write(frame);
}

export function enterAltScreen(): void {
  // Alternate buffer, hide cursor initially managed per-frame, enable mouse? no
  process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[H\x1b[J');
}

export function leaveAltScreen(): void {
  process.stdout.write('\x1b[?25h\x1b[?1049l');
}

export function enableWindowsVt(): void {
  // Best-effort: Node 22+ on Windows usually has VT enabled for conhost/Windows Terminal
  try {
    if (process.platform === 'win32' && process.stdout.isTTY) {
      // no-op placeholder — Node enables VT when isTTY in recent versions
    }
  } catch {
    /* ignore */
  }
}
