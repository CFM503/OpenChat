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
import {
  promptCacheStore,
  modelCacheKey,
  extractLatestTurn,
  countUserMessages,
  addUsage,
  cacheHitRate,
  type TokenUsageSnapshot,
  type PromptCacheState,
} from './context/promptCacheSession.js';
import { resolveModelCaps } from './providers/resolveCaps.js';
import type { ModelConfig } from './providers/modelTypes.js';
import { promoteThinkingToAnswer } from './context/promoteAnswer.js';
import { buildEnvContext, formatEnvContextForPrompt } from './envContext.js';

export { promoteThinkingToAnswer, looksLikeInternalMonologue } from './context/promoteAnswer.js';

/** True when reasoning text talks about using a tool but no tool_call was emitted */
function looksLikePlannedToolUse(thinking: string): boolean {
  return (
    /\b(call|use|invoke|run)\s+(the\s+)?(tool|function)\b/i.test(thinking) ||
    /\btool\s*call\b/i.test(thinking) ||
    /调用\s*(工具|函数)|使用工具|发起工具/i.test(thinking) ||
    /let'?s call|need to call|should call|we need to call|i will call|i'll call/i.test(
      thinking,
    )
  );
}

export interface AgentLoopParams {
  messages: ChatMessage[];
  modelId?: string;
  signal?: AbortSignal;
  onEvent: (event: ServerMessage) => void;
  /** false = disable deep thinking for this run */
  enableThinking?: boolean;
  /** Force LLM history compression even if under threshold */
  forceCompress?: boolean;
  /** UI conversation session id — enables cross-turn append-only prompt cache */
  conversationSessionId?: string;
}

export interface CompressOnlyParams {
  messages: ChatMessage[];
  modelId?: string;
  signal?: AbortSignal;
  onEvent: (event: ServerMessage) => void;
  /** default true for manual /compress */
  forceCompress?: boolean;
  conversationSessionId?: string;
}

export class AgentLoop {
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
  /**
   * Pack + optional LLM compress only (no agent reply). Used by Web/TUI /compress.
   */
  async compressOnly(params: CompressOnlyParams): Promise<void> {
    const { messages, modelId, signal, onEvent, forceCompress = true, conversationSessionId } =
      params;
    const model = this.providers.getActiveModel(modelId);
    if (!model) {
      onEvent({ type: 'error', message: 'No active model configured' });
      onEvent({ type: 'done' });
      return;
    }

    onEvent({
      type: 'progress',
      stage: 'received',
      message: '开始上下文压缩…',
      percent: 5,
    });

    try {
      const prepared = await this.prepareConversation(messages, model, {
        enableThinking: true,
        onEvent,
        signal,
      });
      if (signal?.aborted) {
        onEvent({ type: 'done' });
        return;
      }
      const packResult = await this.packAndCompress({
        convMessages: prepared.convMessages,
        systemParts: prepared.systemParts,
        dynamicNotes: prepared.dynamicNotes,
        model,
        onEvent,
        forceCompress,
        signal,
      });
      // Reset session prompt cache to compressed transcript so later turns stay append-only
      if (conversationSessionId && packResult.packed.messages.length) {
        const caps = resolveModelCaps(model);
        const toolsDisabled = model.disableTools === true || !caps.supportsTools;
        const prev = promptCacheStore.get(conversationSessionId);
        promptCacheStore.set(
          promptCacheStore.createFresh({
            sessionKey: conversationSessionId,
            modelKey: modelCacheKey(model),
            thinkingKey: 'on',
            systemParts: prepared.systemParts,
            dynamicNotes: prepared.dynamicNotes,
            priorSummary: packResult.runSummary,
            toolDefs: toolsDisabled ? [] : registry.toFunctionDefinitions(),
            llmMessages: packResult.packed.messages,
            clientUserCount: countUserMessages(messages),
          }),
        );
        // Preserve cumulative usage counters if any
        if (prev?.totalUsage) {
          const s = promptCacheStore.get(conversationSessionId)!;
          s.totalUsage = prev.totalUsage;
          promptCacheStore.set(s);
        }
      }
    } catch (err: any) {
      onEvent({ type: 'error', message: err?.message || String(err) });
    }
    onEvent({ type: 'done' });
  }

  async run(params: AgentLoopParams): Promise<void> {
    const {
      messages,
      modelId,
      signal,
      onEvent,
      enableThinking,
      forceCompress,
      conversationSessionId,
    } = params;

    const model = this.providers.getActiveModel(modelId);
    if (!model) {
      onEvent({ type: 'error', message: 'No active model configured' });
      onEvent({ type: 'done' });
      return;
    }
    const caps = resolveModelCaps(model);
    const toolsDisabled = model.disableTools === true || !caps.supportsTools;
    const mKey = modelCacheKey(model);
    const thinkingKey: 'on' | 'off' = enableThinking === false ? 'off' : 'on';
    const userCount = countUserMessages(messages);

    // Per-run usage from provider stream (prompt cache hit metrics)
    let turnUsage: TokenUsageSnapshot = {
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      cacheWriteTokens: 0,
    };

    let toolDefs: Array<{ type: 'function'; function: any }> = toolsDisabled
      ? []
      : registry.toFunctionDefinitions();
    let systemParts: string[] = [];
    let dynamicNotes: string[] = [];
    let runSummary: string | undefined;
    let llmMessagesPacked: Record<string, any>[] = [];
    let promptCacheSession = false;
    let appendOnly = false;
    let sessionState: PromptCacheState | undefined;

    const existing =
      conversationSessionId && !forceCompress
        ? promptCacheStore.get(conversationSessionId)
        : undefined;

    // Only append when there is a *new* user turn (strictly more users than last run).
    // Equal count = retry / reconnect → full rebuild to avoid duplicating the same user msg.
    const canAppend =
      !!existing &&
      existing.modelKey === mKey &&
      existing.thinkingKey === thinkingKey &&
      existing.llmMessages.length > 0 &&
      userCount > existing.clientUserCount;

    if (canAppend && existing) {
      // ── Hot path: append only the latest user turn (cross-turn prompt cache) ──
      promptCacheSession = true;
      appendOnly = true;
      sessionState = existing;
      toolDefs = existing.toolDefs;
      systemParts = existing.systemParts;
      dynamicNotes = existing.dynamicNotes;
      runSummary = existing.priorSummary;

      onEvent({
        type: 'progress',
        stage: 'packing',
        message: '会话缓存命中：只追加本轮消息…',
        percent: 28,
      });

      const turn = extractLatestTurn(messages) as ChatMessage[];
      const turnLlm = this.toLlmMessages(turn);
      const toAppend: Record<string, any>[] = [];
      for (const m of turnLlm) {
        if (m.role === 'system') {
          const c = typeof m.content === 'string' ? m.content : '';
          if (c.trim()) {
            toAppend.push({ role: 'user', content: `[Context note]\n${c}` });
          }
        } else {
          toAppend.push(m);
        }
      }

      llmMessagesPacked = [...existing.llmMessages, ...toAppend];

      // Emergency re-pack only when near context window
      const est = llmMessagesPacked.reduce((s, m) => s + estimateMessageTokens(m), 0);
      const hard = Math.floor(caps.contextWindow * 0.95);
      if (est > hard) {
        appendOnly = false;
        onEvent({
          type: 'progress',
          stage: 'packing',
          message: '上下文接近上限，整理后继续（可能降低缓存命中）…',
          percent: 32,
        });
        const re = packConversation({
          messages: llmMessagesPacked.filter(m => m.role !== 'system'),
          systemParts,
          dynamicNotes,
          model,
          priorSummary: runSummary,
          writeOnceTools: true,
        });
        llmMessagesPacked = re.messages;
        this.emitPackStats(onEvent, re, {
          appendOnly: false,
          promptCacheSession: true,
        });
      } else {
        const kept = llmMessagesPacked.filter(m => m.role !== 'system').length;
        onEvent({
          type: 'pack_stats',
          estimatedTokens: est,
          strategy: caps.contextStrategy,
          keptMessages: kept,
          droppedMessages: 0,
          appendOnly: true,
          promptCacheSession: true,
        });
        console.log(
          `[agentLoop] session append-only: est≈${est} users=${userCount} (prompt cache)`,
        );
      }
    } else {
      // ── Cold path: full prepare + pack (first turn / model switch / compress) ──
      if (conversationSessionId && forceCompress) {
        promptCacheStore.delete(conversationSessionId);
      }
      toolDefs = toolsDisabled ? [] : registry.toFunctionDefinitions();

      const prepared = await this.prepareConversation(messages, model, {
        enableThinking,
        onEvent,
        signal,
      });
      systemParts = prepared.systemParts;
      dynamicNotes = prepared.dynamicNotes;

      const packResult = await this.packAndCompress({
        convMessages: prepared.convMessages,
        systemParts,
        dynamicNotes,
        model,
        onEvent,
        forceCompress: !!forceCompress,
        signal,
      });
      runSummary = packResult.runSummary;
      llmMessagesPacked = packResult.packed.messages;
    }

    // Snapshot static system from first pack — never rewrite during tool rounds
    const frozenSystemMessages = llmMessagesPacked.filter(m => m.role === 'system');

    const sessionId = conversationSessionId || `session_${crypto.randomUUID()}`;
    const ctx: ToolContext = {
      workingDirectory: this.workingDirectory,
      sessionId,
      abortSignal: signal ?? new AbortController().signal,
    };

    const MAX_ROUNDS = 10;
    /** Any non-empty content event sent to the client this run */
    let anyUserContent = false;
    /** Aggregate thinking across rounds for end-of-run recovery */
    let allThinking = '';
    /** One free "you planned a tool but didn't call it" retry per run */
    let toolNudgeUsed = false;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (signal?.aborted) break;

      // Prompt-cache friendly: append-only after round 0.
      // Tool outputs are truncated once at execute time — do NOT re-pack every
      // round (that rewrote system stubs / dropped messages and busted cache).
      // Emergency re-pack only if we are about to blow the context window.
      if (round > 0) {
        const est = llmMessagesPacked.reduce((s, m) => s + estimateMessageTokens(m), 0);
        const hard = Math.floor(caps.contextWindow * (caps.contextStrategy === 'cache_max' ? 0.95 : 0.92));
        if (est > hard) {
          const re = packConversation({
            messages: llmMessagesPacked.filter(m => m.role !== 'system'),
            systemParts,
            model,
            priorSummary: runSummary,
            dynamicNotes,
            writeOnceTools: true,
          });
          llmMessagesPacked = re.messages;
          console.log(`[agentLoop] emergency re-pack round ${round}: est≈${re.estimatedTokens}`);
        } else if (round === 1) {
          console.log(`[agentLoop] append-only round: est≈${est} (no re-pack, prompt cache)`);
        }
        // Ensure frozen system prefix is still leading (in case of emergency re-pack it is rebuilt)
        if (llmMessagesPacked[0]?.role !== 'system' && frozenSystemMessages.length) {
          llmMessagesPacked = [...frozenSystemMessages, ...llmMessagesPacked.filter(m => m.role !== 'system')];
        }
      }

      let responseContent = '';
      let responseThinking = '';
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
          if (chunk.type === 'usage' && chunk.usage) {
            turnUsage = addUsage(turnUsage, {
              promptTokens: chunk.usage.promptTokens ?? 0,
              completionTokens: chunk.usage.completionTokens ?? 0,
              cachedTokens: chunk.usage.cachedTokens ?? 0,
              cacheWriteTokens: chunk.usage.cacheWriteTokens ?? 0,
            });
            continue;
          }
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
            anyUserContent = true;
            onEvent({ type: 'content', text: chunk.content });
          }
          if (chunk.type === 'thinking' && chunk.content) {
            // Always accumulate for empty-content fallback (even when bulb is off).
            // Previously gateway dropped these when enableThinking=false → total silence.
            responseThinking += chunk.content;
            allThinking += chunk.content;
            if (enableThinking !== false) {
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
            } else {
              // Bulb off: do not open Thinking UI, but show live progress so chat isn't frozen
              if (firstToken) {
                firstToken = false;
                onEvent({
                  type: 'progress',
                  stage: 'generating',
                  message: '模型生成中（未开启深度思考展示）…',
                  round: round + 1,
                  percent: 65,
                });
              }
            }
          }
          if (chunk.type === 'tool_call' && chunk.toolCalls) {
            for (const tc of chunk.toolCalls) {
              // Support both flattened and OpenAI { function: { name, arguments } }
              const raw = tc as any;
              const name = raw.name ?? raw.function?.name ?? '';
              const argPart =
                raw.arguments ??
                raw.function?.arguments ??
                '';
              const idx = typeof raw.index === 'number' ? raw.index : toolCallsAccumulator.size;
              const existing = toolCallsAccumulator.get(idx);
              if (existing) {
                existing.id = raw.id ?? existing.id;
                if (name) existing.name = name;
                existing.arguments =
                  (existing.arguments ?? '') +
                  (typeof argPart === 'string' ? argPart : JSON.stringify(argPart ?? ''));
              } else {
                toolCallsAccumulator.set(idx, {
                  id: raw.id ?? `call_${crypto.randomUUID().slice(0, 8)}`,
                  name: name || '',
                  arguments:
                    typeof argPart === 'string' ? argPart : JSON.stringify(argPart ?? ''),
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

      // Build the assistant message with tool_calls
      const toolCalls = Array.from(toolCallsAccumulator.values())
        .filter(tc => tc.name && tc.name.trim().length > 0);

      // No usable tools this round
      if (toolCalls.length === 0) {
        // Model only planned tools in reasoning — nudge once (domain-agnostic)
        const plannedButNoCall =
          !responseContent.trim() &&
          !anyUserContent &&
          !!responseThinking.trim() &&
          !toolNudgeUsed &&
          round < MAX_ROUNDS - 1 &&
          toolDefs.length > 0 &&
          looksLikePlannedToolUse(responseThinking);

        if (plannedButNoCall) {
          toolNudgeUsed = true;
          console.warn('[agentLoop] Model described tools in thinking but emitted no tool_calls — nudging');
          llmMessagesPacked.push({
            role: 'assistant',
            content:
              responseContent ||
              '(reasoning only; no tool_calls emitted)',
          });
          llmMessagesPacked.push({
            role: 'user',
            content:
              'You planned to use a tool but did not emit a tool call. ' +
              'Call the appropriate tool now via the function-calling API (do not only describe it). ' +
              'If no tool is needed, give the final user-facing answer immediately.',
          });
          onEvent({
            type: 'progress',
            stage: 'model',
            message: '模型未发起工具调用，正在督促其真正调用工具…',
            percent: 62,
          });
          continue;
        }

        if (
          this.emitContentFallback({
            responseContent,
            responseThinking: responseThinking || allThinking,
            enableThinking,
            onEvent,
            alreadyHasContent: anyUserContent,
          })
        ) {
          anyUserContent = true;
        }
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

    // Exhausted rounds or aborted mid-tools without a final assistant text
    if (!anyUserContent) {
      this.emitContentFallback({
        responseContent: '',
        responseThinking: allThinking,
        enableThinking,
        onEvent,
        alreadyHasContent: false,
      });
    }

    // Persist append-only transcript for next user turn (same conversation session)
    if (conversationSessionId && !signal?.aborted) {
      const prevUsage = sessionState?.totalUsage ?? promptCacheStore.get(conversationSessionId)?.totalUsage;
      const totalUsage = addUsage(
        prevUsage ?? {
          promptTokens: 0,
          completionTokens: 0,
          cachedTokens: 0,
          cacheWriteTokens: 0,
        },
        turnUsage,
      );
      const next: PromptCacheState = {
        sessionKey: conversationSessionId,
        modelKey: mKey,
        thinkingKey,
        systemParts,
        dynamicNotes,
        priorSummary: runSummary,
        toolDefs,
        llmMessages: llmMessagesPacked,
        clientUserCount: userCount,
        createdAt: sessionState?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        totalUsage,
      };
      promptCacheStore.set(next);

      const hitRate = cacheHitRate(turnUsage);
      onEvent({
        type: 'pack_stats',
        estimatedTokens: llmMessagesPacked.reduce((s, m) => s + estimateMessageTokens(m), 0),
        strategy: caps.contextStrategy,
        keptMessages: llmMessagesPacked.filter(m => m.role !== 'system').length,
        droppedMessages: 0,
        appendOnly,
        promptCacheSession: promptCacheSession || appendOnly,
        cachedTokens: turnUsage.cachedTokens || undefined,
        cacheWriteTokens: turnUsage.cacheWriteTokens || undefined,
        promptTokens: turnUsage.promptTokens || undefined,
        completionTokens: turnUsage.completionTokens || undefined,
        cacheHitRate: hitRate,
        totalCachedTokens: totalUsage.cachedTokens || undefined,
      });
    } else if (turnUsage.promptTokens || turnUsage.cachedTokens) {
      const hitRate = cacheHitRate(turnUsage);
      onEvent({
        type: 'pack_stats',
        estimatedTokens: llmMessagesPacked.reduce((s, m) => s + estimateMessageTokens(m), 0),
        strategy: caps.contextStrategy,
        keptMessages: llmMessagesPacked.filter(m => m.role !== 'system').length,
        droppedMessages: 0,
        appendOnly,
        promptCacheSession,
        cachedTokens: turnUsage.cachedTokens || undefined,
        cacheWriteTokens: turnUsage.cacheWriteTokens || undefined,
        promptTokens: turnUsage.promptTokens || undefined,
        completionTokens: turnUsage.completionTokens || undefined,
        cacheHitRate: hitRate,
      });
    }

    onEvent({ type: 'done' });
  }

  /**
   * Generic recovery when the model produced no user-visible content.
   * Domain-agnostic: extract answer from thinking if possible; otherwise a short hint.
   * (No hard-coded topic handlers — model chooses tools via function calling.)
   */
  private emitContentFallback(opts: {
    responseContent: string;
    responseThinking: string;
    enableThinking?: boolean;
    onEvent: (event: ServerMessage) => void;
    alreadyHasContent?: boolean;
  }): boolean {
    const { responseContent, responseThinking, enableThinking, onEvent } = opts;
    if (opts.alreadyHasContent || responseContent.trim()) {
      return !!responseContent.trim() || !!opts.alreadyHasContent;
    }

    if (responseThinking.trim()) {
      const promoted = promoteThinkingToAnswer(responseThinking);
      if (promoted) {
        console.warn(
          `[agentLoop] Empty content with thinking only (enableThinking=${enableThinking}) — promoting to reply`,
        );
        onEvent({
          type: 'progress',
          stage: 'generating',
          message: '已将模型输出整理为回复…',
          percent: 90,
        });
        onEvent({ type: 'content', text: promoted });
        return true;
      }
      console.warn(
        '[agentLoop] Thinking-only stream had no extractable answer — sending hint',
      );
      onEvent({
        type: 'content',
        text:
          '_(模型只输出了内部思考，没有给出正式回复。请再试一次，或换用支持工具调用的 chat 模型并提高 Max Tokens。)_',
      });
      return true;
    }

    console.warn('[agentLoop] Model returned empty content and empty thinking');
    onEvent({
      type: 'content',
      text:
        '_(模型没有返回可见正文。可尝试：提高 Max Tokens、换 chat 模型、或检查 API 是否报错。)_',
    });
    return true;
  }

  // ── Context packing / compression (shared by chat + compress-only) ──

  private toLlmMessages(messages: ChatMessage[]): Record<string, any>[] {
    let llmMessages: Record<string, any>[] = messages
      .filter(m => m.role !== 'tool')
      .map(m => {
        const images = m.attachments?.filter(a => a.type.startsWith('image/')) ?? [];
        const textAttachments = m.attachments?.filter(a => !a.type.startsWith('image/')) ?? [];

        const textParts: string[] = [m.content];
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
            ...(m.toolCalls?.length && {
              tool_calls: m.toolCalls.map(tc => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: tc.arguments },
              })),
            }),
          };
        }

        return {
          role: m.role,
          content: textParts.join(''),
          ...(m.toolCalls?.length && {
            tool_calls: m.toolCalls.map(tc => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: tc.arguments },
            })),
          }),
        };
      })
      .filter((m, i) => {
        if (i === 0 && m.role === 'assistant' && typeof m.content === 'string' && m.content.includes('Welcome to')) {
          return false;
        }
        return true;
      });

    llmMessages = llmMessages.filter(m => {
      if (m.role === 'tool') return true;
      if (m.role === 'assistant' && m.tool_calls?.length > 0) return true;
      if (!m.content || (typeof m.content === 'string' && m.content.trim() === '')) return false;
      return true;
    });

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

    if (llmMessages.length > 0 && llmMessages[0].role === 'assistant') {
      llmMessages.unshift({ role: 'user', content: 'Continue.' });
    }
    return llmMessages;
  }

  private async prepareConversation(
    messages: ChatMessage[],
    model: ModelConfig,
    opts: {
      enableThinking?: boolean;
      onEvent: (event: ServerMessage) => void;
      signal?: AbortSignal;
    },
  ): Promise<{
    convMessages: Record<string, any>[];
    systemParts: string[];
    dynamicNotes: string[];
  }> {
    const caps = resolveModelCaps(model);
    const llmMessages = this.toLlmMessages(messages);

    opts.onEvent({
      type: 'progress',
      stage: 'memory',
      message: '加载项目说明与技能列表…',
      percent: 15,
    });

    // Stable order for prompt-cache prefixes (most constant first):
    //   1) agent core  2) env  3) project memory  4) skills
    // Client/ephemeral system notes go to dynamicNotes (second system message).
    const systemParts: string[] = [];

    const agentCore =
      'You are OpenChat, an AI coding agent with tools (bash, files, grep, git, web_search, web_fetch, skill, …). ' +
      'Always respect the Runtime environment block for OS, shell, and absolute paths. ' +
      'When the user says Desktop/桌面/Documents/Downloads, use those absolute paths from the environment block — ' +
      'do not assume the project cwd is the Desktop, and do not invent wrong home paths. ' +
      'When live facts are needed (news, weather, docs, prices, etc.), call web_search / web_fetch — do not invent data. ' +
      'If you decide to use a tool, emit a real tool/function call; never only describe the call in reasoning. ' +
      'After tools (or when no tool is needed), always write a clear user-facing answer. ' +
      'Optional: for glanceable structured data, include a fenced ```canvas <kind>``` JSON block the UI can render; keep normal markdown too. ' +
      'Call the `skill` tool when a listed skill matches. Prefer short tool outputs.' +
      (opts.enableThinking === false
        ? ' Be concise; do not narrate long internal reasoning in the reply.'
        : '');
    systemParts.push(agentCore);

    // Facts about THIS machine — so Desktop/mkdir/shell commands match reality
    systemParts.push(formatEnvContextForPrompt(buildEnvContext(this.workingDirectory)));

    try {
      let memory = await this.getProjectMemory();
      if (memory && memory.length > caps.memoryMaxChars) {
        memory = memory.slice(0, caps.memoryMaxChars) + '\n…[memory truncated for token budget]';
      }
      if (memory) systemParts.push(memory);
    } catch {
      /* ignore */
    }

    if (this.skills && caps.skillCatalogMode !== 'off') {
      const entries = this.skills.getCatalog(true).map(e => ({
        shortcut: e.shortcut,
        name: e.name,
        description: e.description,
        whenToUse: e.whenToUse,
      }));
      const catalogBudget =
        caps.contextStrategy === 'minimal' ? 600 :
        caps.contextStrategy === 'cache_max' ? 4000 :
        2000;
      const catalog = packSkillCatalog(entries, caps.skillCatalogMode, catalogBudget);
      if (catalog) systemParts.push(catalog);
    }

    const convMessages: Record<string, any>[] = [];
    const dynamicNotes: string[] = [];
    for (const m of llmMessages) {
      if (m.role === 'system') {
        const c = typeof m.content === 'string' ? m.content : '';
        if (c.trim()) dynamicNotes.push(c.trim());
      } else {
        convMessages.push(m);
      }
    }

    return { convMessages, systemParts, dynamicNotes };
  }

  private emitPackStats(
    onEvent: (e: ServerMessage) => void,
    packed: ReturnType<typeof packConversation>,
    extra?: {
      llmCompressed?: boolean;
      summary?: string;
      appendOnly?: boolean;
      promptCacheSession?: boolean;
      cachedTokens?: number;
      cacheWriteTokens?: number;
      promptTokens?: number;
      completionTokens?: number;
      cacheHitRate?: number;
      totalCachedTokens?: number;
    },
  ): void {
    const compressed =
      packed.stats.droppedMessages > 0 ||
      packed.stats.truncatedTools > 0 ||
      !!extra?.llmCompressed ||
      !!extra?.summary;
    const summary = extra?.summary || '';
    onEvent({
      type: 'pack_stats',
      estimatedTokens: packed.estimatedTokens,
      strategy: packed.stats.strategy,
      keptMessages: packed.stats.keptMessages,
      droppedMessages: packed.stats.droppedMessages,
      truncatedTools: packed.stats.truncatedTools,
      compressed,
      llmCompressed: !!extra?.llmCompressed,
      summaryChars: summary ? summary.length : 0,
      summaryPreview: summary
        ? summary.replace(/\s+/g, ' ').slice(0, 160) + (summary.length > 160 ? '…' : '')
        : undefined,
      // Cap full summary on wire to keep WS payloads bounded
      summary: summary
        ? summary.length > 6000
          ? summary.slice(0, 6000) + '\n…[summary truncated for client]'
          : summary
        : undefined,
      appendOnly: extra?.appendOnly,
      promptCacheSession: extra?.promptCacheSession,
      cachedTokens: extra?.cachedTokens,
      cacheWriteTokens: extra?.cacheWriteTokens,
      promptTokens: extra?.promptTokens,
      completionTokens: extra?.completionTokens,
      cacheHitRate: extra?.cacheHitRate,
      totalCachedTokens: extra?.totalCachedTokens,
    });
  }

  private async packAndCompress(opts: {
    convMessages: Record<string, any>[];
    systemParts: string[];
    dynamicNotes?: string[];
    model: ModelConfig;
    onEvent: (event: ServerMessage) => void;
    forceCompress: boolean;
    signal?: AbortSignal;
  }): Promise<{
    packed: ReturnType<typeof packConversation>;
    runSummary?: string;
  }> {
    const { convMessages, systemParts, dynamicNotes, model, onEvent, forceCompress, signal } = opts;
    const caps = resolveModelCaps(model);

    onEvent({
      type: 'progress',
      stage: 'packing',
      message: '整理对话上下文（控制 token 成本）…',
      percent: 30,
    });

    let packed = packConversation({
      messages: convMessages,
      systemParts,
      dynamicNotes,
      model,
    });
    console.log(`[agentLoop] pack: ${formatPackStats(packed.stats)} est≈${packed.estimatedTokens}`);
    this.emitPackStats(onEvent, packed);

    // LLM compression: auto when packer signals, or forced by client.
    // cache_max uses a high compressionThreshold (0.92) so this rarely fires —
    // avoiding frequent summary rewrites that bust prompt cache.
    const allowLlmCompress =
      forceCompress ||
      (packed.needsLlmCompression &&
        convMessages.length > 6 &&
        caps.contextStrategy !== 'minimal');

    // When forceCompress + minimal, still allow LLM compress for explicit /compress
    const allowForced =
      forceCompress && convMessages.length >= 4;

    let runSummary: string | undefined;

    if ((allowLlmCompress || allowForced) && !signal?.aborted) {
      if (caps.contextStrategy === 'minimal' && !forceCompress) {
        // hard truncate only
      } else {
        onEvent({
          type: 'progress',
          stage: 'compressing',
          message: forceCompress
            ? '手动压缩历史上下文…'
            : '对话较长，正在压缩历史（可能稍等）…',
          percent: 40,
        });
        try {
          const cfg = (this.providers as any).config?.load?.() as
            | { agentRouting?: { cheapModelId?: string } }
            | undefined;
          const cheapId = cfg?.agentRouting?.cheapModelId;
          const summarizeModel =
            (cheapId && this.providers.getActiveModel(cheapId)) || model;
          const result = await compressConversation(
            this.providers,
            summarizeModel,
            convMessages,
          );
          if (result.summary) {
            runSummary = result.summary;
            packed = packConversation({
              messages: result.recentMessages,
              systemParts,
              dynamicNotes,
              model,
              priorSummary: result.summary,
            });
            console.log(`[agentLoop] after LLM compress: est≈${packed.estimatedTokens}`);
            this.emitPackStats(onEvent, packed, {
              llmCompressed: true,
              summary: result.summary,
            });
          } else {
            // No summary text — still report final pack (hard drop may apply)
            this.emitPackStats(onEvent, packed, { llmCompressed: false });
          }
        } catch (err: any) {
          console.warn('[agentLoop] Compression failed:', err.message);
          onEvent({
            type: 'progress',
            stage: 'packing',
            message: `压缩失败，使用截断策略：${err.message?.slice(0, 80) || 'error'}`,
            percent: 45,
          });
        }
      }
    }

    return { packed, runSummary };
  }
}
