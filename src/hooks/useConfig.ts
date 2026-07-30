import { useState, useEffect, useRef, useCallback } from 'react';
import type { ModelConfig, SearchProvider } from '../core/types';
import { ModelRouter, DEFAULT_MODELS } from '../core/modelRouter';
import { apiUrl } from '../lib/apiBase';
import { backendClient } from '../services/api';
import {
  OPENCHAT_CONFIG_DEFAULTS,
  autoPickAgentRouting,
} from '../../server/src/configManager';

function loadJson<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function useConfig() {
  const [models, setModels] = useState<ModelConfig[]>(() =>
    loadJson('openchat_models', [...DEFAULT_MODELS]),
  );
  const [activeModelId, setActiveModelId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('openchat_active_model_id');
      const list = loadJson<ModelConfig[]>('openchat_models', DEFAULT_MODELS);
      if (saved && list.some(m => m.id === saved)) return saved;
      return list[0]?.id ?? '';
    } catch {
      return DEFAULT_MODELS[0]?.id ?? '';
    }
  });
  const [webSearchEnabled, setWebSearchEnabled] = useState(
    () => localStorage.getItem('openchat_web_search_enabled') === 'true',
  );
  const [searchProvider, setSearchProvider] = useState<SearchProvider>(
    () => (localStorage.getItem('openchat_search_provider') as SearchProvider) || 'tavily',
  );
  const [searchApiKey, setSearchApiKey] = useState(
    () =>
      localStorage.getItem('openchat_search_api_key') ||
      localStorage.getItem('openchat_tavily_key') ||
      '',
  );
  const [searchBaseUrl, setSearchBaseUrl] = useState(
    () => localStorage.getItem('openchat_search_base_url') || 'http://localhost:8888',
  );
  const [proxyUrl, setProxyUrl] = useState(
    () => localStorage.getItem('openchat_proxy_url') || '',
  );
  const [proxyEnabled, setProxyEnabled] = useState(
    () => localStorage.getItem('openchat_proxy_enabled') === 'true',
  );
  const [allowedDirectories, setAllowedDirectories] = useState<string[]>(() =>
    loadJson('openchat_allowed_dirs', []),
  );
  const [cheapModelId, setCheapModelId] = useState(
    () => localStorage.getItem('openchat_cheap_model_id') || '',
  );
  const [codingModelId, setCodingModelId] = useState(
    () => localStorage.getItem('openchat_coding_model_id') || '',
  );
  /** Stage file writes for Apply (default true) */
  const [requireFileApply, setRequireFileApply] = useState(() => {
    const s = localStorage.getItem('openchat_require_file_apply');
    return s === null ? true : s === 'true';
  });
  /** Create Task Board cards from chat turns (default true) */
  const [chatTaskBridge, setChatTaskBridge] = useState(() => {
    const s = localStorage.getItem('openchat_chat_task_bridge');
    return s === null ? true : s === 'true';
  });
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);
  const modelRouterRef = useRef(new ModelRouter(models));

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch(apiUrl('/api/config'));
        const ct = response.headers.get('content-type') || '';
        if (response.ok && ct.includes('application/json')) {
          const config = await response.json();
          if (config && Object.keys(config).length > 0) {
            if (config.models) {
              setModels(config.models);
              modelRouterRef.current = new ModelRouter(config.models);
            }
            if (config.activeModelId) setActiveModelId(config.activeModelId);
            if (config.webSearchEnabled !== undefined) setWebSearchEnabled(config.webSearchEnabled);
            if (config.searchProvider !== undefined) setSearchProvider(config.searchProvider);
            if (config.searchApiKey !== undefined) setSearchApiKey(config.searchApiKey);
            else if (config.tavilyApiKey !== undefined) setSearchApiKey(config.tavilyApiKey);
            if (config.searchBaseUrl !== undefined) setSearchBaseUrl(config.searchBaseUrl);
            if (config.proxyUrl !== undefined) setProxyUrl(config.proxyUrl);
            if (config.proxyEnabled !== undefined) setProxyEnabled(config.proxyEnabled);
            if (config.allowedDirectories) setAllowedDirectories(config.allowedDirectories);
            if (config.agentRouting?.cheapModelId) setCheapModelId(config.agentRouting.cheapModelId);
            if (config.agentRouting?.codingModelId) setCodingModelId(config.agentRouting.codingModelId);
            // Server withConfigDefaults: undefined → recommended true
            setRequireFileApply(config.requireFileApply !== false);
            setChatTaskBridge(config.chatTaskBridge !== false);

            // If routing still empty after load, heuristic-pick from model list
            const list = config.models || [];
            if (list.length && !config.agentRouting?.cheapModelId && !config.agentRouting?.codingModelId) {
              const picked = autoPickAgentRouting(list, config.activeModelId);
              if (picked.cheapModelId) setCheapModelId(picked.cheapModelId);
              if (picked.codingModelId) setCodingModelId(picked.codingModelId);
            }
          }
        }
      } catch {
        console.warn('Backend not available, using localStorage config');
      } finally {
        setIsConfigLoaded(true);
      }
    })();
  }, []);

  // First local-only load: apply recommended routing heuristics once models exist
  useEffect(() => {
    if (!isConfigLoaded || !models.length) return;
    if (cheapModelId || codingModelId) return;
    const picked = autoPickAgentRouting(models, activeModelId);
    if (picked.cheapModelId) setCheapModelId(picked.cheapModelId);
    if (picked.codingModelId) setCodingModelId(picked.codingModelId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once when config ready
  }, [isConfigLoaded]);

  useEffect(() => {
    if (!isConfigLoaded) return;
    localStorage.setItem('openchat_models', JSON.stringify(models));
    localStorage.setItem('openchat_active_model_id', activeModelId);
    localStorage.setItem('openchat_web_search_enabled', String(webSearchEnabled));
    localStorage.setItem('openchat_search_provider', searchProvider);
    localStorage.setItem('openchat_search_api_key', searchApiKey);
    localStorage.setItem('openchat_search_base_url', searchBaseUrl);
    localStorage.setItem('openchat_proxy_url', proxyUrl);
    localStorage.setItem('openchat_proxy_enabled', String(proxyEnabled));
    localStorage.setItem('openchat_allowed_dirs', JSON.stringify(allowedDirectories));
    localStorage.setItem('openchat_cheap_model_id', cheapModelId);
    localStorage.setItem('openchat_coding_model_id', codingModelId);
    localStorage.setItem('openchat_require_file_apply', String(requireFileApply));
    localStorage.setItem('openchat_chat_task_bridge', String(chatTaskBridge));

    const timer = setTimeout(async () => {
      try {
        const agentRouting =
          cheapModelId || codingModelId
            ? {
                ...(cheapModelId ? { cheapModelId } : {}),
                ...(codingModelId ? { codingModelId } : {}),
              }
            : undefined;
        if (!backendClient.isConnected()) return;
        await fetch(apiUrl('/api/config'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            models,
            activeModelId,
            webSearchEnabled,
            searchProvider,
            searchApiKey,
            searchBaseUrl,
            proxyUrl,
            proxyEnabled,
            allowedDirectories,
            agentRouting,
            requireFileApply,
            chatTaskBridge,
            defaultContextStrategy: OPENCHAT_CONFIG_DEFAULTS.defaultContextStrategy,
          }),
        });
      } catch (err) {
        console.error('Failed to save config:', err);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [
    models, activeModelId, webSearchEnabled, searchProvider, searchApiKey,
    searchBaseUrl, proxyUrl, proxyEnabled, allowedDirectories, cheapModelId,
    codingModelId, requireFileApply, chatTaskBridge, isConfigLoaded,
  ]);

  const handleAddModel = useCallback((cfg: ModelConfig) => {
    modelRouterRef.current.addModel(cfg);
    setModels(modelRouterRef.current.getAllModels());
  }, []);

  const handleUpdateModel = useCallback((cfg: ModelConfig) => {
    modelRouterRef.current.addModel(cfg);
    setModels(modelRouterRef.current.getAllModels());
  }, []);

  const handleDeleteModel = useCallback(
    (id: string) => {
      modelRouterRef.current.removeModel(id);
      setModels(modelRouterRef.current.getAllModels());
      if (activeModelId === id) {
        const remaining = modelRouterRef.current.getAllModels();
        setActiveModelId(remaining[0]?.id ?? '');
      }
    },
    [activeModelId],
  );

  const hasSearchKey =
    searchProvider === 'searxng' ? !!searchBaseUrl.trim() : !!searchApiKey.trim();

  /**
   * One-click: re-apply product recommended defaults (cache_max, Apply, task bridge,
   * auto cheap/coding pick, soft model field fills). Does not wipe API keys.
   */
  const applyRecommendedDefaults = useCallback(() => {
    setRequireFileApply(true);
    setChatTaskBridge(true);

    setModels(prev => {
      const next = prev.map(m => {
        const isLocal =
          m.provider === 'ollama' ||
          /11434|localhost:1234|ollama/i.test(m.endpoint || '');
        return {
          ...m,
          contextStrategy: (isLocal ? 'balanced' : 'cache_max') as ModelConfig['contextStrategy'],
          temperature: isLocal ? 0.5 : 0.4,
          maxTokens:
            m.maxTokens > 32_768 ? (isLocal ? 4096 : 8192) : m.maxTokens || (isLocal ? 4096 : 8192),
          contextWindow: m.contextWindow || (isLocal ? 32_000 : 128_000),
        };
      });
      modelRouterRef.current = new ModelRouter(next);
      const picked = autoPickAgentRouting(next, activeModelId);
      setCheapModelId(picked.cheapModelId || '');
      setCodingModelId(picked.codingModelId || '');
      return next;
    });
  }, [activeModelId]);

  return {
    models,
    activeModelId,
    setActiveModelId,
    webSearchEnabled,
    setWebSearchEnabled,
    searchProvider,
    setSearchProvider,
    searchApiKey,
    setSearchApiKey,
    searchBaseUrl,
    setSearchBaseUrl,
    proxyUrl,
    setProxyUrl,
    proxyEnabled,
    setProxyEnabled,
    allowedDirectories,
    setAllowedDirectories,
    cheapModelId,
    setCheapModelId,
    codingModelId,
    setCodingModelId,
    requireFileApply,
    setRequireFileApply,
    chatTaskBridge,
    setChatTaskBridge,
    applyRecommendedDefaults,
    isConfigLoaded,
    modelRouterRef,
    handleAddModel,
    handleUpdateModel,
    handleDeleteModel,
    hasSearchKey,
  };
}
