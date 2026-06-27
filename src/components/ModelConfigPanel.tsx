// ============================================================================
// ModelConfigPanel Component
// Provider presets, quick add, model auto-detect, and manual config
// ============================================================================

import React, { useState, useCallback } from 'react';
import type { ModelConfig, ModelProvider } from '../core/types';
import { ModelRouter, normalizeEndpoint, PROVIDER_PRESETS, type ProviderPreset } from '../core/modelRouter';

interface ModelConfigPanelProps {
  models: ModelConfig[];
  activeModelId: string | null;
  onAddModel: (config: ModelConfig) => void;
  onUpdateModel: (config: ModelConfig) => void;
  onDeleteModel: (id: string) => void;
  onSetActive: (id: string) => void;
}

export function ModelConfigPanel({
  models,
  activeModelId,
  onAddModel,
  onUpdateModel,
  onDeleteModel,
  onSetActive,
}: ModelConfigPanelProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showPresets, setShowPresets] = useState(false);

  // Form states
  const [formId, setFormId] = useState('');
  const [formName, setFormName] = useState('');
  const [formProvider, setFormProvider] = useState<ModelProvider>('openai');
  const [formEndpoint, setFormEndpoint] = useState('');
  const [formApiKey, setFormApiKey] = useState('');
  const [formModel, setFormModel] = useState('');
  const [formMaxTokens, setFormMaxTokens] = useState(4096);
  const [formTemperature, setFormTemperature] = useState(0.7);
  const [formIsDefault, setFormIsDefault] = useState(false);
  const [formDisableTools, setFormDisableTools] = useState(false);

  const [errors, setErrors] = useState<string[]>([]);

  // Auto-detect state
  const [detectingModels, setDetectingModels] = useState(false);
  const [detectedModels, setDetectedModels] = useState<string[]>([]);
  const [detectError, setDetectError] = useState('');

  // Apply a preset to the form
  const applyPreset = useCallback((preset: ProviderPreset) => {
    setFormId(`model_${preset.id}_${Date.now()}`);
    setFormName(preset.name);
    setFormProvider(preset.provider);
    setFormEndpoint(preset.endpoint);
    setFormApiKey('');
    setFormModel(preset.model);
    setFormMaxTokens(4096);
    setFormTemperature(0.7);
    setFormIsDefault(false);
    setFormDisableTools(false);
    setDetectedModels([]);
    setDetectError('');
    setErrors([]);
    setIsEditing(true);
    setEditingId(null);
    setShowPresets(false);
  }, []);

  // Auto-detect models from endpoint
  const handleDetectModels = useCallback(async () => {
    if (!formEndpoint.trim()) return;
    setDetectingModels(true);
    setDetectError('');
    setDetectedModels([]);

    // Build the models URL
    let modelsUrl = formEndpoint.trim().replace(/\/+$/, '');
    // Strip /chat/completions if present
    if (modelsUrl.endsWith('/chat/completions')) {
      modelsUrl = modelsUrl.replace('/chat/completions', '/models');
    } else if (modelsUrl.endsWith('/api/chat')) {
      // Ollama
      modelsUrl = modelsUrl.replace('/api/chat', '/api/tags');
    } else {
      modelsUrl = modelsUrl + '/models';
    }

    try {
      const resp = await fetch(`/api/discover-models?url=${encodeURIComponent(modelsUrl)}`, {
        signal: AbortSignal.timeout(10000),
      });
      const data = await resp.json();
      if (data.models && data.models.length > 0) {
        setDetectedModels(data.models);
      } else {
        setDetectError(data.error || 'No models found');
      }
    } catch (err: any) {
      setDetectError(err.message || 'Failed to detect models');
    } finally {
      setDetectingModels(false);
    }
  }, [formEndpoint]);

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
    setFormDisableTools(model.disableTools ?? false);
    setDetectedModels([]);
    setDetectError('');
    setErrors([]);
  };

  const handleAddNew = () => {
    setShowPresets(true);
  };

  const handleManualAdd = () => {
    setIsEditing(true);
    setEditingId(null);
    setFormId(`model_${Date.now()}`);
    setFormName('');
    setFormProvider('openai');
    setFormEndpoint('https://api.openai.com/v1');
    setFormApiKey('');
    setFormModel('');
    setFormMaxTokens(4096);
    setFormTemperature(0.7);
    setFormIsDefault(false);
    setFormDisableTools(false);
    setDetectedModels([]);
    setDetectError('');
    setErrors([]);
    setShowPresets(false);
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
      disableTools: formDisableTools,
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
      {/* ── Model List View ──────────────────────────────────────── */}
      {!isEditing && !showPresets && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Model Routes</h3>
            <button className="btn-primary" onClick={handleAddNew} id="btn-add-model-open">
              + Add Model
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
                    {m.disableTools && <span className="logo-badge" style={{ fontSize: '0.65rem', background: 'var(--bg-surface)' }}>No Tools</span>}
                  </span>
                  <span className="model-item-subtitle">
                    {m.provider} · {m.model || 'auto-detect'}
                  </span>
                  <span className="model-item-subtitle" style={{ fontSize: '0.75rem', opacity: 0.7 }}>
                    {m.endpoint}
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
        </>
      )}

      {/* ── Quick Add / Presets View ─────────────────────────────── */}
      {showPresets && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Add Model — Choose Provider</h3>
            <button className="btn-ghost" onClick={() => setShowPresets(false)}>← Back</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', marginBottom: '16px' }}>
            {PROVIDER_PRESETS.map(preset => (
              <button
                key={preset.id}
                onClick={() => applyPreset(preset)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '12px 14px',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  textAlign: 'left',
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-color)')}
              >
                <span style={{ fontSize: '20px' }}>{preset.icon}</span>
                <div>
                  <div style={{ fontWeight: '600' }}>{preset.name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {preset.needsApiKey ? 'API Key required' : 'Local · No key needed'}
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div style={{ textAlign: 'center', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
            <button className="btn-ghost" onClick={handleManualAdd} style={{ fontSize: '12px' }}>
              Or configure manually →
            </button>
          </div>
        </>
      )}

      {/* ── Edit / Add Form ──────────────────────────────────────── */}
      {isEditing && (
        <form onSubmit={handleFormSubmit} className="model-form" id="model-config-form">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>
              {editingId ? 'Edit Model' : 'Add Model'}
            </h3>
            <button type="button" className="btn-ghost" onClick={() => { setIsEditing(false); setEditingId(null); }}>
              ← Back
            </button>
          </div>

          {errors.length > 0 && (
            <div className="error-list">
              {errors.map((err, idx) => (
                <div key={idx}>• {err}</div>
              ))}
            </div>
          )}

          <div className="form-group">
            <label>Name</label>
            <input
              type="text"
              className="form-input"
              value={formName}
              onChange={e => setFormName(e.target.value)}
              placeholder="e.g. GPT-4o, MiMo Pro"
              required
              id="model-name-input"
            />
          </div>

          <div className="form-group">
            <label>API Endpoint URL</label>
            <input
              type="text"
              className="form-input"
              value={formEndpoint}
              onChange={e => { setFormEndpoint(e.target.value); setDetectedModels([]); }}
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
              <span style={{ fontSize: '11px', color: 'var(--color-info)', marginTop: '4px', display: 'block' }}>
                💡 Will auto-complete to: {normalizeEndpoint(formEndpoint)}
              </span>
            )}
          </div>

          <div className="form-group">
            <label>Model Identifier</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                className="form-input"
                value={formModel}
                onChange={e => setFormModel(e.target.value)}
                placeholder="e.g. gpt-4o, gemini-2.5-flash"
                required
                id="model-identifier-input"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn-ghost"
                onClick={handleDetectModels}
                disabled={detectingModels || !formEndpoint.trim()}
                style={{ whiteSpace: 'nowrap', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: '6px' }}
                title="Auto-detect available models from endpoint"
              >
                {detectingModels ? '...' : '🔍 Detect'}
              </button>
            </div>

            {detectedModels.length > 0 && (
              <div style={{
                marginTop: '6px', padding: '6px',
                background: 'var(--bg-surface)', borderRadius: '6px',
                maxHeight: '150px', overflowY: 'auto',
              }}>
                {detectedModels.map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { setFormModel(m); setDetectedModels([]); }}
                    style={{
                      display: 'block', width: '100%', padding: '4px 8px',
                      background: formModel === m ? 'var(--bg-surface-elevated)' : 'transparent',
                      border: 'none', borderRadius: '4px',
                      color: 'var(--text-primary)', fontSize: '12px',
                      fontFamily: 'var(--font-mono)', textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}

            {detectError && (
              <span style={{ fontSize: '11px', color: 'var(--color-error)', marginTop: '4px', display: 'block' }}>
                ⚠️ {detectError}
              </span>
            )}
          </div>

          <div className="form-group">
            <label>Provider Type</label>
            <select
              className="form-select"
              value={formProvider}
              onChange={e => setFormProvider(e.target.value as ModelProvider)}
              id="model-provider-select"
            >
              <option value="openai">OpenAI</option>
              <option value="ollama">Ollama (Local)</option>
              <option value="custom">Custom Endpoint</option>
            </select>
          </div>

          <div className="form-group">
            <label>API Key</label>
            <input
              type="password"
              className="form-input"
              value={formApiKey}
              onChange={e => setFormApiKey(e.target.value)}
              placeholder="Leave empty for local models (LM Studio, Ollama)"
              id="model-apikey-input"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Max Tokens ({formMaxTokens})</label>
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

          <div style={{ display: 'flex', gap: '16px', marginBottom: '12px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px' }}>
              <input
                type="checkbox"
                checked={formIsDefault}
                onChange={e => setFormIsDefault(e.target.checked)}
              />
              Set as default
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px' }}>
              <input
                type="checkbox"
                checked={formDisableTools}
                onChange={e => setFormDisableTools(e.target.checked)}
              />
              Disable tools
            </label>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn-primary" id="model-submit-btn">
              {editingId ? 'Save Changes' : 'Add Model'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
