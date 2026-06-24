// ============================================================================
// Web Search Client — Tavily API integration
// ============================================================================

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

export interface SearchResponse {
  results: SearchResult[];
}

/**
 * Perform a web search using the Tavily API
 * @param query   The user's query
 * @param apiKey  The Tavily API key
 * @returns       A formatted markdown context containing search snippets
 */
export async function searchWeb(query: string, apiKey: string): Promise<string> {
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('Tavily API key is missing. Please configure it in Settings.');
  }

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      api_key: apiKey,
      query: query,
      search_depth: 'basic',
      include_answer: false,
      max_results: 3,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Search API returned status ${response.status}: ${errorBody}`);
  }

  const data: SearchResponse = await response.json();

  if (!data.results || data.results.length === 0) {
    return 'No search results found.';
  }

  // Format into markdown context
  let formatted = `[System Information: Real-Time Web Search Context]\n`;
  formatted += `The following are the top search results for the query: "${query}"\n\n`;

  data.results.forEach((res, idx) => {
    formatted += `[Result #${idx + 1}]\n`;
    formatted += `- Title: ${res.title}\n`;
    formatted += `- URL: ${res.url}\n`;
    formatted += `- Snippet: ${res.content}\n\n`;
  });

  formatted += `Please incorporate this information in your response to accurately and dynamically answer the user's request.`;

  return formatted;
}
