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
  interface FormState {
    formId: string;
    formName: string;
    formProvider: ModelProvider;
    formEndpoint: string;
    formApiKey: string;
    formModel: string;
    formMaxTokens: number;
    formTemperature: number;
    formIsDefault: boolean;
    formDisableTools: boolean;
    formUseMaxTokens: boolean;
  }

  const blankForm: FormState = {
    formId: '', formName: '', formProvider: 'openai', formEndpoint: '',
    formApiKey: '', formModel: '', formMaxTokens: 4096, formTemperature: 0.7,
    formIsDefault: false, formDisableTools: false, formUseMaxTokens: true,
  };

  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showPresets, setShowPresets] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm);
  const [errors, setErrors] = useState<string[]>([]);
  const [detectingModels, setDetectingModels] = useState(false);
  const [detectedModels, setDetectedModels] = useState<string[]>([]);
  const [detectError, setDetectError] = useState('');

  const setFormField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  }, []);

  const resetForm = useCallback(() => {
    setDetectedModels([]);
    setDetectError('');
    setErrors([]);
  }, []);

  const applyPreset = useCallback((preset: ProviderPreset) => {
    setFormField('formId', `model_${preset.id}_${Date.now()}`);
    setFormField('formName', preset.name);
    setFormField('formProvider', preset.provider);
    setFormField('formEndpoint', preset.endpoint);
    setFormField('formApiKey', '');
    setFormField('formModel', preset.model);
    setFormField('formMaxTokens', 131072);
    setFormField('formTemperature', 0.7);
    setFormField('formIsDefault', false);
    setFormField('formDisableTools', false);
    resetForm();
    setIsEditing(true);
    setEditingId(null);
    setShowPresets(false);
  }, [setFormField, resetForm]);

  // Auto-detect models from endpoint
  const handleDetectModels = useCallback(async () => {
    if (!form.formEndpoint.trim()) return;
    setDetectingModels(true);
    setDetectError('');
    setDetectedModels([]);

    // Build the models URL
    let modelsUrl = form.formEndpoint.trim().replace(/\/+$/, '');
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
  }, [form.formEndpoint]);

  const handleEdit = (model: ModelConfig) => {
    setIsEditing(true);
    setEditingId(model.id);
    setFormField('formId', model.id);
    setFormField('formName', model.name);
    setFormField('formProvider', model.provider);
    setFormField('formEndpoint', model.endpoint);
    setFormField('formApiKey', model.apiKey || '');
    setFormField('formModel', model.model);
    setFormField('formMaxTokens', model.maxTokens);
    setFormField('formTemperature', model.temperature);
    setFormField('formIsDefault', model.isDefault);
    setFormField('formDisableTools', model.disableTools ?? false);
    setFormField('formUseMaxTokens', model.useMaxTokens ?? true);
    resetForm();
  };

  const handleAddNew = () => {
    setShowPresets(true);
  };

  const handleManualAdd = () => {
    setIsEditing(true);
    setEditingId(null);
    setFormField('formId', `model_${Date.now()}`);
    setFormField('formName', '');
    setFormField('formProvider', 'openai');
    setFormField('formEndpoint', 'https://api.openai.com/v1');
    setFormField('formApiKey', '');
    setFormField('formModel', '');
    setFormField('formMaxTokens', 131072);
    setFormField('formTemperature', 0.7);
    setFormField('formIsDefault', false);
    setFormField('formDisableTools', false);
    setFormField('formUseMaxTokens', true);
    resetForm();
    setShowPresets(false);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const config: ModelConfig = {
      id: form.formId,
      name: form.formName,
      provider: form.formProvider,
      endpoint: form.formEndpoint,
      apiKey: form.formApiKey || undefined,
      model: form.formModel,
      maxTokens: form.formMaxTokens,
      temperature: form.formTemperature,
      isDefault: form.formIsDefault,
      disableTools: form.formDisableTools,
      useMaxTokens: form.formUseMaxTokens,
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
    setForm(blankForm);
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
              value={form.formName}
              onChange={e => setFormField('formName', e.target.value)}
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
              value={form.formEndpoint}
              onChange={e => { setFormField('formEndpoint', e.target.value); setDetectedModels([]); }}
              onBlur={e => {
                if (form.formProvider !== 'ollama' && e.target.value.trim()) {
                  setFormField('formEndpoint', normalizeEndpoint(e.target.value.trim()));
                }
              }}
              placeholder="https://api.example.com/v1"
              required
              id="model-endpoint-input"
            />
            {form.formProvider !== 'ollama' && form.formEndpoint.trim() && !form.formEndpoint.includes('/chat/completions') && (
              <span style={{ fontSize: '11px', color: 'var(--color-info)', marginTop: '4px', display: 'block' }}>
                💡 Will auto-complete to: {normalizeEndpoint(form.formEndpoint)}
              </span>
            )}
          </div>

          <div className="form-group">
            <label>Model Identifier</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                className="form-input"
                value={form.formModel}
                onChange={e => setFormField('formModel', e.target.value)}
                placeholder="e.g. gpt-4o, gemini-2.5-flash"
                required
                id="model-identifier-input"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn-ghost"
                onClick={handleDetectModels}
                disabled={detectingModels || !form.formEndpoint.trim()}
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
                    onClick={() => { setFormField('formModel', m); setDetectedModels([]); }}
                    style={{
                      display: 'block', width: '100%', padding: '4px 8px',
                      background: form.formModel === m ? 'var(--bg-surface-elevated)' : 'transparent',
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
              value={form.formProvider}
              onChange={e => setFormField('formProvider', e.target.value as ModelProvider)}
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
              value={form.formApiKey}
              onChange={e => setFormField('formApiKey', e.target.value)}
              placeholder="Leave empty for local models (LM Studio, Ollama)"
              id="model-apikey-input"
            />
          </div>

          <div className="form-row">
            <div className="form-group" style={{ minWidth: 0 }}>
              <label>Max Tokens ({form.formMaxTokens.toLocaleString()})</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="range"
                  min="4096"
                  max="1048576"
                  step="4096"
                  value={form.formMaxTokens}
                  onChange={e => setFormField('formMaxTokens', parseInt(e.target.value))}
                  disabled={!form.formUseMaxTokens}
                  style={{ accentColor: 'var(--accent-color)', flex: 1 }}
                  id="model-maxtokens-input"
                />
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setFormField('formMaxTokens', Math.max(4096, form.formMaxTokens - 4096))}
                  disabled={!form.formUseMaxTokens}
                  style={{ padding: '4px 10px', fontSize: '16px', lineHeight: 1, minWidth: '32px', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: form.formUseMaxTokens ? 'pointer' : 'not-allowed', opacity: form.formUseMaxTokens ? 1 : 0.4 }}
                  title="Decrease by 4096"
                >
                  −
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setFormField('formMaxTokens', Math.min(1048576, form.formMaxTokens + 4096))}
                  disabled={!form.formUseMaxTokens}
                  style={{ padding: '4px 10px', fontSize: '16px', lineHeight: 1, minWidth: '32px', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: form.formUseMaxTokens ? 'pointer' : 'not-allowed', opacity: form.formUseMaxTokens ? 1 : 0.4 }}
                  title="Increase by 4096"
                >
                  +
                </button>
              </div>
            </div>
            <div className="form-group">
              <label>Temperature ({form.formTemperature.toFixed(2)})</label>
              <input
                type="range"
                min="0.0"
                max="2.0"
                step="0.05"
                value={form.formTemperature}
                onChange={e => setFormField('formTemperature', parseFloat(e.target.value))}
                style={{ accentColor: 'var(--accent-color)' }}
                id="model-temp-input"
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '16px', marginBottom: '12px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px' }}>
              <input
                type="checkbox"
                checked={form.formIsDefault}
                onChange={e => setFormField('formIsDefault', e.target.checked)}
              />
              Set as default
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px' }}>
              <input
                type="checkbox"
                checked={form.formDisableTools}
                onChange={e => setFormField('formDisableTools', e.target.checked)}
              />
              Disable tools
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px' }}>
              <input
                type="checkbox"
                checked={form.formUseMaxTokens}
                onChange={e => setFormField('formUseMaxTokens', e.target.checked)}
              />
              Fixed max tokens
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
