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
import type { SkillManager } from './skills/loader.js';
import { loadProjectMemory } from './memory/projectMemory.js';
import {
  packConversation,
  packSkillCatalog,
  formatPackStats,
  estimateMessageTokens,
} from './context/tokenBudget.js';
import { resolveModelCaps } from './providers/resolveCaps.js';

export interface AgentLoopParams {
  messages: ChatMessage[];
  modelId?: string;
  signal?: AbortSignal;
  onEvent: (event: ServerMessage) => void;
  /** false = disable deep thinking for this run */
  enableThinking?: boolean;
}

/** Token limit threshold — compress when usage exceeds this percentage */
const CONTEXT_COMPRESSION_THRESHOLD = 0.85;

export class AgentLoop {
  private compressedSummary: string | null = null;
  private memoryCache: { dir: string; text: string; at: number } | null = null;

  constructor(
    private providers: ProviderGateway,
    private tools: typeof registry,
    private workingDirectory: string,
    private skills?: SkillManager,
  ) {}

  private async getProjectMemory(): Promise<string> {
    const now = Date.now();
    // 2 min cache — OPENCHAT.md rarely changes mid-session; avoids disk on every turn
    if (
      this.memoryCache &&
      this.memoryCache.dir === this.workingDirectory &&
      now - this.memoryCache.at < 120_000
    ) {
      return this.memoryCache.text;
    }
    const text = await loadProjectMemory(this.workingDirectory);
    this.memoryCache = { dir: this.workingDirectory, text, at: now };
    return text;
  }

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
    const { messages, modelId, signal, onEvent, enableThinking } = params;

    const model = this.providers.getActiveModel(modelId);
    if (!model) {
      onEvent({ type: 'error', message: 'No active model configured' });
      onEvent({ type: 'done' });
      return;
    }
    const caps = resolveModelCaps(model);
    const toolsDisabled = model.disableTools === true || !caps.supportsTools;
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

    // ── System parts (token-budgeted later) ──────────────────────────
    onEvent({
      type: 'progress',
      stage: 'memory',
      message: '加载项目说明与技能列表…',
      percent: 15,
    });

    const systemParts: string[] = [];
    try {
      let memory = await this.getProjectMemory();
      if (memory && memory.length > caps.memoryMaxChars) {
        memory = memory.slice(0, caps.memoryMaxChars) + '\n…[memory truncated for token budget]';
      }
      if (memory) systemParts.push(memory);
    } catch {
      // ignore
    }
    if (this.skills && caps.skillCatalogMode !== 'off') {
      const entries = this.skills.getCatalog(true).map(e => ({
        shortcut: e.shortcut,
        name: e.name,
        description: e.description,
        whenToUse: e.whenToUse,
      }));
      // Minimal strategy: names only + smaller budget → faster packing & fewer tokens
      const catalog = packSkillCatalog(
        entries,
        caps.skillCatalogMode,
        caps.contextStrategy === 'minimal' ? 600 : 2000,
      );
      if (catalog) systemParts.push(catalog);
    }
    systemParts.push(
      'You are OpenChat, an AI coding agent. Use tools to inspect and edit the workspace. ' +
        'Call the `skill` tool when a listed skill matches. Prefer short tool outputs; avoid dumping large files unless needed.' +
        (enableThinking === false
          ? ' Be concise; do not narrate long internal reasoning.'
          : ''),
    );

    // Pull any system messages already in conversation into systemParts
    const convMessages: Record<string, any>[] = [];
    for (const m of llmMessages) {
      if (m.role === 'system') {
        const c = typeof m.content === 'string' ? m.content : '';
        if (c.trim()) systemParts.push(c);
      } else {
        convMessages.push(m);
      }
    }

    const sessionId = `session_${crypto.randomUUID()}`;
    const ctx: ToolContext = {
      workingDirectory: this.workingDirectory,
      sessionId,
      abortSignal: signal ?? new AbortController().signal,
    };

    // ── Pack for token budget (cheap, no LLM) ────────────────────────
    onEvent({
      type: 'progress',
      stage: 'packing',
      message: '整理对话上下文（控制 token 成本）…',
      percent: 30,
    });

    let packed = packConversation({
      messages: convMessages,
      systemParts,
      model,
      priorSummary: this.compressedSummary ?? undefined,
    });
    console.log(`[agentLoop] pack: ${formatPackStats(packed.stats)} est≈${packed.estimatedTokens}`);
    onEvent({
      type: 'pack_stats',
      estimatedTokens: packed.estimatedTokens,
      strategy: packed.stats.strategy,
      keptMessages: packed.stats.keptMessages,
      droppedMessages: packed.stats.droppedMessages,
    });

    // Optional LLM compression — skip when history is short or strategy is minimal
    // (hard truncate already applied by packer; saves a full extra LLM round-trip)
    const allowLlmCompress =
      packed.needsLlmCompression &&
      convMessages.length > 8 &&
      caps.contextStrategy !== 'minimal';

    if (allowLlmCompress) {
      onEvent({
        type: 'progress',
        stage: 'compressing',
        message: '对话较长，正在压缩历史（可能稍等）…',
        percent: 40,
      });
      try {
        const cfg = (this.providers as any).config?.load?.() as
          | { agentRouting?: { cheapModelId?: string } }
          | undefined;
        const cheapId = cfg?.agentRouting?.cheapModelId;
        const summarizeModel =
          (cheapId && this.providers.getActiveModel(cheapId)) || model;
        const result = await compressConversation(this.providers, summarizeModel, convMessages);
        if (result.summary) {
          this.compressedSummary = result.summary;
          packed = packConversation({
            messages: result.recentMessages,
            systemParts,
            model,
            priorSummary: result.summary,
          });
          console.log(`[agentLoop] after LLM compress: est≈${packed.estimatedTokens}`);
          onEvent({
            type: 'pack_stats',
            estimatedTokens: packed.estimatedTokens,
            strategy: packed.stats.strategy,
            keptMessages: packed.stats.keptMessages,
            droppedMessages: packed.stats.droppedMessages,
          });
        }
      } catch (err: any) {
        console.warn('[agentLoop] Compression failed:', err.message);
      }
    }

    let llmMessagesPacked = packed.messages;

    const MAX_ROUNDS = 10;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (signal?.aborted) break;

      // Re-pack each round so tool dumps stay truncated
      if (round > 0) {
        const re = packConversation({
          messages: llmMessagesPacked.filter(m => m.role !== 'system'),
          systemParts,
          model,
          priorSummary: this.compressedSummary ?? undefined,
        });
        llmMessagesPacked = re.messages;
        if (round === 1) {
          console.log(`[agentLoop] round pack: est≈${re.estimatedTokens} tokens≈${llmMessagesPacked.reduce((s, m) => s + estimateMessageTokens(m), 0)}`);
        }
      }

      let responseContent = '';
      const toolCallsAccumulator = new Map<number, { id: string; name: string; arguments: string }>();
      let firstToken = true;

      onEvent({
        type: 'progress',
        stage: 'model',
        message:
          round === 0
            ? '正在请求模型（等待首字）…'
            : `第 ${round + 1} 轮：根据工具结果继续…`,
        round: round + 1,
        percent: Math.min(55 + round * 8, 85),
      });

      try {
        for await (const chunk of this.providers.streamCompletion({
          modelId,
          messages: llmMessagesPacked as any,
          tools: toolDefs.length > 0 ? toolDefs : undefined,
          signal,
          enableThinking,
        })) {
          if (chunk.type === 'content' && chunk.content) {
            if (firstToken) {
              firstToken = false;
              onEvent({
                type: 'progress',
                stage: 'generating',
                message: '模型开始回复…',
                round: round + 1,
                percent: 70,
              });
            }
            responseContent += chunk.content;
            onEvent({ type: 'content', text: chunk.content });
          }
          if (chunk.type === 'thinking' && chunk.content && enableThinking !== false) {
            if (firstToken) {
              firstToken = false;
              onEvent({
                type: 'progress',
                stage: 'thinking',
                message: '模型深度思考中…',
                round: round + 1,
                percent: 60,
              });
            }
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
      llmMessagesPacked.push({
        role: 'assistant',
        content: responseContent,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      // Execute each tool call
      onEvent({
        type: 'progress',
        stage: 'tools',
        message: `执行工具（${toolCalls.length} 个）…`,
        round: round + 1,
        percent: 75,
      });

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
          llmMessagesPacked.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(errorResult),
          });
          continue;
        }

        onEvent({
          type: 'progress',
          stage: 'tools',
          message: `运行工具：${tc.name}`,
          round: round + 1,
          percent: 78,
        });
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

        // Cap tool output size immediately for cost control
        if (result.output && result.output.length > caps.toolResultMaxChars) {
          result = {
            ...result,
            output:
              result.output.slice(0, caps.toolResultMaxChars) +
              `\n…[truncated ${result.output.length - caps.toolResultMaxChars} chars]`,
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

        llmMessagesPacked.push({
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
