import { describe, it, expect } from 'vitest';
import {
  formatPackBadge,
  formatPackFooter,
  formatPackTooltip,
} from '../lib/statusLabels';
import type { PackStats } from '../hooks/useChat';

const base: PackStats = {
  estimatedTokens: 1200,
  strategy: 'cache_max',
  keptMessages: 8,
  droppedMessages: 2,
  agentModelName: 'Coder',
  cachedTokens: 900,
  cacheHitRate: 0.75,
  appendOnly: true,
};

describe('statusLabels', () => {
  it('formatPackBadge is Chinese and compact', () => {
    const s = formatPackBadge(base);
    expect(s).toContain('约 1200 token');
    expect(s).toContain('Coder');
    expect(s).toContain('缓存 900');
    expect(s).toContain('75%');
  });

  it('formatPackFooter mentions session cache', () => {
    const s = formatPackFooter(base);
    expect(s).toContain('会话缓存命中');
    expect(s).toContain('缓存优先');
  });

  it('formatPackTooltip lists strategy in Chinese', () => {
    const s = formatPackTooltip(base);
    expect(s).toContain('策略：');
    expect(s).toContain('cache_max');
  });
});
