// ============================================================================
// AgentLoop — LLM ↔ Tool interaction loop
// Sends messages + tool definitions to LLM, executes tool calls, repeats
// ============================================================================

import crypto from 'crypto';
import { ProviderGateway } from './providerGateway.js';
import { ToolRegistry } from './tools/registry.js';
import type { ToolContext } from './tools/types.js';
import type { ServerMessage, ChatMessage, ToolCallResult } from './types.js';

export interface AgentLoopParams {
  messages: ChatMessage[];
  modelId?: string;
  signal?: AbortSignal;
  onEvent: (event: ServerMessage) => void;
}

export class AgentLoop {
  constructor(
    private providers: ProviderGateway,
    private tools: ToolRegistry,
    private workingDirectory: string,
  ) {}

  /**
   * Run the agent loop:
   * 1. Send messages + tool defs to LLM
   * 2. Collect content + tool_calls from streamed response
   * 3. If tool_calls present: execute each, append results, go to step 1
   * 4. If no tool_calls: done
   *
   * Max 10 rounds to prevent infinite loops.
   */
  async run(params: AgentLoopParams): Promise<void> {
    const { messages, modelId, signal, onEvent } = params;

    // Check if tools are disabled for this model
    const model = this.providers.getActiveModel(modelId);
    const toolsDisabled = model?.disableTools === true;
    const toolDefs = toolsDisabled ? [] : this.tools.toFunctionDefinitions();

    // Build the messages array for the LLM (convert from our format)
    // Always convert images to text descriptions — the LLM provider may not support
    // multimodal image_url blocks. If the model supports vision, the text description
    // serves as metadata; if not, it's the only representation.
    let llmMessages: Record<string, any>[] = messages
      .filter(m => m.role !== 'tool')
      .map(m => {
        const images = m.attachments?.filter(a => a.type.startsWith('image/')) ?? [];
        const textAttachments = m.attachments?.filter(a => !a.type.startsWith('image/')) ?? [];

        if (m.attachments?.length) {
          console.log(`[agentLoop] Message ${m.id} has ${m.attachments.length} attachment(s): ${m.attachments.map(a => `${a.name} (${a.type}, ${a.size}B)`).join(', ')}`);
        }

        // Always use plain text format — safe for all providers
        let content: string = m.content;

        // Build content array for multimodal support
        const textParts: string[] = [content];

        // Append text file contents
        for (const ta of textAttachments) {
          textParts.push(`\n\n[Attached file: ${ta.name}]\n${ta.content}`);
        }

        // If images exist, use multimodal content array (OpenAI vision format)
        if (images.length > 0) {
          const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
            { type: 'text', text: textParts.join('') },
          ];
          for (const img of images) {
            parts.push({
              type: 'image_url',
              image_url: { url: img.content },
            });
          }
          return {
            role: m.role,
            content: parts,
            ...(m.toolCalls?.length && { tool_calls: m.toolCalls.map(tc => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: tc.arguments },
            }))}),
          };
        }

        return {
          role: m.role,
          content: textParts.join(''),
          ...(m.toolCalls?.length && { tool_calls: m.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments },
          }))}),
        };
      });

    // Sanitize messages: remove empty messages, ensure role alternation
    llmMessages = llmMessages.filter(m => {
      // Keep tool messages
      if (m.role === 'tool') return true;
      // Keep assistant messages with tool_calls
      if (m.role === 'assistant' && m.tool_calls?.length > 0) return true;
      // Remove empty content messages
      if (!m.content || (typeof m.content === 'string' && m.content.trim() === '')) return false;
      return true;
    });

    // Ensure strict role alternation: merge consecutive same-role messages
    const sanitized: Record<string, any>[] = [];
    for (const msg of llmMessages) {
      if (msg.role === 'tool') {
        sanitized.push(msg);
        continue;
      }
      const last = sanitized[sanitized.length - 1];
      if (last && last.role === msg.role && last.role !== 'tool') {
        // Merge consecutive same-role messages
        if (typeof last.content === 'string' && typeof msg.content === 'string') {
          last.content += '\n\n' + msg.content;
        }
      } else {
        sanitized.push({ ...msg });
      }
    }
    llmMessages = sanitized;

    // Ensure first message is from user
    if (llmMessages.length > 0 && llmMessages[0].role === 'assistant') {
      llmMessages.unshift({ role: 'user', content: 'Continue.' });
    }

    // Limit history to prevent context overflow on small models
    const MAX_HISTORY_MESSAGES = 20;
    if (llmMessages.length > MAX_HISTORY_MESSAGES) {
      llmMessages = llmMessages.slice(-MAX_HISTORY_MESSAGES);
      // Ensure first message is still from user after truncation
      if (llmMessages[0].role === 'assistant') {
        llmMessages[0] = { role: 'user', content: '[Previous messages truncated]' };
      }
    }

    const sessionId = `session_${crypto.randomUUID()}`;
    const ctx: ToolContext = {
      workingDirectory: this.workingDirectory,
      sessionId,
      abortSignal: signal ?? new AbortController().signal,
    };

    const MAX_ROUNDS = 10;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (signal?.aborted) break;

      let responseContent = '';
      const toolCallsAccumulator = new Map<number, { id: string; name: string; arguments: string }>();

      try {
        for await (const chunk of this.providers.streamCompletion({
          modelId,
          messages: llmMessages as any,
          tools: toolDefs.length > 0 ? toolDefs : undefined,
          signal,
        })) {
          if (chunk.type === 'content' && chunk.content) {
            responseContent += chunk.content;
            onEvent({ type: 'content', text: chunk.content });
          }
          if (chunk.type === 'thinking' && chunk.content) {
            onEvent({ type: 'thinking', text: chunk.content });
          }
          if (chunk.type === 'tool_call' && chunk.toolCalls) {
            for (const tc of chunk.toolCalls) {
              const existing = toolCallsAccumulator.get(tc.index);
              if (existing) {
                existing.id = tc.id ?? existing.id;
                existing.name = tc.name ?? existing.name;
                existing.arguments = (existing.arguments ?? '') + (tc.arguments ?? '');
              } else {
                toolCallsAccumulator.set(tc.index, {
                  id: tc.id ?? `call_${crypto.randomUUID().slice(0, 8)}`,
                  name: tc.name ?? '',
                  arguments: tc.arguments ?? '',
                });
              }
            }
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          onEvent({ type: 'done' });
          return;
        }
        onEvent({ type: 'error', message: err.message });
        onEvent({ type: 'done' });
        return;
      }

      // If no tool calls, we're done
      if (toolCallsAccumulator.size === 0) {
        onEvent({ type: 'done' });
        return;
      }

      // Build the assistant message with tool_calls
      const toolCalls = Array.from(toolCallsAccumulator.values())
        .filter(tc => tc.name && tc.name.trim().length > 0);  // Filter out invalid tool calls with empty names

      // If no valid tool calls remain, treat as done
      if (toolCalls.length === 0) {
        onEvent({ type: 'done' });
        return;
      }
      llmMessages.push({
        role: 'assistant',
        content: responseContent,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      // Execute each tool call
      for (const tc of toolCalls) {
        if (signal?.aborted) break;

        const tool = this.tools.get(tc.name);
        if (!tool) {
          const errorResult: ToolCallResult = {
            toolCallId: tc.id,
            name: tc.name,
            success: false,
            output: '',
            error: `Unknown tool: ${tc.name}`,
            duration: 0,
          };
          onEvent({ type: 'tool_result', toolCallId: tc.id, name: tc.name, result: errorResult });
          llmMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(errorResult),
          });
          continue;
        }

        // Notify tool start
        onEvent({
          type: 'tool_start',
          toolCallId: tc.id,
          name: tc.name,
          input: tc.arguments,
        });

        // Execute — H-7: wrap in try/catch to prevent unhandled crashes
        let input: unknown;
        try {
          input = JSON.parse(tc.arguments);
        } catch {
          input = {};
        }

        let result: { success: boolean; output: string; error?: string; duration: number };
        try {
          result = await tool.execute(input as any, ctx);
        } catch (execErr: any) {
          result = {
            success: false,
            output: '',
            error: `Tool execution failed: ${execErr.message}`,
            duration: 0,
          };
        }
        const toolResult: ToolCallResult = {
          toolCallId: tc.id,
          name: tc.name,
          ...result,
        };

        onEvent({
          type: 'tool_result',
          toolCallId: tc.id,
          name: tc.name,
          result: toolResult,
        });

        // Append tool result to messages for next round
        llmMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify({
            success: result.success,
            output: result.output,
            error: result.error,
          }),
        });
      }
    }

    // Safety: if we hit max rounds
    onEvent({ type: 'done' });
  }
}
