// ============================================================================
// Simulated streaming API for demo mode (no real backend required)
// ============================================================================

import type { ChatMessage } from './types';

/**
 * Demo responses with embedded <thinking> tags for testing the stream parser.
 */
const DEMO_RESPONSES: string[] = [
  `<thinking>
The user is asking me to help with their code. Let me analyze the requirements first.

I need to:
1. Parse the input and understand what they're building
2. Consider best practices for React component design
3. Suggest an optimal architecture

The key consideration here is performance — we should use React.memo for the list items and virtualize the list if it grows large.
</thinking>

Here's a clean implementation of a task management component:

\`\`\`typescript
import React, { useState, useCallback } from 'react';

interface Task {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'done';
}

export function TaskBoard() {
  const [tasks, setTasks] = useState<Task[]>([]);

  const addTask = useCallback((title: string) => {
    setTasks(prev => [...prev, {
      id: crypto.randomUUID(),
      title,
      status: 'pending'
    }]);
  }, []);

  return (
    <div className="task-board">
      {tasks.map(task => (
        <TaskCard key={task.id} task={task} />
      ))}
    </div>
  );
}
\`\`\`

This uses \`useCallback\` to prevent unnecessary re-renders and \`crypto.randomUUID()\` for generating unique IDs.`,

  `<thinking>
Let me think about the best way to set up an API route for this.

The user wants to connect to an LLM API. I should consider:
- Error handling for network failures
- Rate limiting
- Streaming response support
- Token counting for cost tracking

I'll use the Fetch API with ReadableStream for streaming.
</thinking>

To set up your model connection, you'll need to configure the endpoint in the Model Settings panel. Here's how:

1. **OpenAI**: Enter your API key and select the model (e.g., \`gpt-4o\`)
2. **Ollama**: Make sure Ollama is running locally on port 11434
3. **Custom**: Use any OpenAI-compatible endpoint

The system will automatically detect the provider format and route accordingly.

\`\`\`bash
# For Ollama, start the server first:
ollama serve

# Then pull your model:
ollama pull llama3
\`\`\``,

  `<thinking>
This is a straightforward request. The user wants to understand the task state machine.

The state transitions are:
- PENDING → START → RUNNING
- RUNNING → COMPLETE → SUCCESS
- RUNNING → FAIL → FAILED
- FAILED → RETRY → PENDING

I should explain this clearly with a diagram.
</thinking>

The Agent Task State Machine follows a deterministic finite automaton (DFA) pattern:

\`\`\`
┌─────────┐  START   ┌─────────┐  COMPLETE  ┌─────────┐
│ PENDING  │────────▶│ RUNNING  │───────────▶│ SUCCESS  │
└─────────┘         └─────────┘            └─────────┘
     ▲                    │
     │  RETRY             │ FAIL
     │                    ▼
     │              ┌─────────┐
     └──────────────│ FAILED   │
                    └─────────┘
\`\`\`

Each transition is validated before execution. Invalid transitions (like trying to \`COMPLETE\` a \`PENDING\` task) will throw a \`TaskTransitionError\`.`,
];

/**
 * Simulates streaming a response character by character with realistic delays.
 */
export async function simulateStream(
  _messages: ChatMessage[],
  onChunk: (chunk: string) => void,
  onDone: () => void,
  options?: { speed?: number }
): Promise<void> {
  const speed = options?.speed ?? 8;
  const responseIndex = Math.floor(Math.random() * DEMO_RESPONSES.length);
  const fullText = DEMO_RESPONSES[responseIndex];

  // Stream in variable-sized chunks to simulate realistic network behavior
  let i = 0;
  while (i < fullText.length) {
    // Random chunk size between 1 and 8 characters
    const chunkSize = Math.floor(Math.random() * 8) + 1;
    const chunk = fullText.slice(i, i + chunkSize);
    onChunk(chunk);
    i += chunkSize;

    // Variable delay to simulate network latency
    const baseDelay = 1000 / speed;
    const jitter = Math.random() * baseDelay * 0.5;
    await new Promise(resolve => setTimeout(resolve, baseDelay + jitter));
  }

  onDone();
}

/**
 * Simulates a non-streaming (complete) response.
 */
export function simulateCompleteResponse(_messages: ChatMessage[]): string {
  const responseIndex = Math.floor(Math.random() * DEMO_RESPONSES.length);
  return DEMO_RESPONSES[responseIndex];
}
