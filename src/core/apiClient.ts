// ============================================================================
// Real API Client — Lightweight credential checker for streaming calls
// ============================================================================

import type { ModelConfig } from './types';

/**
 * Determines if a model config has valid credentials to make real API calls.
 * Allows requests without API key (LM Studio, local proxies, etc.).
 */
export function canMakeRealRequest(config: ModelConfig | undefined): boolean {
  if (!config) return false;
  if (config.provider === 'ollama') return true;
  return !!(config.endpoint && config.endpoint.trim().length > 0);
}
