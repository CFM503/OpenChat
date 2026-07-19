import { describe, it, expect, beforeEach } from 'vitest';
import { PatchStore, buildUnifiedDiff } from '../../server/src/patches/store.js';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

describe('PatchStore', () => {
  let store: PatchStore;
  let dir: string;

  beforeEach(async () => {
    store = new PatchStore();
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-patch-'));
  });

  it('stages and applies a write', async () => {
    const abs = path.join(dir, 'a.txt');
    const patch = store.stage({
      sessionId: 's1',
      absPath: abs,
      relativePath: 'a.txt',
      oldContent: '',
      newContent: 'hello\n',
      tool: 'file_write',
    });
    expect(store.list('s1')).toHaveLength(1);
    const r = await store.apply(patch.id);
    expect(r.ok).toBe(true);
    const body = await fs.readFile(abs, 'utf-8');
    expect(body).toBe('hello\n');
    expect(store.list('s1')).toHaveLength(0);
  });

  it('stacks edits keeping original baseline', async () => {
    const abs = path.join(dir, 'b.txt');
    await fs.writeFile(abs, 'v1\n', 'utf-8');
    store.stage({
      sessionId: 's',
      absPath: abs,
      relativePath: 'b.txt',
      oldContent: 'v1\n',
      newContent: 'v2\n',
      tool: 'file_edit',
    });
    const p2 = store.stage({
      sessionId: 's',
      absPath: abs,
      relativePath: 'b.txt',
      oldContent: 'v2\n',
      newContent: 'v3\n',
      tool: 'file_edit',
    });
    expect(p2.oldContent).toBe('v1\n');
    expect(p2.newContent).toBe('v3\n');
    expect(store.list()).toHaveLength(1);
  });

  it('getEffectiveContent returns staged', async () => {
    const abs = path.join(dir, 'c.txt');
    await fs.writeFile(abs, 'disk\n', 'utf-8');
    store.stage({
      sessionId: 's',
      absPath: abs,
      relativePath: 'c.txt',
      oldContent: 'disk\n',
      newContent: 'staged\n',
      tool: 'file_write',
    });
    const eff = await store.getEffectiveContent(abs);
    expect(eff?.staged).toBe(true);
    expect(eff?.content).toBe('staged\n');
  });
});

describe('buildUnifiedDiff', () => {
  it('shows added and removed lines', () => {
    const d = buildUnifiedDiff('a\nb\n', 'a\nc\n', 'f.ts');
    expect(d).toContain('-b');
    expect(d).toContain('+c');
  });
});
