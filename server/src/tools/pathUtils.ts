// ============================================================================
// Shared path validation — workspace boundary + allowed directories
// ============================================================================

import path from 'path';
import type { ConfigManager } from '../configManager.js';

let _config: ConfigManager | null = null;
export function setPathConfig(config: ConfigManager) { _config = config; }

/**
 * Resolve a path and check it stays within workspace or allowedDirectories.
 * Returns normalized absolute path, or null if it escapes boundaries.
 */
export function resolveSafePath(
  inputPath: string | undefined,
  workingDirectory: string,
): string | null {
  if (!inputPath) return workingDirectory;
  const absPath = path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(workingDirectory, inputPath);
  const normalized = path.normalize(absPath);
  const workspaceNorm = path.normalize(workingDirectory);
  if (normalized === workspaceNorm || normalized.startsWith(workspaceNorm + path.sep)) {
    return normalized;
  }
  const cfg = _config?.load();
  const allowed = cfg?.allowedDirectories ?? [];
  for (const dir of allowed) {
    const dirNorm = path.normalize(dir);
    if (normalized === dirNorm || normalized.startsWith(dirNorm + path.sep)) return normalized;
  }
  return null;
}
