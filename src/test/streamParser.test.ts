// ============================================================================
// Test Suite A: Stream Parser — <thinking> Tag Extraction
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  createParserState,
  feedChunk,
  finalize,
  parseComplete,
} from '../core/streamParser';

describe('StreamParser', () => {
  // ── Basic Parsing ──────────────────────────────────────────────────────

  describe('parseComplete (non-streaming)', () => {
    it('should parse plain text without thinking tags', () => {
      const result = parseComplete('Hello, this is a normal response.');
      expect(result).toEqual([
        { type: 'content', text: 'Hello, this is a normal response.' },
      ]);
    });

    it('should extract a single thinking block and separate content', () => {
      const input = '<thinking>I need to analyze this.</thinking>Here is my answer.';
      const result = parseComplete(input);
      expect(result).toEqual([
        { type: 'thinking', text: 'I need to analyze this.' },
        { type: 'content', text: 'Here is my answer.' },
      ]);
    });

    it('should handle thinking block at the end', () => {
      const input = 'Some content first.<thinking>Some thoughts.</thinking>';
      const result = parseComplete(input);
      expect(result).toEqual([
        { type: 'content', text: 'Some content first.' },
        { type: 'thinking', text: 'Some thoughts.' },
      ]);
    });

    it('should handle multiple thinking blocks', () => {
      const input =
        '<thinking>Step 1</thinking>Content A<thinking>Step 2</thinking>Content B';
      const result = parseComplete(input);
      expect(result).toEqual([
        { type: 'thinking', text: 'Step 1' },
        { type: 'content', text: 'Content A' },
        { type: 'thinking', text: 'Step 2' },
        { type: 'content', text: 'Content B' },
      ]);
    });

    it('should handle empty input', () => {
      const result = parseComplete('');
      expect(result).toEqual([]);
    });

    it('should handle thinking block with newlines', () => {
      const input = '<thinking>\nLine 1\nLine 2\n</thinking>Response.';
      const result = parseComplete(input);
      expect(result).toEqual([
        { type: 'thinking', text: '\nLine 1\nLine 2\n' },
        { type: 'content', text: 'Response.' },
      ]);
    });
  });

  // ── Streaming Parsing ──────────────────────────────────────────────────

  describe('feedChunk (streaming)', () => {
    it('should correctly reassemble thinking tags split across chunks', () => {
      let state = createParserState();
      const allChunks: { type: string; text: string }[] = [];

      // Feed "<thin" first
      const r1 = feedChunk(state, '<thin');
      state = r1.state;
      allChunks.push(...r1.chunks);

      // Feed "king>I am thinking</thi"
      const r2 = feedChunk(state, 'king>I am thinking</thi');
      state = r2.state;
      allChunks.push(...r2.chunks);

      // Feed "nking>Result"
      const r3 = feedChunk(state, 'nking>Result');
      state = r3.state;
      allChunks.push(...r3.chunks);

      // Finalize
      const remaining = finalize(state);
      allChunks.push(...remaining);

      // Merge chunks by type
      const thinking = allChunks
        .filter(c => c.type === 'thinking')
        .map(c => c.text)
        .join('');
      const content = allChunks
        .filter(c => c.type === 'content')
        .map(c => c.text)
        .join('');

      expect(thinking).toBe('I am thinking');
      expect(content).toBe('Result');
    });

    it('should handle character-by-character streaming', () => {
      const input = '<thinking>AB</thinking>CD';
      let state = createParserState();
      const allChunks: { type: string; text: string }[] = [];

      // Feed one character at a time
      for (const char of input) {
        const result = feedChunk(state, char);
        state = result.state;
        allChunks.push(...result.chunks);
      }

      const remaining = finalize(state);
      allChunks.push(...remaining);

      const thinking = allChunks
        .filter(c => c.type === 'thinking')
        .map(c => c.text)
        .join('');
      const content = allChunks
        .filter(c => c.type === 'content')
        .map(c => c.text)
        .join('');

      expect(thinking).toBe('AB');
      expect(content).toBe('CD');
    });

    it('should handle large realistic streaming response', () => {
      const fullResponse = `<thinking>
The user is asking about React hooks.
Let me think about the best practices:
1. useState for local state
2. useEffect for side effects
3. useCallback for memoized callbacks
</thinking>

Here are the key React hooks you should know:

\`\`\`typescript
const [state, setState] = useState(initial);
useEffect(() => { /* effect */ }, [deps]);
\`\`\``;

      // Simulate streaming in random-sized chunks
      let state = createParserState();
      const allChunks: { type: string; text: string }[] = [];
      let i = 0;

      while (i < fullResponse.length) {
        const chunkSize = Math.min(
          Math.floor(Math.random() * 10) + 1,
          fullResponse.length - i
        );
        const chunk = fullResponse.slice(i, i + chunkSize);
        const result = feedChunk(state, chunk);
        state = result.state;
        allChunks.push(...result.chunks);
        i += chunkSize;
      }

      const remaining = finalize(state);
      allChunks.push(...remaining);

      const thinking = allChunks
        .filter(c => c.type === 'thinking')
        .map(c => c.text)
        .join('');
      const content = allChunks
        .filter(c => c.type === 'content')
        .map(c => c.text)
        .join('');

      expect(thinking).toContain('React hooks');
      expect(thinking).toContain('useState for local state');
      expect(content).toContain('React hooks you should know');
      expect(content).toContain('useState(initial)');
    });

    it('should handle unclosed thinking tag gracefully', () => {
      let state = createParserState();
      const allChunks: { type: string; text: string }[] = [];

      const result = feedChunk(state, '<thinking>Partial thought...');
      state = result.state;
      allChunks.push(...result.chunks);

      const remaining = finalize(state);
      allChunks.push(...remaining);

      const thinking = allChunks
        .filter(c => c.type === 'thinking')
        .map(c => c.text)
        .join('');

      expect(thinking).toContain('Partial thought...');
    });

    it('should not confuse angle brackets in normal content with tags', () => {
      const input = 'Use array.filter(x => x > 0) for positive numbers.';
      let state = createParserState();

      const result = feedChunk(state, input);
      state = result.state;
      const remaining = finalize(state);
      const allChunks = [...result.chunks, ...remaining];

      const content = allChunks
        .filter(c => c.type === 'content')
        .map(c => c.text)
        .join('');

      expect(content).toContain('array.filter');
      expect(content).toContain('> 0');
    });
  });
});
