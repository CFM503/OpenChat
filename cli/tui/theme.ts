/** ANSI theme helpers for OpenChat TUI */

export const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  inverse: '\x1b[7m',

  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',

  bgBlack: '\x1b[40m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgGray: '\x1b[100m',
  bgDark: '\x1b[48;5;236m',
  bgHeader: '\x1b[48;5;234m',
  bgInput: '\x1b[48;5;235m',
  bgStatus: '\x1b[48;5;233m',
} as const;

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

export function visibleLen(s: string): number {
  return stripAnsi(s).length;
}

/** Pad / truncate to exact visible width */
export function fit(s: string, width: number, pad: 'left' | 'right' | 'none' = 'right'): string {
  const plain = stripAnsi(s);
  if (plain.length === width) return s;
  if (plain.length > width) {
    // Truncate carefully (drop trailing ANSI-less chars)
    let out = '';
    let n = 0;
    let i = 0;
    while (i < s.length && n < width - 1) {
      if (s[i] === '\x1b') {
        const m = s.slice(i).match(/^\x1b\[[0-9;]*m/);
        if (m) {
          out += m[0];
          i += m[0].length;
          continue;
        }
      }
      out += s[i];
      n++;
      i++;
    }
    return out + '…' + c.reset;
  }
  const padN = width - plain.length;
  if (pad === 'none') return s;
  if (pad === 'left') return ' '.repeat(padN) + s;
  return s + ' '.repeat(padN);
}

export function wrap(text: string, width: number): string[] {
  if (width <= 1) return [text];
  const lines: string[] = [];
  const paragraphs = text.split('\n');
  for (const para of paragraphs) {
    if (para.length === 0) {
      lines.push('');
      continue;
    }
    let rest = para;
    while (rest.length > width) {
      let breakAt = rest.lastIndexOf(' ', width);
      if (breakAt < width * 0.5) breakAt = width;
      lines.push(rest.slice(0, breakAt));
      rest = rest.slice(breakAt).replace(/^\s+/, '');
    }
    lines.push(rest);
  }
  return lines;
}

export const icons = {
  user: '❯',
  assistant: '◆',
  system: '●',
  tool: '⚙',
  ok: '✓',
  fail: '✗',
  think: '⋯',
  progress: '▸',
  spark: '✧',
  bolt: '⚡',
} as const;
