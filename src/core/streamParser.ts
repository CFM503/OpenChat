// ============================================================================
// Stream Parser — Extracts <thinking> blocks from streamed LLM output
// ============================================================================

import type { StreamParserState, ParsedStreamChunk } from './types';

/**
 * Creates a fresh parser state.
 */
export function createParserState(): StreamParserState {
  return {
    buffer: '',
    insideThinking: false,
    thinkingBuffer: '',
    contentBuffer: '',
  };
}

/**
 * Feeds a chunk of text into the parser and returns parsed segments.
 *
 * The parser handles:
 *  - Complete <thinking>...</thinking> blocks within a single chunk
 *  - Partial tags split across multiple chunks
 *  - Nested content within thinking blocks
 *  - Plain text with no thinking tags at all
 */
export function feedChunk(
  state: StreamParserState,
  chunk: string
): { state: StreamParserState; chunks: ParsedStreamChunk[] } {
  const results: ParsedStreamChunk[] = [];
  state.buffer += chunk;

  let safety = 0;
  const maxIterations = state.buffer.length + 10;

  while (state.buffer.length > 0 && safety < maxIterations) {
    safety++;

    if (state.insideThinking) {
      // Look for closing </thinking> tag
      const closeIdx = state.buffer.indexOf('</thinking>');
      if (closeIdx !== -1) {
        // Found the closing tag — emit thinking chunk
        state.thinkingBuffer += state.buffer.slice(0, closeIdx);
        results.push({ type: 'thinking', text: state.thinkingBuffer });
        state.thinkingBuffer = '';
        state.insideThinking = false;
        state.buffer = state.buffer.slice(closeIdx + '</thinking>'.length);
      } else {
        // Closing tag not found yet — check for partial tag at end
        const partialCloseMatch = findPartialTag(state.buffer, '</thinking>');
        if (partialCloseMatch > 0) {
          // Buffer up to the partial tag match
          const safeEnd = state.buffer.length - partialCloseMatch;
          if (safeEnd > 0) {
            state.thinkingBuffer += state.buffer.slice(0, safeEnd);
          }
          state.buffer = state.buffer.slice(safeEnd);
        } else {
          // No partial match — all content is thinking
          state.thinkingBuffer += state.buffer;
          state.buffer = '';
        }
        break;
      }
    } else {
      // Look for opening <thinking> tag
      const openIdx = state.buffer.indexOf('<thinking>');
      if (openIdx !== -1) {
        // Emit any content before the tag
        if (openIdx > 0) {
          const contentBefore = state.buffer.slice(0, openIdx);
          if (contentBefore.length > 0) {
            results.push({ type: 'content', text: contentBefore });
          }
        }
        state.insideThinking = true;
        state.buffer = state.buffer.slice(openIdx + '<thinking>'.length);
      } else {
        // No opening tag found — check for partial tag at end
        const partialOpenMatch = findPartialTag(state.buffer, '<thinking>');
        if (partialOpenMatch > 0) {
          const safeEnd = state.buffer.length - partialOpenMatch;
          if (safeEnd > 0) {
            results.push({ type: 'content', text: state.buffer.slice(0, safeEnd) });
          }
          state.buffer = state.buffer.slice(safeEnd);
          break;
        } else {
          // No match at all — emit everything as content
          if (state.buffer.length > 0) {
            results.push({ type: 'content', text: state.buffer });
          }
          state.buffer = '';
          break;
        }
      }
    }
  }

  return { state, chunks: results };
}

/**
 * Finalizes the parser, flushing any remaining buffered content.
 */
export function finalize(
  state: StreamParserState
): ParsedStreamChunk[] {
  const results: ParsedStreamChunk[] = [];

  if (state.insideThinking && state.thinkingBuffer.length > 0) {
    // Unclosed thinking block — emit what we have
    results.push({ type: 'thinking', text: state.thinkingBuffer });
  }

  if (state.buffer.length > 0) {
    if (state.insideThinking) {
      results.push({ type: 'thinking', text: state.buffer });
    } else {
      results.push({ type: 'content', text: state.buffer });
    }
  }

  return results;
}

/**
 * Parses a complete string (non-streaming) into thinking and content segments.
 */
export function parseComplete(text: string): ParsedStreamChunk[] {
  let state = createParserState();
  const { chunks } = feedChunk(state, text);
  const finalChunks = finalize(state);
  return [...chunks, ...finalChunks];
}

/**
 * Checks if the end of `buffer` contains a partial prefix of `tag`.
 * Returns the length of the matching suffix, or 0 if no partial match.
 */
function findPartialTag(buffer: string, tag: string): number {
  // Check if the tail of the buffer matches a prefix of the tag
  const maxCheck = Math.min(buffer.length, tag.length - 1);
  for (let len = maxCheck; len >= 1; len--) {
    const bufferTail = buffer.slice(buffer.length - len);
    const tagPrefix = tag.slice(0, len);
    if (bufferTail === tagPrefix) {
      return len;
    }
  }
  return 0;
}
