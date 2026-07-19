import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntime, setWorkingDirectory } from '../../server/src/runtime.js';

describe('setWorkingDirectory', () => {
  let tmpA: string;
  let tmpB: string;
  let prevCwd: string | undefined;

  beforeEach(() => {
    tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-cwd-a-'));
    tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-cwd-b-'));
    fs.writeFileSync(path.join(tmpB, 'OPENCHAT.md'), '# Project B\n', 'utf-8');
    prevCwd = process.env.OPENCHAT_CWD;
  });

  afterEach(() => {
    if (prevCwd === undefined) delete process.env.OPENCHAT_CWD;
    else process.env.OPENCHAT_CWD = prevCwd;
    try {
      fs.rmSync(tmpA, { recursive: true, force: true });
      fs.rmSync(tmpB, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('hot-switches agent cwd and env OPENCHAT_CWD', async () => {
    const rt = createRuntime({ cwd: tmpA, port: 39991 });
    expect(rt.workingDirectory).toBe(path.resolve(tmpA));

    const r = await setWorkingDirectory(rt, tmpB);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(path.normalize(rt.workingDirectory)).toBe(path.normalize(path.resolve(tmpB)));
    expect(path.normalize(rt.agentLoop.getWorkingDirectory())).toBe(
      path.normalize(path.resolve(tmpB)),
    );
    expect(process.env.OPENCHAT_CWD && path.normalize(process.env.OPENCHAT_CWD)).toBe(
      path.normalize(path.resolve(tmpB)),
    );
  });

  it('rejects missing directory', async () => {
    const rt = createRuntime({ cwd: tmpA, port: 39992 });
    const r = await setWorkingDirectory(rt, path.join(tmpA, 'no-such-dir-xyz'));
    expect(r.ok).toBe(false);
  });
});
