// ============================================================================
// Task-based multi-model routing — cheap for summary, strong for agent/coding
// ============================================================================

import type { ConfigManager, OpenChatConfig } from '../configManager.js';
import type { ModelConfig } from './modelTypes.js';
import type { ProviderGateway } from '../providerGateway.js';

export type AgentRouteRole = 'agent' | 'summary';

export interface ResolvedAgentRouting {
  /** Model selected in the UI / request */
  primary: ModelConfig;
  /** Model used for the agent tool loop (coding-capable) */
  agent: ModelConfig;
  /** Model used for LLM history compression */
  summary: ModelConfig;
  /** Whether agent model differs from primary */
  agentIsOverride: boolean;
  /** Whether summary model differs from agent */
  summaryIsSeparate: boolean;
  cheapModelId?: string;
  codingModelId?: string;
}

/**
 * Resolve which models to use for agent vs summarization.
 *
 * - Agent loop: codingModelId → else primary (active/header model)
 * - Summarizer: cheapModelId → else primary (or agent if cheap missing)
 */
export function resolveAgentRouting(
  providers: ProviderGateway,
  primaryModelId?: string,
  cfg?: OpenChatConfig,
): ResolvedAgentRouting | null {
  const primary = providers.getActiveModel(primaryModelId);
  if (!primary) return null;

  const routing = cfg?.agentRouting ?? providers.config.load().agentRouting;
  const cheapId = routing?.cheapModelId?.trim() || undefined;
  const codingId = routing?.codingModelId?.trim() || undefined;

  const coding =
    (codingId && providers.getActiveModel(codingId)) || primary;
  const cheap =
    (cheapId && providers.getActiveModel(cheapId)) || primary;

  return {
    primary,
    agent: coding,
    summary: cheap,
    agentIsOverride: coding.id !== primary.id,
    /** True when summarizer is not the same as the agent model */
    summaryIsSeparate: cheap.id !== coding.id,
    cheapModelId: cheapId,
    codingModelId: codingId,
  };
}

export function loadRoutingConfig(config: ConfigManager): OpenChatConfig['agentRouting'] {
  return config.load().agentRouting;
}

/** Short label for progress / UI */
export function modelLabel(m: ModelConfig): string {
  return m.name || m.model || m.id;
}
