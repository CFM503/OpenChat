# Multi-Provider Web Search

## Goal
Replace the single Tavily search integration with a multi-provider search system. Users can choose between Tavily, SerpAPI, Bing Search API, and SearXNG (self-hosted).

## Design

### Search Provider Interface
```ts
type SearchProvider = 'tavily' | 'serpapi' | 'bing' | 'searxng';

interface SearchProviderConfig {
  provider: SearchProvider;
  apiKey: string;       // tavily/serpapi/bing use this
  baseUrl?: string;     // searxng uses this (e.g. http://localhost:8888)
}
```

All providers return the same `searchWeb()` result: a formatted markdown string.

### Files to Change

1. **`src/core/searchClient.ts`** — Add `serpapiSearch()`, `bingSearch()`, `searxngSearch()` functions. Add unified `searchWeb(query, config)` that dispatches by provider.

2. **`src/core/types.ts`** — Replace `tavilyApiKey?: string` with:
   - `searchProvider?: SearchProvider`
   - `searchApiKey?: string`
   - `searchBaseUrl?: string` (for SearXNG)

3. **`src/App.tsx`** — Replace `tavilyApiKey` state with `searchConfig` object. Update localStorage keys, backend sync, and `handleSendMessage` search block.

4. **`src/components/ModelConfigPanel.tsx`** — Replace single Tavily key input with:
   - Provider dropdown (Tavily / SerpAPI / Bing / SearXNG)
   - API key input (shown for tavily/serpapi/bing)
   - Base URL input (shown for SearXNG)
   - Help text per provider with signup links

5. **`src/components/ChatPanel.tsx`** — Update `hasSearchKey` check to work with new config shape. No visual change needed.

6. **`src/test/searchClient.test.ts`** — Update tests for new function signatures.

### Provider API Formats

| Provider | Endpoint | Auth | Response |
|----------|----------|------|----------|
| Tavily | `POST api.tavily.com/search` | `api_key` in body | `{ results: [{ title, url, content }] }` |
| SerpAPI | `GET serpapi.com/search` | `api_key` query param | `{ organic_results: [{ title, link, snippet }] }` |
| Bing | `GET api.bing.microsoft.com/v7.0/search` | `Ocp-Apim-Subscription-Key` header | `{ webPages: { value: [{ name, url, snippet }] } }` |
| SearXNG | `GET {baseUrl}/search` | none (self-hosted) | `{ results: [{ title, url, content }] }` |

### Implementation Order
1. Update types (`types.ts`)
2. Add provider functions to `searchClient.ts`
3. Update `App.tsx` state and search logic
4. Update `ModelConfigPanel.tsx` UI
5. Update `ChatPanel.tsx` hasSearchKey
6. Update tests
7. Verify: tsc + vitest
