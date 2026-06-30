// ============================================================================
// Tool Types — Interfaces for the tool execution system
// ============================================================================

import type { ToolResult } from '../types.js';

export interface ToolDefinition<Input = unknown> {
  /** Unique tool name (used in function calling) */
  name: string;
  /** Description shown to the LLM */
  description: string;
  /** JSON Schema for the input parameters */
  inputSchema: Record<string, unknown>;
  /** Whether this tool only reads (no side effects) */
  isReadOnly: boolean;
  /** Whether this tool can cause destructive changes */
  isDestructive: boolean;
  /** Execute the tool with given input */
  execute(input: Input, ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
  /** Absolute path to the project/workspace root */
  workingDirectory: string;
  /** Current session ID */
  sessionId: string;
  /** Abort signal for cancellation */
  abortSignal: AbortSignal;
}

/** OpenAI function-calling format tool definition */
interface FunctionToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}
