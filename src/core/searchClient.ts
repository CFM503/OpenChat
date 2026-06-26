// ============================================================================
// Web Search Client — Multi-provider search (Tavily, SerpAPI, Bing, SearXNG)
// ============================================================================

import type { SearchProvider } from './types';

export interface SearchProviderConfig {
  provider: SearchProvider;
  apiKey: string;
  baseUrl?: string;
}

/**
 * Perform a web search using the configured provider.
 * Returns a formatted markdown string for injection into the LLM context.
 */
export async function searchWeb(query: string, config: SearchProviderConfig): Promise<string> {
  const results = await fetchResults(query, config);

  if (results.length === 0) {
    return 'No search results found.';
  }

  let formatted = `[System Information: Real-Time Web Search Context]\n`;
  formatted += `The following are the top search results for the query: "${query}"\n\n`;

  results.forEach((res, idx) => {
    formatted += `[Result #${idx + 1}]\n`;
    formatted += `- Title: ${res.title}\n`;
    formatted += `- URL: ${res.url}\n`;
    formatted += `- Snippet: ${res.content}\n\n`;
  });

  formatted += `Please incorporate this information in your response to accurately and dynamically answer the user's request.`;

  return formatted;
}

// --- Internal ---

interface SearchResult {
  title: string;
  url: string;
  content: string;
}

async function fetchResults(query: string, config: SearchProviderConfig): Promise<SearchResult[]> {
  switch (config.provider) {
    case 'tavily':
      return tavilySearch(query, config.apiKey);
    case 'serpapi':
      return serpapiSearch(query, config.apiKey);
    case 'bing':
      return bingSearch(query, config.apiKey);
    case 'searxng':
      return searxngSearch(query, config.baseUrl || 'http://localhost:8888');
    default:
      throw new Error(`Unknown search provider: ${config.provider}`);
  }
}

// --- Tavily ---

async function tavilySearch(query: string, apiKey: string): Promise<SearchResult[]> {
  if (!apiKey?.trim()) throw new Error('Tavily API key is missing. Please configure it in Settings.');

  const resp = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      include_answer: false,
      max_results: 3,
    }),
  });

  if (!resp.ok) throw new Error(`Tavily error (${resp.status}): ${await resp.text()}`);

  const data = await resp.json();
  return (data.results || []).map((r: any) => ({
    title: r.title,
    url: r.url,
    content: r.content,
  }));
}

// --- SerpAPI ---

async function serpapiSearch(query: string, apiKey: string): Promise<SearchResult[]> {
  if (!apiKey?.trim()) throw new Error('SerpAPI key is missing. Please configure it in Settings.');

  const params = new URLSearchParams({
    q: query,
    api_key: apiKey,
    engine: 'google',
    num: '3',
  });

  const resp = await fetch(`https://serpapi.com/search.json?${params}`);

  if (!resp.ok) throw new Error(`SerpAPI error (${resp.status}): ${await resp.text()}`);

  const data = await resp.json();
  return (data.organic_results || []).slice(0, 3).map((r: any) => ({
    title: r.title,
    url: r.link,
    content: r.snippet || '',
  }));
}

// --- Bing Search ---

async function bingSearch(query: string, apiKey: string): Promise<SearchResult[]> {
  if (!apiKey?.trim()) throw new Error('Bing API key is missing. Please configure it in Settings.');

  const params = new URLSearchParams({ q: query, count: '3' });
  const resp = await fetch(`https://api.bing.microsoft.com/v7.0/search?${params}`, {
    headers: { 'Ocp-Apim-Subscription-Key': apiKey },
  });

  if (!resp.ok) throw new Error(`Bing error (${resp.status}): ${await resp.text()}`);

  const data = await resp.json();
  return (data.webPages?.value || []).slice(0, 3).map((r: any) => ({
    title: r.name,
    url: r.url,
    content: r.snippet || '',
  }));
}

// --- SearXNG (self-hosted) ---

async function searxngSearch(query: string, baseUrl: string): Promise<SearchResult[]> {
  const url = `${baseUrl.replace(/\/+$/, '')}/search?${new URLSearchParams({
    q: query,
    format: 'json',
    pageno: '1',
  })}`;

  const resp = await fetch(url);

  if (!resp.ok) throw new Error(`SearXNG error (${resp.status}): ${await resp.text()}`);

  const data = await resp.json();
  return (data.results || []).slice(0, 3).map((r: any) => ({
    title: r.title,
    url: r.url,
    content: r.content || '',
  }));
}
