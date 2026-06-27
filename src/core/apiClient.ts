// ============================================================================
// Real API Client — Handles actual streaming calls to OpenAI / Ollama / Custom
// ============================================================================

import type { ChatMessage, ModelConfig } from './types';
import { ModelRouter } from './modelRouter';

/**
 * Determines if a model config has valid credentials to make real API calls.
 * Allows requests without API key (LM Studio, local proxies, etc.).
 */
export function canMakeRealRequest(config: ModelConfig | undefined): boolean {
  if (!config) return false;
  if (config.provider === 'ollama') return true;
  return !!(config.endpoint && config.endpoint.trim().length > 0);
}

/**
 * Streams a real response from an LLM API.
 *
 * Supports:
 *  - OpenAI-compatible SSE streaming (data: {...}\n\n format)
 *  - Ollama streaming (newline-delimited JSON)
 *  - Custom endpoints (assumes OpenAI-compatible SSE)
 *
 * @param router       ModelRouter instance
 * @param modelId      Active model ID
 * @param messages     Conversation history
 * @param onChunk      Callback invoked with each text chunk
 * @param onDone       Callback invoked when the stream is finished
 * @param onError      Callback invoked on error
 * @param abortSignal  Optional AbortSignal for cancellation
 */
export async function streamRealResponse(
  router: ModelRouter,
  modelId: string,
  messages: ChatMessage[],
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (error: Error) => void,
  abortSignal?: AbortSignal
): Promise<void> {
  const config = router.getModel(modelId);
  if (!config) {
    onError(new Error(`Model "${modelId}" not found in router.`));
    return;
  }

  const req = router.buildRequest(modelId, messages, true);
  if (!req) {
    onError(new Error(`Failed to build request for model "${modelId}".`));
    return;
  }

  // Attach abort signal if provided
  const fetchInit: RequestInit = {
    ...req.init,
    signal: abortSignal,
  };

  try {
    const response = await fetch(req.url, fetchInit);

    if (!response.ok) {
      const errorBody = await response.text();
      onError(new Error(`API Error (${response.status}): ${errorBody}`));
      return;
    }

    if (!response.body) {
      // Non-streaming fallback: read entire body
      const text = await response.text();
      onChunk(text);
      onDone();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');

    if (config.provider === 'ollama') {
      await readOllamaStream(reader, decoder, onChunk, onDone, onError);
    } else {
      // OpenAI-compatible SSE format (also used by custom providers)
      await readOpenAIStream(reader, decoder, onChunk, onDone, onError);
    }
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      // User cancelled the stream — not an error
      onDone();
      return;
    }
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}

// ─── OpenAI SSE Stream Reader ──────────────────────────────────────────────

async function readOpenAIStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (error: Error) => void
): Promise<void> {
  let buffer = '';
  let doneCalled = false;  // H-8: Guard against double onDone
  const safeDone = () => { if (!doneCalled) { doneCalled = true; onDone(); } };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE protocol: lines are separated by \n\n
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed === '') continue;
        if (trimmed === 'data: [DONE]') {
          safeDone();
          return;
        }

        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6);
          try {
            const parsed = JSON.parse(jsonStr);
            // OpenAI chat completion chunk format
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.content) {
              onChunk(delta.content);
            }
            // Some models send reasoning/thinking in a separate field
            if (delta?.reasoning_content) {
              onChunk(`<thinking>${delta.reasoning_content}</thinking>`);
            }
          } catch {
            // Skip malformed JSON lines (can happen with partial chunks)
          }
        }
      }
    }

    safeDone();
  } catch (err: unknown) {
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}

// ─── Ollama Newline-Delimited JSON Stream Reader ───────────────────────────

async function readOllamaStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (error: Error) => void
): Promise<void> {
  let buffer = '';
  let doneCalled = false;  // H-8: Guard against double onDone
  const safeDone = () => { if (!doneCalled) { doneCalled = true; onDone(); } };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Ollama sends newline-delimited JSON objects
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '') continue;

        try {
          const parsed = JSON.parse(trimmed);
          // Ollama chat response format
          if (parsed.message?.content) {
            onChunk(parsed.message.content);
          }
          // Check if stream is done
          if (parsed.done === true) {
            safeDone();
            return;
          }
        } catch {
          // Skip malformed lines
        }
      }
    }

    safeDone();
  } catch (err: unknown) {
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}
