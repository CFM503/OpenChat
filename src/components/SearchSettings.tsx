// ============================================================================
// SearchSettings Component — Web search provider configuration
// ============================================================================

import React from 'react';
import type { SearchProvider } from '../core/types';

interface SearchSettingsProps {
  searchProvider: SearchProvider;
  searchApiKey: string;
  searchBaseUrl: string;
  onUpdateSearchProvider: (provider: SearchProvider) => void;
  onUpdateSearchApiKey: (key: string) => void;
  onUpdateSearchBaseUrl: (url: string) => void;
}

export function SearchSettings({
  searchProvider,
  searchApiKey,
  searchBaseUrl,
  onUpdateSearchProvider,
  onUpdateSearchApiKey,
  onUpdateSearchBaseUrl,
}: SearchSettingsProps) {
  return (
    <div>
      <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px' }}>🔍 Web Search</h3>
      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
        Enable real-time web search to give AI access to up-to-date information.
      </p>

      <div className="form-group">
        <label className="form-label" htmlFor="search-provider-select">
          Search Provider
        </label>
        <select
          className="form-input"
          id="search-provider-select"
          value={searchProvider}
          onChange={e => onUpdateSearchProvider(e.target.value as SearchProvider)}
        >
          <option value="tavily">Tavily</option>
          <option value="serpapi">SerpAPI (Google)</option>
          <option value="bing">Bing Search</option>
          <option value="searxng">SearXNG (Self-hosted)</option>
        </select>
      </div>

      {searchProvider !== 'searxng' ? (
        <div className="form-group">
          <label className="form-label" htmlFor="search-key-input">
            API Key
          </label>
          <input
            type="password"
            className="form-input"
            id="search-key-input"
            value={searchApiKey}
            onChange={e => onUpdateSearchApiKey(e.target.value)}
            placeholder={`Enter your ${searchProvider === 'tavily' ? 'Tavily' : searchProvider === 'serpapi' ? 'SerpAPI' : 'Bing'} API Key...`}
          />
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px', display: 'block' }}>
            {searchProvider === 'tavily' && <>💡 Get a free key (1,000 queries/month) at <a href="https://tavily.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-info)' }}>tavily.com</a></>}
            {searchProvider === 'serpapi' && <>💡 Get a free key (100 searches/month) at <a href="https://serpapi.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-info)' }}>serpapi.com</a></>}
            {searchProvider === 'bing' && <>💡 Get a free key at <a href="https://www.microsoft.com/en-us/bing/apis/bing-web-search-api" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-info)' }}>Microsoft Azure</a></>}
          </span>
        </div>
      ) : (
        <div className="form-group">
          <label className="form-label" htmlFor="search-base-url-input">
            SearXNG Instance URL
          </label>
          <input
            type="text"
            className="form-input"
            id="search-base-url-input"
            value={searchBaseUrl}
            onChange={e => onUpdateSearchBaseUrl(e.target.value)}
            placeholder="http://localhost:8888"
          />
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px', display: 'block' }}>
            💡 Enter your SearXNG instance URL. Must have JSON format enabled. See <a href="https://docs.searxng.org/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-info)' }}>searxng.org</a>
          </span>
        </div>
      )}
    </div>
  );
}
