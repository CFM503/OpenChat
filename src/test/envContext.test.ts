import { describe, it, expect } from 'vitest';
import {
  buildEnvContext,
  formatEnvContextForPrompt,
  resolveUserHome,
  resolveUserDesktop,
} from '../../server/src/envContext.js';
import { resolveSafePath, setPathConfig } from '../../server/src/tools/pathUtils.js';
import path from 'path';
import os from 'os';

describe('envContext', () => {
  it('reports real platform and home', () => {
    const env = buildEnvContext(process.cwd());
    expect(env.platform).toBe(process.platform);
    expect(env.homeDir).toBeTruthy();
    expect(env.workingDirectory).toBe(path.normalize(process.cwd()));
    expect(env.desktopDir.length).toBeGreaterThan(0);
  });

  it('prompt includes Desktop and shell hints', () => {
    const text = formatEnvContextForPrompt(buildEnvContext(process.cwd()));
    expect(text).toContain('Runtime environment');
    expect(text).toContain('Desktop:');
    expect(text).toMatch(/Windows|macOS|Linux|win32|darwin|linux/i);
  });

  it('resolveUserDesktop is under home or OneDrive', () => {
    const home = resolveUserHome();
    const desk = resolveUserDesktop(home);
    expect(desk.includes(home) || desk.toLowerCase().includes('onedrive')).toBe(true);
  });
});

describe('resolveSafePath + user folders', () => {
  it('allows Desktop under default allowed dirs', () => {
    setPathConfig({ load: () => ({}), save: () => {} } as any);
    const desk = resolveUserDesktop();
    const target = path.join(desk, 'openchat-env-test-folder');
    const resolved = resolveSafePath(target, process.cwd());
    expect(resolved).toBe(path.normalize(target));
  });

  it('blocks random system paths', () => {
    setPathConfig({ load: () => ({}), save: () => {} } as any);
    const blocked =
      process.platform === 'win32' ? 'C:\\Windows\\System32\\drivers' : '/etc/passwd';
    expect(resolveSafePath(blocked, process.cwd())).toBeNull();
  });
});
