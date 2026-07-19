// ============================================================================
// Human-readable Chinese status labels (cache / models / patches)
// ============================================================================

import type { PackStats, AgentRoutingInfo } from '../hooks/useChat';

/** Compact header badge text */
export function formatPackBadge(
  stats: PackStats,
  routing?: AgentRoutingInfo | null,
): string {
  const agent = stats.agentModelName || routing?.agentModelName;
  const parts: string[] = [`约 ${stats.estimatedTokens} token`];

  if (agent) parts.push(agent);

  if (stats.cachedTokens != null && stats.cachedTokens > 0) {
    const pct =
      stats.cacheHitRate != null && stats.cacheHitRate > 0
        ? ` ${Math.round(stats.cacheHitRate * 100)}%`
        : '';
    parts.push(`缓存 ${stats.cachedTokens}${pct}`);
  } else if (stats.appendOnly || stats.promptCacheSession) {
    parts.push('会话缓存');
  }

  if (stats.llmCompressed) parts.push('已压缩');
  else if (stats.compressed) parts.push('已裁剪');

  return parts.join(' · ');
}

/** Hover tooltip (still scannable, Chinese) */
export function formatPackTooltip(
  stats: PackStats,
  routing?: AgentRoutingInfo | null,
): string {
  const lines = [
    `策略：${strategyZh(stats.strategy)}`,
    `保留 ${stats.keptMessages} 条 · 丢弃 ${stats.droppedMessages} 条`,
  ];
  const agent = stats.agentModelName || routing?.agentModelName;
  const summary = stats.summaryModelName || routing?.summaryModelName;
  if (agent) lines.push(`Agent 模型：${agent}`);
  if (summary) lines.push(`摘要模型：${summary}`);
  if (stats.promptTokens != null) lines.push(`本轮输入：${stats.promptTokens} token`);
  if (stats.cachedTokens != null) lines.push(`本轮命中缓存：${stats.cachedTokens}`);
  if (stats.cacheHitRate != null) {
    lines.push(`缓存命中率：约 ${Math.round(stats.cacheHitRate * 100)}%`);
  }
  if (stats.totalCachedTokens != null && stats.totalCachedTokens > 0) {
    lines.push(`会话累计缓存：${stats.totalCachedTokens}`);
  }
  if (stats.appendOnly || stats.promptCacheSession) {
    lines.push('本轮使用了会话级前缀缓存（append-only）');
  }
  if (stats.summaryPreview) lines.push(`摘要预览：${stats.summaryPreview}`);
  return lines.join('\n');
}

function strategyZh(s: string): string {
  switch (s) {
    case 'cache_max':
      return '缓存优先 (cache_max)';
    case 'balanced':
      return '均衡 (balanced)';
    case 'minimal':
      return '最省 (minimal)';
    case 'full':
      return '完整 (full)';
    default:
      return s;
  }
}

/** Footer pack label under chat */
export function formatPackFooter(
  stats: PackStats,
  routing?: AgentRoutingInfo | null,
): string {
  let t = `上下文约 ${stats.estimatedTokens} token · ${strategyZh(stats.strategy)}`;
  const agent = stats.agentModelName || routing?.agentModelName;
  if (agent) t += ` · 模型 ${agent}`;
  if (stats.llmCompressed) {
    const sm = stats.summaryModelName || routing?.summaryModelName;
    t += sm ? ` · 已用 ${sm} 压缩` : ' · 已压缩历史';
  }
  if (stats.appendOnly || stats.promptCacheSession) t += ' · 会话缓存命中';
  if (stats.cachedTokens != null && stats.cachedTokens > 0) {
    t += ` · 缓存 ${stats.cachedTokens}`;
    if (stats.cacheHitRate != null) t += `（约 ${Math.round(stats.cacheHitRate * 100)}%）`;
  }
  if (stats.droppedMessages) t += ` · 省略 ${stats.droppedMessages} 条旧消息`;
  return t;
}
