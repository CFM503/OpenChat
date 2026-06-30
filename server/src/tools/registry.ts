// ============================================================================
// Tool Registry — Central registration and discovery for all tools
// ============================================================================

import type { ToolDefinition, FunctionToolDef } from './types.js';

const tools = new Map<string, ToolDefinition>();

export function register(tool: ToolDefinition): void {
  tools.set(tool.name, tool);
}

export function unregister(name: string): boolean {
  return tools.delete(name);
}

export function get(name: string): ToolDefinition | undefined {
  return tools.get(name);
}

export function has(name: string): boolean {
  return tools.has(name);
}

export function getAll(): ToolDefinition[] {
  return Array.from(tools.values());
}

/** Returns all registered tools in OpenAI function-calling format. */
export function toFunctionDefinitions(): FunctionToolDef[] {
  return getAll().map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}
