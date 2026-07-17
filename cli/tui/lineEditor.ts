/**
 * Minimal raw-mode line editor with history, cursor, and multi-byte-safe paste.
 */

export type KeyAction =
  | { type: 'submit'; value: string }
  | { type: 'abort' }
  | { type: 'quit' }
  | { type: 'clear' }
  | { type: 'interrupt' }
  | { type: 'scroll'; dir: 'up' | 'down' | 'pageup' | 'pagedown' | 'home' | 'end' }
  | { type: 'change' }
  | { type: 'help' }
  | { type: 'none' };

export class LineEditor {
  value = '';
  cursor = 0;
  history: string[] = [];
  private historyIndex = -1;
  private draft = '';
  private buf = '';

  get left(): string {
    return this.value.slice(0, this.cursor);
  }

  get right(): string {
    return this.value.slice(this.cursor);
  }

  reset(value = ''): void {
    this.value = value;
    this.cursor = value.length;
    this.historyIndex = -1;
    this.draft = '';
  }

  pushHistory(line: string): void {
    const t = line.trim();
    if (!t) return;
    if (this.history[this.history.length - 1] !== t) {
      this.history.push(t);
      if (this.history.length > 200) this.history.shift();
    }
    this.historyIndex = -1;
    this.draft = '';
  }

  handle(data: Buffer | string): KeyAction {
    const s = typeof data === 'string' ? data : data.toString('utf8');
    this.buf += s;

    // Process complete sequences
    while (this.buf.length > 0) {
      const ch = this.buf[0];

      // ESC sequences
      if (ch === '\x1b') {
        // Incomplete sequence — wait for more
        if (this.buf.length === 1) return { type: 'none' };
        // CSI
        if (this.buf[1] === '[') {
          const m = this.buf.match(/^\x1b\[([0-9;]*)([A-Za-z~])/);
          if (!m) {
            if (this.buf.length < 8) return { type: 'none' };
            // Drop garbage
            this.buf = this.buf.slice(1);
            continue;
          }
          this.buf = this.buf.slice(m[0].length);
          const params = m[1];
          const code = m[2];
          const action = this.handleCsi(params, code);
          if (action.type !== 'none' && action.type !== 'change') return action;
          continue;
        }
        // Alt+key or lone ESC
        if (this.buf.length >= 2) {
          const k = this.buf[1];
          this.buf = this.buf.slice(2);
          if (k === 'b') {
            this.wordLeft();
            return { type: 'change' };
          }
          if (k === 'f') {
            this.wordRight();
            return { type: 'change' };
          }
          // ESC alone → abort stream
          return { type: 'abort' };
        }
        return { type: 'none' };
      }

      // Ctrl keys
      if (ch < ' ' || ch === '\x7f') {
        this.buf = this.buf.slice(1);
        const action = this.handleControl(ch);
        if (action.type !== 'none' && action.type !== 'change') return action;
        continue;
      }

      // Printable / unicode run
      let i = 0;
      while (i < this.buf.length) {
        const code = this.buf.charCodeAt(i);
        if (code < 32 || code === 0x7f) break;
        // Keep combining with multi-byte utf8 already decoded by node as string
        i++;
      }
      if (i === 0) {
        this.buf = this.buf.slice(1);
        continue;
      }
      const insert = this.buf.slice(0, i);
      this.buf = this.buf.slice(i);
      this.insert(insert);
      return { type: 'change' };
    }

    return { type: 'none' };
  }

  private handleControl(ch: string): KeyAction {
    switch (ch) {
      case '\r':
      case '\n': {
        const v = this.value;
        this.pushHistory(v);
        this.reset('');
        return { type: 'submit', value: v };
      }
      case '\x03': // Ctrl+C
        if (this.value) {
          this.reset('');
          return { type: 'change' };
        }
        return { type: 'interrupt' };
      case '\x04': // Ctrl+D
        if (!this.value) return { type: 'quit' };
        // delete forward
        if (this.cursor < this.value.length) {
          this.value = this.value.slice(0, this.cursor) + this.value.slice(this.cursor + 1);
          return { type: 'change' };
        }
        return { type: 'none' };
      case '\x01': // Ctrl+A home
        this.cursor = 0;
        return { type: 'change' };
      case '\x05': // Ctrl+E end
        this.cursor = this.value.length;
        return { type: 'change' };
      case '\x0b': // Ctrl+K kill to end
        this.value = this.value.slice(0, this.cursor);
        return { type: 'change' };
      case '\x15': // Ctrl+U clear line
        this.reset('');
        return { type: 'change' };
      case '\x0c': // Ctrl+L clear screen / redraw
        return { type: 'clear' };
      case '\x7f': // Backspace
      case '\b':
        if (this.cursor > 0) {
          this.value = this.value.slice(0, this.cursor - 1) + this.value.slice(this.cursor);
          this.cursor--;
          return { type: 'change' };
        }
        return { type: 'none' };
      case '\t':
        return { type: 'help' };
      default:
        return { type: 'none' };
    }
  }

  private handleCsi(params: string, code: string): KeyAction {
    switch (code) {
      case 'A': // up
        this.hist(-1);
        return { type: 'change' };
      case 'B': // down
        this.hist(1);
        return { type: 'change' };
      case 'C': // right
        if (this.cursor < this.value.length) this.cursor++;
        return { type: 'change' };
      case 'D': // left
        if (this.cursor > 0) this.cursor--;
        return { type: 'change' };
      case 'H':
        this.cursor = 0;
        return { type: 'change' };
      case 'F':
        this.cursor = this.value.length;
        return { type: 'change' };
      case '~': {
        // 3~ delete, 5~ pageup, 6~ pagedown, 1~ home, 4~ end
        if (params === '3') {
          if (this.cursor < this.value.length) {
            this.value = this.value.slice(0, this.cursor) + this.value.slice(this.cursor + 1);
            return { type: 'change' };
          }
        }
        if (params === '5') return { type: 'scroll', dir: 'pageup' };
        if (params === '6') return { type: 'scroll', dir: 'pagedown' };
        if (params === '1') {
          this.cursor = 0;
          return { type: 'change' };
        }
        if (params === '4') {
          this.cursor = this.value.length;
          return { type: 'change' };
        }
        return { type: 'none' };
      }
      default:
        return { type: 'none' };
    }
  }

  private hist(dir: -1 | 1): void {
    if (this.history.length === 0) return;
    if (this.historyIndex === -1) {
      this.draft = this.value;
      this.historyIndex = this.history.length;
    }
    const next = this.historyIndex + dir;
    if (next < 0) return;
    if (next >= this.history.length) {
      this.historyIndex = -1;
      this.value = this.draft;
      this.cursor = this.value.length;
      return;
    }
    this.historyIndex = next;
    this.value = this.history[next];
    this.cursor = this.value.length;
  }

  private insert(text: string): void {
    // Normalize newlines in paste to spaces for single-line input
    const clean = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, ' ');
    this.value = this.value.slice(0, this.cursor) + clean + this.value.slice(this.cursor);
    this.cursor += clean.length;
  }

  private wordLeft(): void {
    let i = this.cursor;
    while (i > 0 && this.value[i - 1] === ' ') i--;
    while (i > 0 && this.value[i - 1] !== ' ') i--;
    this.cursor = i;
  }

  private wordRight(): void {
    let i = this.cursor;
    while (i < this.value.length && this.value[i] === ' ') i++;
    while (i < this.value.length && this.value[i] !== ' ') i++;
    this.cursor = i;
  }
}
