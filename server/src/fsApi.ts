// ============================================================================
// Filesystem API helpers — list/read/write project files safely
// ============================================================================

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import type { ConfigManager } from './configManager.js';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'coverage',
  '__pycache__', '.venv', 'venv', '.cache', '.turbo', '.openchat',
]);

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB for editor
const MAX_TREE_ENTRIES = 500;

export interface FsEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  children?: FsEntry[];
}

function getAllowedRoots(workspace: string, config: ConfigManager): string[] {
  const cfg = config.load();
  const extra = (cfg.allowedDirectories ?? []).filter(Boolean);
  return [path.resolve(workspace), ...extra.map(d => path.resolve(d))];
}

export function isPathAllowed(absPath: string, workspace: string, config: ConfigManager): boolean {
  const normalized = path.normalize(absPath);
  const roots = getAllowedRoots(workspace, config);
  return roots.some(root => {
    const r = path.normalize(root);
    return normalized === r || normalized.startsWith(r + path.sep);
  });
}

export async function resolveSafeFsPath(
  filePath: string,
  workspace: string,
  config: ConfigManager,
): Promise<string | null> {
  const abs = path.isAbsolute(filePath)
    ? path.normalize(filePath)
    : path.normalize(path.resolve(workspace, filePath));

  if (!isPathAllowed(abs, workspace, config)) return null;

  // Symlink check when path exists
  try {
    const real = path.normalize(await fs.realpath(abs));
    if (!isPathAllowed(real, workspace, config)) return null;
    return real;
  } catch {
    // May not exist yet (write) — check parent
    try {
      const parent = path.dirname(abs);
      const realParent = path.normalize(await fs.realpath(parent));
      if (!isPathAllowed(realParent, workspace, config)) return null;
      return abs;
    } catch {
      return null;
    }
  }
}

export async function listTree(
  dirPath: string,
  workspace: string,
  config: ConfigManager,
  depth = 3,
): Promise<FsEntry[]> {
  const abs = await resolveSafeFsPath(dirPath || '.', workspace, config);
  if (!abs) throw new Error('Path not allowed');

  let count = 0;

  async function walk(current: string, relBase: string, remaining: number): Promise<FsEntry[]> {
    if (remaining < 0 || count >= MAX_TREE_ENTRIES) return [];
    let entries: fsSync.Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return [];
    }

    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    const result: FsEntry[] = [];
    for (const ent of entries) {
      if (count >= MAX_TREE_ENTRIES) break;
      if (ent.name.startsWith('.') && ent.name !== '.openchat') {
        // Skip most dotfiles/dirs in tree (keep nothing heavy)
        if (ent.isDirectory()) continue;
      }
      if (ent.isDirectory() && SKIP_DIRS.has(ent.name)) continue;

      const full = path.join(current, ent.name);
      const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
      count++;

      if (ent.isDirectory()) {
        const children = remaining > 0
          ? await walk(full, rel, remaining - 1)
          : undefined;
        result.push({
          name: ent.name,
          path: rel.replace(/\\/g, '/'),
          type: 'directory',
          children,
        });
      } else if (ent.isFile()) {
        let size: number | undefined;
        try {
          const st = await fs.stat(full);
          size = st.size;
        } catch { /* ignore */ }
        result.push({
          name: ent.name,
          path: rel.replace(/\\/g, '/'),
          type: 'file',
          size,
        });
      }
    }
    return result;
  }

  const relRoot = path.relative(workspace, abs).replace(/\\/g, '/') || '.';
  if (relRoot === '.') {
    return walk(abs, '', depth);
  }
  return walk(abs, relRoot === '.' ? '' : relRoot, depth);
}

export async function readFileContent(
  filePath: string,
  workspace: string,
  config: ConfigManager,
): Promise<{ path: string; content: string; language: string; size: number }> {
  const abs = await resolveSafeFsPath(filePath, workspace, config);
  if (!abs) throw new Error('Path not allowed');

  const st = await fs.stat(abs);
  if (!st.isFile()) throw new Error('Not a file');
  if (st.size > MAX_FILE_SIZE) {
    throw new Error(`File too large (${Math.round(st.size / 1024)}KB). Max ${MAX_FILE_SIZE / 1024}KB for editor.`);
  }

  // Skip obvious binaries
  const buf = await fs.readFile(abs);
  if (buf.includes(0)) {
    throw new Error('Binary file cannot be opened in the text editor');
  }

  const content = buf.toString('utf-8');
  const rel = path.relative(workspace, abs).replace(/\\/g, '/') || path.basename(abs);
  return {
    path: rel,
    content,
    language: detectLanguage(rel),
    size: st.size,
  };
}

export async function writeFileContent(
  filePath: string,
  content: string,
  workspace: string,
  config: ConfigManager,
): Promise<{ path: string; size: number }> {
  const abs = await resolveSafeFsPath(filePath, workspace, config);
  if (!abs) throw new Error('Path not allowed');

  // Ensure parent exists
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf-8');
  const st = await fs.stat(abs);
  const rel = path.relative(workspace, abs).replace(/\\/g, '/') || path.basename(abs);
  return { path: rel, size: st.size };
}

export function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
    '.py': 'python', '.rb': 'ruby', '.go': 'go', '.rs': 'rust', '.java': 'java',
    '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp', '.cs': 'csharp',
    '.html': 'html', '.htm': 'html', '.css': 'css', '.scss': 'scss',
    '.json': 'json', '.md': 'markdown', '.yml': 'yaml', '.yaml': 'yaml',
    '.sh': 'bash', '.bash': 'bash', '.ps1': 'powershell', '.sql': 'sql',
    '.toml': 'toml', '.xml': 'xml', '.vue': 'vue', '.svelte': 'svelte',
  };
  return map[ext] || 'text';
}
