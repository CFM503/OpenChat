// ============================================================================
// WebTool — Web search + page fetch for the agent loop
// ============================================================================

import type { ToolDefinition, ToolContext } from './types.js';
import type { ToolResult } from '../types.js';
import type { ConfigManager } from '../configManager.js';

let configManager: ConfigManager | null = null;

export function setWebToolConfig(config: ConfigManager) {
  configManager = config;
}

interface SearchResult {
  title: string;
  url: string;
  content: string;
}

async function runSearch(query: string, maxResults = 5): Promise<SearchResult[]> {
  const cfg = configManager?.load() ?? {};
  const provider = (cfg.searchProvider as string) || 'tavily';
  const apiKey = cfg.searchApiKey || cfg.tavilyApiKey || '';
  const baseUrl = cfg.searchBaseUrl || 'http://localhost:8888';

  switch (provider) {
    case 'tavily':
      return tavilySearch(query, apiKey, maxResults);
    case 'serpapi':
      return serpapiSearch(query, apiKey, maxResults);
    case 'bing':
      return bingSearch(query, apiKey, maxResults);
    case 'searxng':
      return searxngSearch(query, baseUrl, maxResults);
    default:
      throw new Error(`Unknown search provider: ${provider}`);
  }
}

async function tavilySearch(query: string, apiKey: string, maxResults: number): Promise<SearchResult[]> {
  if (!apiKey?.trim()) throw new Error('Tavily API key missing. Configure it in Settings → Search.');
  const resp = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      include_answer: false,
      max_results: maxResults,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`Tavily error (${resp.status}): ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json() as any;
  return (data.results || []).map((r: any) => ({
    title: r.title,
    url: r.url,
    content: r.content,
  }));
}

async function serpapiSearch(query: string, apiKey: string, maxResults: number): Promise<SearchResult[]> {
  if (!apiKey?.trim()) throw new Error('SerpAPI key missing. Configure it in Settings → Search.');
  const params = new URLSearchParams({ q: query, api_key: apiKey, engine: 'google', num: String(maxResults) });
  const resp = await fetch(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(20000) });
  if (!resp.ok) throw new Error(`SerpAPI error (${resp.status})`);
  const data = await resp.json() as any;
  return (data.organic_results || []).slice(0, maxResults).map((r: any) => ({
    title: r.title,
    url: r.link,
    content: r.snippet || '',
  }));
}

async function bingSearch(query: string, apiKey: string, maxResults: number): Promise<SearchResult[]> {
  if (!apiKey?.trim()) throw new Error('Bing API key missing. Configure it in Settings → Search.');
  const params = new URLSearchParams({ q: query, count: String(maxResults) });
  const resp = await fetch(`https://api.bing.microsoft.com/v7.0/search?${params}`, {
    headers: { 'Ocp-Apim-Subscription-Key': apiKey },
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`Bing error (${resp.status})`);
  const data = await resp.json() as any;
  return (data.webPages?.value || []).slice(0, maxResults).map((r: any) => ({
    title: r.name,
    url: r.url,
    content: r.snippet || '',
  }));
}

async function searxngSearch(query: string, baseUrl: string, maxResults: number): Promise<SearchResult[]> {
  const url = `${baseUrl.replace(/\/+$/, '')}/search?${new URLSearchParams({
    q: query,
    format: 'json',
    pageno: '1',
  })}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!resp.ok) throw new Error(`SearXNG error (${resp.status})`);
  const data = await resp.json() as any;
  return (data.results || []).slice(0, maxResults).map((r: any) => ({
    title: r.title,
    url: r.url,
    content: r.content || '',
  }));
}

// ── Web Search Tool ─────────────────────────────────────────────────────────

interface WebSearchInput {
  query: string;
  max_results?: number;
}

export const WebSearchTool: ToolDefinition<WebSearchInput> = {
  name: 'web_search',
  description:
    'Search the web for real-time information. Use when you need current facts, docs, news, or anything not in the local codebase. Returns titles, URLs, and snippets.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      max_results: { type: 'number', description: 'Max results (default 5, max 10)' },
    },
    required: ['query'],
  },
  isReadOnly: true,
  isDestructive: false,

  async execute(input: WebSearchInput, _ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now();
    try {
      const maxResults = Math.min(Math.max(input.max_results ?? 5, 1), 10);
      const results = await runSearch(input.query, maxResults);
      if (results.length === 0) {
        return {
          success: true,
          output: `No results for: "${input.query}"`,
          duration: Date.now() - start,
        };
      }
      const today = new Date().toISOString().slice(0, 10);
      let out = `Web search results for "${input.query}" (as of ${today}):\n\n`;
      results.forEach((r, i) => {
        out += `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.content}\n\n`;
      });
      return { success: true, output: out.trim(), duration: Date.now() - start };
    } catch (err: any) {
      return {
        success: false,
        output: '',
        error: err.message || String(err),
        duration: Date.now() - start,
      };
    }
  },
};

// ── Web Fetch Tool ──────────────────────────────────────────────────────────

interface WebFetchInput {
  url: string;
  max_chars?: number;
}

const BLOCKED_HOSTS = new Set([
  'localhost', '127.0.0.1', '0.0.0.0', '::1',
  'metadata.google.internal', '169.254.169.254',
]);

function isBlockedUrl(urlStr: string): string | null {
  try {
    const u = new URL(urlStr);
    if (!['http:', 'https:'].includes(u.protocol)) {
      return 'Only http/https URLs are allowed';
    }
    const host = u.hostname.toLowerCase();
    if (BLOCKED_HOSTS.has(host)) return 'Local/metadata hosts are blocked';
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
      return 'Private network addresses are blocked';
    }
    return null;
  } catch {
    return 'Invalid URL';
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const WebFetchTool: ToolDefinition<WebFetchInput> = {
  name: 'web_fetch',
  description:
    'Fetch a web page and return its text content. Use after web_search to read a specific URL. Private/local addresses are blocked.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Full http(s) URL to fetch' },
      max_chars: { type: 'number', description: 'Max characters to return (default 15000, max 50000)' },
    },
    required: ['url'],
  },
  isReadOnly: true,
  isDestructive: false,

  async execute(input: WebFetchInput, ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now();
    const blocked = isBlockedUrl(input.url);
    if (blocked) {
      return { success: false, output: '', error: blocked, duration: Date.now() - start };
    }

    const maxChars = Math.min(Math.max(input.max_chars ?? 15000, 1000), 50000);

    try {
      const resp = await fetch(input.url, {
        signal: AbortSignal.any([
          ctx.abortSignal,
          AbortSignal.timeout(20000),
        ]),
        headers: {
          'User-Agent': 'OpenChat/2.0 (AI coding assistant; +https://github.com/openchat)',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
        },
        redirect: 'follow',
      });

      if (!resp.ok) {
        return {
          success: false,
          output: '',
          error: `HTTP ${resp.status} fetching ${input.url}`,
          duration: Date.now() - start,
        };
      }

      const contentType = resp.headers.get('content-type') || '';
      const raw = await resp.text();
      let text: string;
      if (contentType.includes('html') || raw.trimStart().startsWith('<')) {
        text = htmlToText(raw);
      } else {
        text = raw;
      }

      if (text.length > maxChars) {
        text = text.slice(0, maxChars) + `\n\n...[truncated to ${maxChars} chars]`;
      }

      return {
        success: true,
        output: `URL: ${input.url}\nContent-Type: ${contentType}\n\n${text}`,
        duration: Date.now() - start,
      };
    } catch (err: any) {
      return {
        success: false,
        output: '',
        error: err.message || String(err),
        duration: Date.now() - start,
      };
    }
  },
};
