// ============================================================================
// Pending file patches — stage agent writes until user Applies
// ============================================================================

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

export interface PendingPatch {
  id: string;
  sessionId: string;
  /** Relative display path */
  path: string;
  absPath: string;
  oldContent: string;
  newContent: string;
  tool: 'file_write' | 'file_edit';
  createdAt: number;
  /** Optional task board id */
  taskId?: string;
}

function uid(): string {
  return `patch_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export class PatchStore {
  /** Latest staged content per absPath (so subsequent edits stack) */
  private byPath = new Map<string, PendingPatch>();
  private byId = new Map<string, PendingPatch>();

  stage(opts: {
    sessionId: string;
    absPath: string;
    relativePath: string;
    oldContent: string;
    newContent: string;
    tool: 'file_write' | 'file_edit';
    taskId?: string;
  }): PendingPatch {
    // Stack: if already staged, oldContent for UI is first baseline; new is latest
    const existing = this.byPath.get(opts.absPath);
    const oldContent = existing ? existing.oldContent : opts.oldContent;
    if (existing) {
      this.byId.delete(existing.id);
    }
    const patch: PendingPatch = {
      id: uid(),
      sessionId: opts.sessionId,
      path: opts.relativePath,
      absPath: opts.absPath,
      oldContent,
      newContent: opts.newContent,
      tool: opts.tool,
      createdAt: Date.now(),
      taskId: opts.taskId ?? existing?.taskId,
    };
    this.byPath.set(opts.absPath, patch);
    this.byId.set(patch.id, patch);
    return patch;
  }

  /** Effective file content for reads (staged overrides disk) */
  async getEffectiveContent(absPath: string): Promise<{ content: string; staged: boolean } | null> {
    const staged = this.byPath.get(absPath);
    if (staged) return { content: staged.newContent, staged: true };
    try {
      const content = await fs.readFile(absPath, 'utf-8');
      return { content, staged: false };
    } catch {
      return null;
    }
  }

  get(id: string): PendingPatch | undefined {
    return this.byId.get(id);
  }

  list(sessionId?: string): PendingPatch[] {
    const all = Array.from(this.byId.values());
    const filtered = sessionId ? all.filter(p => p.sessionId === sessionId) : all;
    return filtered.sort((a, b) => b.createdAt - a.createdAt);
  }

  async apply(id: string): Promise<{ ok: boolean; path?: string; error?: string }> {
    const patch = this.byId.get(id);
    if (!patch) return { ok: false, error: 'Patch not found' };
    try {
      await fs.mkdir(path.dirname(patch.absPath), { recursive: true });
      await fs.writeFile(patch.absPath, patch.newContent, 'utf-8');
      this.byId.delete(id);
      if (this.byPath.get(patch.absPath)?.id === id) {
        this.byPath.delete(patch.absPath);
      }
      return { ok: true, path: patch.path };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  }

  reject(id: string): boolean {
    const patch = this.byId.get(id);
    if (!patch) return false;
    this.byId.delete(id);
    if (this.byPath.get(patch.absPath)?.id === id) {
      this.byPath.delete(patch.absPath);
    }
    return true;
  }

  async applyAll(sessionId?: string): Promise<{ applied: string[]; errors: string[] }> {
    const list = this.list(sessionId);
    const applied: string[] = [];
    const errors: string[] = [];
    for (const p of list) {
      const r = await this.apply(p.id);
      if (r.ok && r.path) applied.push(r.path);
      else if (r.error) errors.push(`${p.path}: ${r.error}`);
    }
    return { applied, errors };
  }

  clearSession(sessionId: string): number {
    let n = 0;
    for (const p of [...this.byId.values()]) {
      if (p.sessionId === sessionId) {
        this.reject(p.id);
        n++;
      }
    }
    return n;
  }
}

export const patchStore = new PatchStore();

/** Simple unified diff preview (limited lines for UI) */
export function buildUnifiedDiff(
  oldContent: string,
  newContent: string,
  filePath: string,
  maxHunkLines = 200,
): string {
  const a = oldContent.split('\n');
  const b = newContent.split('\n');
  const lines: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];
  // LCS-free simple line diff for preview
  let i = 0;
  let j = 0;
  let emitted = 0;
  while ((i < a.length || j < b.length) && emitted < maxHunkLines) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push(` ${a[i]}`);
      i++;
      j++;
      emitted++;
      continue;
    }
    // look ahead for resync
    let found = false;
    for (let look = 1; look <= 40 && !found; look++) {
      if (i + look < a.length && j < b.length && a[i + look] === b[j]) {
        for (let k = 0; k < look && emitted < maxHunkLines; k++) {
          lines.push(`-${a[i + k]}`);
          emitted++;
        }
        i += look;
        found = true;
        break;
      }
      if (j + look < b.length && i < a.length && a[i] === b[j + look]) {
        for (let k = 0; k < look && emitted < maxHunkLines; k++) {
          lines.push(`+${b[j + k]}`);
          emitted++;
        }
        j += look;
        found = true;
        break;
      }
    }
    if (!found) {
      if (i < a.length && emitted < maxHunkLines) {
        lines.push(`-${a[i++]}`);
        emitted++;
      }
      if (j < b.length && emitted < maxHunkLines) {
        lines.push(`+${b[j++]}`);
        emitted++;
      }
    }
  }
  if (i < a.length || j < b.length) {
    lines.push('… (diff truncated for preview)');
  }
  return lines.join('\n');
}
