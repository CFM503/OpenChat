// ============================================================================
// AgentLoop — LLM ↔ Tool interaction loop
// Sends messages + tool definitions to LLM, executes tool calls, repeats
// ============================================================================

import crypto from 'crypto';
import { ProviderGateway } from './providerGateway.js';
import * as registry from './tools/registry.js';
import type { ToolContext } from './tools/types.js';
import type { ServerMessage, ChatMessage, ToolCallResult } from './types.js';
import { compressConversation } from './summarizer.js';

export interface AgentLoopParams {
  messages: ChatMessage[];
  modelId?: string;
  signal?: AbortSignal;
  onEvent: (event: ServerMessage) => void;
}

/** Token limit threshold — compress when usage exceeds this percentage */
const CONTEXT_COMPRESSION_THRESHOLD = 0.85;

export class AgentLoop {
  private compressedSummary: string | null = null;

  constructor(
    private providers: ProviderGateway,
    private tools: typeof registry,
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
    const toolDefs = toolsDisabled ? [] : registry.toFunctionDefinitions();

    // Build the messages array for the LLM (convert from our format)
    let llmMessages: Record<string, any>[] = messages
      .filter(m => m.role !== 'tool')
      .map(m => {
        const images = m.attachments?.filter(a => a.type.startsWith('image/')) ?? [];
        const textAttachments = m.attachments?.filter(a => !a.type.startsWith('image/')) ?? [];

        let content: string = m.content;

        const textParts: string[] = [content];
        for (const ta of textAttachments) {
          textParts.push(`\n\n[Attached file: ${ta.name}]\n${ta.content}`);
        }

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
      })
      // Skip the welcome message — it's only for UI display, not part of the conversation
      .filter((m, i, arr) => {
        if (i === 0 && m.role === 'assistant' && m.content.includes('Welcome to')) return false;
        return true;
      });

    // Sanitize messages: remove empty messages, ensure role alternation
    llmMessages = llmMessages.filter(m => {
      if (m.role === 'tool') return true;
      if (m.role === 'assistant' && m.tool_calls?.length > 0) return true;
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

    const sessionId = `session_${crypto.randomUUID()}`;
    const ctx: ToolContext = {
      workingDirectory: this.workingDirectory,
      sessionId,
      abortSignal: signal ?? new AbortController().signal,
    };

    // ── Compress context if it exceeds the threshold ─────────────────
    if (model && llmMessages.length > 10) {
      try {
        const result = await compressConversation(this.providers, model, llmMessages);
        if (result.summary) {
          this.compressedSummary = result.summary;
          llmMessages = [
            { role: 'system', content: `Conversation summary:\n${result.summary}` },
            ...result.recentMessages.map(m => ({ role: m.role, content: m.content })),
          ];
        }
      } catch (err: any) {
        console.warn('[agentLoop] Compression failed:', err.message);
        // Fallback: hard truncate to last 40 messages
        llmMessages = llmMessages.slice(-40);
      }
    }

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
        .filter(tc => tc.name && tc.name.trim().length > 0);

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

        const tool = registry.get(tc.name);
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

        onEvent({
          type: 'tool_start',
          toolCallId: tc.id,
          name: tc.name,
          input: tc.arguments,
        });

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

    onEvent({ type: 'done' });
  }
}
