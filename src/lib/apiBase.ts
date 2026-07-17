/**
 * Resolve backend base URL for REST + WebSocket.
 * Prefer same-origin (Vite proxy / production) so CORS and port stay simple.
 */
export function getApiBase(): string {
  if (typeof window === 'undefined') return 'http://localhost:3001';
  // Dev: Vite proxies /api → 3001; use relative paths
  return '';
}

export function getWsUrl(): string {
  if (typeof window === 'undefined') return 'ws://localhost:3001/ws';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Prefer proxy path /ws when available
  return `${proto}//${window.location.host}/ws`;
}

export function apiUrl(path: string): string {
  const base = getApiBase();
  if (!path.startsWith('/')) path = '/' + path;
  return `${base}${path}`;
}
