import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchWeb } from '../core/searchClient';
import type { SearchProviderConfig } from '../core/searchClient';

const tavilyConfig: SearchProviderConfig = { provider: 'tavily', apiKey: 'tavily-key-123' };

describe('searchWeb client helper', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should throw an error if API key is missing', async () => {
    await expect(searchWeb('weather', { provider: 'tavily', apiKey: '' })).rejects.toThrow(
      'Tavily API key is missing'
    );
  });

  it('should format search results correctly on success', async () => {
    const mockResponse = {
      results: [
        {
          title: 'Vite 6 Released',
          url: 'https://vitejs.dev/blog',
          content: 'Vite 6 is now out featuring new environment APIs.',
        },
        {
          title: 'Vite Dev Server',
          url: 'https://vitejs.dev/guide',
          content: 'The Vite dev server starts on port 5173 by default.',
        },
      ],
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchWeb('vite releases', tavilyConfig);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://api.tavily.com/search', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        api_key: 'tavily-key-123',
        query: 'vite releases',
        search_depth: 'basic',
        include_answer: false,
        max_results: 3,
      }),
    }));

    expect(result).toContain('[Result #1]');
    expect(result).toContain('Vite 6 Released');
    expect(result).toContain('https://vitejs.dev/blog');
    expect(result).toContain('Vite 6 is now out');

    expect(result).toContain('[Result #2]');
    expect(result).toContain('Vite Dev Server');
    expect(result).toContain('https://vitejs.dev/guide');
    expect(result).toContain('starts on port 5173');
  });

  it('should return no results message if results list is empty', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchWeb('nonexistent query', tavilyConfig);
    expect(result).toBe('No search results found.');
  });

  it('should throw an error on API response failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized API Key',
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchWeb('query', { provider: 'tavily', apiKey: 'invalid-key' })).rejects.toThrow(
      'Tavily error (401)'
    );
  });
});
