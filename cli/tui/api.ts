import type { HealthInfo } from './types.js';

export function makeApiBase(host: string, port: number): string {
  return `http://${host}:${port}`;
}

export function makeWsUrl(host: string, port: number): string {
  return `ws://${host}:${port}/ws`;
}

export async function fetchJson<T = unknown>(url: string, opts?: RequestInit): Promise<T> {
  const resp = await fetch(url, opts);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${text || resp.statusText}`);
  }
  return resp.json() as Promise<T>;
}

export async function healthCheck(base: string, timeoutMs = 2500): Promise<HealthInfo> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetchJson<HealthInfo>(`${base}/api/health`, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function waitForHealth(
  base: string,
  opts: { attempts?: number; intervalMs?: number } = {},
): Promise<HealthInfo> {
  const attempts = opts.attempts ?? 40;
  const intervalMs = opts.intervalMs ?? 250;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await healthCheck(base, 1500);
    } catch (e) {
      lastErr = e;
      await sleep(intervalMs);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Backend health check timed out');
}

export async function listTools(base: string) {
  return fetchJson<Array<{ name: string; description: string; isReadOnly?: boolean }>>(
    `${base}/api/tools`,
  );
}

export async function listSkills(base: string) {
  return fetchJson<
    Array<{ name: string; description?: string; shortcut?: string; source?: string }>
  >(`${base}/api/skills`);
}

export async function listSessions(base: string) {
  return fetchJson<Array<{ id: string; title?: string; messages?: unknown[] }>>(
    `${base}/api/sessions`,
  );
}

export async function getConfig(base: string) {
  return fetchJson<{
    models?: Array<{ id: string; name?: string; model?: string }>;
    activeModelId?: string;
  }>(`${base}/api/config`);
}

export async function reloadExtensions(base: string) {
  await fetchJson(`${base}/api/skills/reload`, { method: 'POST' });
  return fetchJson(`${base}/api/plugins/reload`, { method: 'POST' });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
