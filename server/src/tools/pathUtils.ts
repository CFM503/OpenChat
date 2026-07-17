// ============================================================================
// Shared path validation — workspace boundary + allowed directories
// ============================================================================

import path from 'path';
import type { ConfigManager } from '../configManager.js';
import { buildEnvContext } from '../envContext.js';

let _config: ConfigManager | null = null;
export function setPathConfig(config: ConfigManager) { _config = config; }

function isUnder(normalized: string, root: string): boolean {
  // Windows paths are case-insensitive
  let a = path.normalize(normalized);
  let b = path.normalize(root);
  if (process.platform === 'win32') {
    a = a.toLowerCase();
    b = b.toLowerCase();
  }
  return a === b || a.startsWith(b + path.sep.toLowerCase()) || a.startsWith(b + path.sep);
}

/**
 * Resolve a path and check it stays within workspace, config allowedDirectories,
 * or default user folders (Desktop / Documents / Downloads / home).
 * Returns normalized absolute path, or null if it escapes boundaries.
 */
export function resolveSafePath(
  inputPath: string | undefined,
  workingDirectory: string,
): string | null {
  if (!inputPath) return path.normalize(workingDirectory);
  const absPath = path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(workingDirectory, inputPath);
  const normalized = path.normalize(absPath);
  const workspaceNorm = path.normalize(workingDirectory);
  if (isUnder(normalized, workspaceNorm)) {
    return normalized;
  }
  const cfg = _config?.load();
  const allowed = [
    ...(cfg?.allowedDirectories ?? []),
    ...buildEnvContext(workingDirectory).defaultAllowedDirs,
  ];
  for (const dir of allowed) {
    if (!dir) continue;
    if (isUnder(normalized, dir)) return normalized;
  }
  return null;
}
