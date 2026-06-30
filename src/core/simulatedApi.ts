// ============================================================================
// Simulated streaming API for demo mode (no real backend required)
// ============================================================================

import type { ChatMessage } from './types';

/**
 * Demo responses with embedded <thinking> tags for testing the stream parser.
 */
const DEMO_RESPONSES: string[] = [
  `<thinking>Analyzing the request... I need to consider best practices for React component design and performance.</thinking>

Here's a clean implementation using \`useCallback\` to prevent unnecessary re-renders:

\`\`\`typescript
import React, { useState, useCallback } from 'react';

export function TaskBoard() {
  const [tasks, setTasks] = useState([]);
  const addTask = useCallback((title) => {
    setTasks(prev => [...prev, { id: crypto.randomUUID(), title }]);
  }, []);
  return <div className="task-board">{tasks.map(t => <TaskCard key={t.id} task={t} />)}</div>;
}
\`\`\``,

  `<thinking>Setting up an LLM API connection requires considering error handling, rate limiting, and streaming support.</thinking>

Configure your model connection in the Model Settings panel:

1. **OpenAI**: Enter API key and select model (e.g., \`gpt-4o\`)
2. **Ollama**: Ensure Ollama runs on localhost:11434
3. **Custom**: Use any OpenAI-compatible endpoint

\`\`\`bash
ollama serve
ollama pull llama3
\`\`\``,

  `<thinking>The state machine follows a DFA pattern with deterministic transitions.</thinking>

Agent Task State Machine transitions:

- PENDING → START → RUNNING → COMPLETE → SUCCESS
- RUNNING → FAIL → FAILED → RETRY → PENDING

Invalid transitions throw \`TaskTransitionError\`.
`,
];

/**
 * Simulates streaming a response character by character with realistic delays.
 */
export async function simulateStream(
  _messages: ChatMessage[],
  onChunk: (chunk: string) => void,
  onDone: () => void,
  options?: { speed?: number; signal?: AbortSignal }
): Promise<void> {
  const speed = options?.speed ?? 8;
  const responseIndex = Math.floor(Math.random() * DEMO_RESPONSES.length);
  const fullText = DEMO_RESPONSES[responseIndex];

  // Stream in variable-sized chunks to simulate realistic network behavior
  let i = 0;
  while (i < fullText.length) {
    // Check abort signal
    if (options?.signal?.aborted) {
      return;
    }

    const chunkSize = Math.floor(Math.random() * 8) + 1;
    const chunk = fullText.slice(i, i + chunkSize);
    onChunk(chunk);
    i += chunkSize;

    // Variable delay to simulate network latency
    const baseDelay = 1000 / speed;
    const jitter = Math.random() * baseDelay * 0.5;
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, baseDelay + jitter);
      options?.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }

  if (!options?.signal?.aborted) {
    onDone();
  }
}
