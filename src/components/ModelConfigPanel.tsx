// ============================================================================
// ModelConfigPanel Component
// Enables configuring models, endpoints, keys, and routing behavior
// ============================================================================

import React, { useState } from 'react';
import type { ModelConfig, ModelProvider, SearchProvider } from '../core/types';
import { ModelRouter, normalizeEndpoint } from '../core/modelRouter';

interface ModelConfigPanelProps {
  models: ModelConfig[];
  activeModelId: string | null;
  onAddModel: (config: ModelConfig) => void;
  onUpdateModel: (config: ModelConfig) => void;
  onDeleteModel: (id: string) => void;
  onSetActive: (id: string) => void;
  searchProvider: SearchProvider;
  searchApiKey: string;
  searchBaseUrl: string;
  onUpdateSearchProvider: (provider: SearchProvider) => void;
  onUpdateSearchApiKey: (key: string) => void;
  onUpdateSearchBaseUrl: (url: string) => void;
}

export function ModelConfigPanel({
  models,
  activeModelId,
  onAddModel,
  onUpdateModel,
  onDeleteModel,
  onSetActive,
  searchProvider,
  searchApiKey,
  searchBaseUrl,
  onUpdateSearchProvider,
  onUpdateSearchApiKey,
  onUpdateSearchBaseUrl,
}: ModelConfigPanelProps) {
  // Form states
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formId, setFormId] = useState('');
  const [formName, setFormName] = useState('');
  const [formProvider, setFormProvider] = useState<ModelProvider>('openai');
  const [formEndpoint, setFormEndpoint] = useState('');
  const [formApiKey, setFormApiKey] = useState('');
  const [formModel, setFormModel] = useState('');
  const [formMaxTokens, setFormMaxTokens] = useState(4096);
  const [formTemperature, setFormTemperature] = useState(0.7);
  const [formIsDefault, setFormIsDefault] = useState(false);

  const [errors, setErrors] = useState<string[]>([]);

  const handleProviderChange = (provider: ModelProvider) => {
    setFormProvider(provider);
    if (provider === 'openai') {
      setFormEndpoint('https://api.openai.com/v1/chat/completions');
      setFormModel('gpt-4o');
    } else if (provider === 'ollama') {
      setFormEndpoint('http://localhost:11434/api/chat');
      setFormModel('llama3');
    } else {
      setFormEndpoint('');
      setFormModel('');
    }
  };

  const handleEdit = (model: ModelConfig) => {
    setIsEditing(true);
    setEditingId(model.id);
    setFormId(model.id);
    setFormName(model.name);
    setFormProvider(model.provider);
    setFormEndpoint(model.endpoint);
    setFormApiKey(model.apiKey || '');
    setFormModel(model.model);
    setFormMaxTokens(model.maxTokens);
    setFormTemperature(model.temperature);
    setFormIsDefault(model.isDefault);
    setErrors([]);
  };

  const handleAddNew = () => {
    setIsEditing(true);
    setEditingId(null);
    setFormId(`model_${Date.now()}`);
    setFormName('');
    setFormProvider('openai');
    setFormEndpoint('https://api.openai.com/v1/chat/completions');
    setFormApiKey('');
    setFormModel('gpt-4o');
    setFormMaxTokens(4096);
    setFormTemperature(0.7);
    setFormIsDefault(false);
    setErrors([]);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const config: ModelConfig = {
      id: formId,
      name: formName,
      provider: formProvider,
      endpoint: formEndpoint,
      apiKey: formApiKey || undefined,
      model: formModel,
      maxTokens: formMaxTokens,
      temperature: formTemperature,
      isDefault: formIsDefault,
    };

    const validationErrors = ModelRouter.validateConfig(config);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    if (editingId) {
      onUpdateModel(config);
    } else {
      onAddModel(config);
    }

    setIsEditing(false);
    setEditingId(null);
    setErrors([]);
  };

  return (
    <div className="model-config-panel">
      {!isEditing ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Active Model Routes</h3>
            <button className="btn-primary" onClick={handleAddNew} id="btn-add-model-open">
              Add Model
            </button>
          </div>

          <div className="model-list" id="model-config-list">
            {models.map(m => (
              <div
                key={m.id}
                className={`model-config-item ${m.id === activeModelId ? 'active' : ''}`}
                onClick={() => onSetActive(m.id)}
                style={{ cursor: 'pointer' }}
              >
                <div className="model-item-details">
                  <span className="model-item-title">
                    {m.name}
                    {m.isDefault && <span className="logo-badge" style={{ fontSize: '0.65rem' }}>Default</span>}
                  </span>
                  <span className="model-item-subtitle">
                    Provider: {m.provider} | Model: {m.model}
                  </span>
                  <span className="model-item-subtitle" style={{ fontSize: '0.75rem', opacity: 0.7 }}>
                    Endpoint: {m.endpoint}
                  </span>
                </div>
                <div className="model-item-actions" onClick={e => e.stopPropagation()}>
                  <button className="btn-ghost" onClick={() => handleEdit(m)} style={{ padding: '4px 8px' }}>
                    Edit
                  </button>
                  {models.length > 1 && (
                    <button
                      className="btn-ghost"
                      onClick={() => onDeleteModel(m.id)}
                      style={{ color: 'var(--color-error)', padding: '4px 8px' }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid rgba(148, 163, 184, 0.1)' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '12px' }}>Search Configurations</h3>
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
              <div className="form-group" style={{ marginBottom: 0 }}>
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
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px', display: 'block' }}>
                  {searchProvider === 'tavily' && <>💡 Get a free key (1,000 queries/month) at <a href="https://tavily.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-info)' }}>tavily.com</a></>}
                  {searchProvider === 'serpapi' && <>💡 Get a free key (100 searches/month) at <a href="https://serpapi.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-info)' }}>serpapi.com</a></>}
                  {searchProvider === 'bing' && <>💡 Get a free key at <a href="https://www.microsoft.com/en-us/bing/apis/bing-web-search-api" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-info)' }}>Microsoft Azure</a></>}
                </span>
              </div>
            ) : (
              <div className="form-group" style={{ marginBottom: 0 }}>
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
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px', display: 'block' }}>
                  💡 Enter your SearXNG instance URL. Must have JSON format enabled. See <a href="https://docs.searxng.org/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-info)' }}>searxng.org</a>
                </span>
              </div>
            )}
          </div>
        </>
      ) : (
        <form onSubmit={handleFormSubmit} className="model-form" id="model-config-form">
          <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>
            {editingId ? 'Edit Model Routing' : 'Create Custom Route'}
          </h3>

          {errors.length > 0 && (
            <div className="error-list">
              {errors.map((err, idx) => (
                <div key={idx}>• {err}</div>
              ))}
            </div>
          )}

          <div className="form-group">
            <label>Model Configuration Name</label>
            <input
              type="text"
              className="form-input"
              value={formName}
              onChange={e => setFormName(e.target.value)}
              placeholder="e.g. My Custom Llama"
              required
              id="model-name-input"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Provider Type</label>
              <select
                className="form-select"
                value={formProvider}
                onChange={e => handleProviderChange(e.target.value as ModelProvider)}
                id="model-provider-select"
              >
                <option value="openai">OpenAI</option>
                <option value="ollama">Ollama (Local)</option>
                <option value="custom">Custom Endpoint</option>
              </select>
            </div>
            <div className="form-group">
              <label>Model Identifier</label>
              <input
                type="text"
                className="form-input"
                value={formModel}
                onChange={e => setFormModel(e.target.value)}
                placeholder="e.g. gpt-4o, llama3"
                required
                id="model-identifier-input"
              />
            </div>
          </div>

          <div className="form-group">
            <label>API Endpoint URL</label>
            <input
              type="text"
              className="form-input"
              value={formEndpoint}
              onChange={e => setFormEndpoint(e.target.value)}
              onBlur={() => {
                if (formProvider !== 'ollama' && formEndpoint.trim()) {
                  setFormEndpoint(normalizeEndpoint(formEndpoint));
                }
              }}
              placeholder="https://api.example.com/v1"
              required
              id="model-endpoint-input"
            />
            {formProvider !== 'ollama' && formEndpoint.trim() && !formEndpoint.includes('/chat/completions') && (
              <span style={{ fontSize: '0.75rem', color: 'var(--color-info)', marginTop: '4px' }}>
                💡 Will auto-complete to: {normalizeEndpoint(formEndpoint)}
              </span>
            )}
          </div>

          {formProvider !== 'ollama' && (
            <div className="form-group">
              <label>API Key</label>
              <input
                type="password"
                className="form-input"
                value={formApiKey}
                onChange={e => setFormApiKey(e.target.value)}
                placeholder="API Key / Token..."
                id="model-apikey-input"
              />
            </div>
          )}

          <div className="form-row">
            <div className="form-group">
              <label>Max Predict Tokens ({formMaxTokens})</label>
              <input
                type="range"
                min="256"
                max="16384"
                step="256"
                value={formMaxTokens}
                onChange={e => setFormMaxTokens(parseInt(e.target.value))}
                style={{ accentColor: 'var(--accent-color)' }}
                id="model-maxtokens-input"
              />
            </div>
            <div className="form-group">
              <label>Temperature ({formTemperature.toFixed(2)})</label>
              <input
                type="range"
                min="0.0"
                max="2.0"
                step="0.05"
                value={formTemperature}
                onChange={e => setFormTemperature(parseFloat(e.target.value))}
                style={{ accentColor: 'var(--accent-color)' }}
                id="model-temp-input"
              />
            </div>
          </div>

          <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={formIsDefault}
              onChange={e => setFormIsDefault(e.target.checked)}
              id="model-isdefault-checkbox"
            />
            <label htmlFor="model-isdefault-checkbox" style={{ cursor: 'pointer' }}>
              Set as provider default
            </label>
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setIsEditing(false);
                setEditingId(null);
              }}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary" id="model-submit-btn">
              Save Route
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
