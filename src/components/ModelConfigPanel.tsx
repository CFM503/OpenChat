// ============================================================================
// ModelConfigPanel Component
// Provider presets, quick add, model auto-detect, and manual config
// ============================================================================

import React, { useState, useCallback } from 'react';
import type { ModelConfig, ModelProvider, ContextStrategy, TokenParamStyle, ApiStyle } from '../core/types';
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
    // Advanced multi-provider
    formApiStyle: ApiStyle | '';
    formTokenParam: TokenParamStyle | '';
    formContextWindow: number;
    formContextStrategy: ContextStrategy;
    formTopP: string;
    formSupportsTemperature: boolean;
    formReasoningMode: 'none' | 'enabled' | 'auto';
    formStrictAlternation: boolean;
    formAuthStyle: 'bearer' | 'anthropic-x-api-key' | 'query' | 'none';
    formSkillCatalogMode: 'full' | 'names' | 'off';
    formToolResultMaxChars: number;
    formShowAdvanced: boolean;
  }

  const blankForm: FormState = {
    formId: '', formName: '', formProvider: 'openai', formEndpoint: '',
    formApiKey: '', formModel: '', formMaxTokens: 4096, formTemperature: 0.7,
    formIsDefault: false, formDisableTools: false, formUseMaxTokens: true,
    formApiStyle: '', formTokenParam: '', formContextWindow: 128000,
    formContextStrategy: 'balanced', formTopP: '',
    formSupportsTemperature: true, formReasoningMode: 'none',
    formStrictAlternation: false, formAuthStyle: 'bearer',
    formSkillCatalogMode: 'names', formToolResultMaxChars: 4000,
    formShowAdvanced: false,
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
    const d = preset.defaults || {};
    setForm({
      ...blankForm,
      formId: `model_${preset.id}_${Date.now()}`,
      formName: preset.name,
      formProvider: preset.provider,
      formEndpoint: preset.endpoint,
      formApiKey: '',
      formModel: preset.model,
      formMaxTokens: d.maxTokens ?? 8192,
      formTemperature: d.temperature ?? 0.7,
      formIsDefault: false,
      formDisableTools: d.disableTools ?? false,
      formUseMaxTokens: d.tokenParam !== 'none',
      formApiStyle: d.apiStyle ?? '',
      formTokenParam: d.tokenParam ?? '',
      formContextWindow: d.contextWindow ?? 128000,
      formContextStrategy: d.contextStrategy ?? 'balanced',
      formSupportsTemperature: d.supportsTemperature ?? true,
      formReasoningMode: d.reasoningMode ?? 'none',
      formAuthStyle: d.authStyle ?? 'bearer',
      formSkillCatalogMode: d.skillCatalogMode ?? 'names',
      formToolResultMaxChars: d.toolResultMaxChars ?? 4000,
      formShowAdvanced: false,
    });
    resetForm();
    setIsEditing(true);
    setEditingId(null);
    setShowPresets(false);
  }, [resetForm]);

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
    setForm({
      ...blankForm,
      formId: model.id,
      formName: model.name,
      formProvider: model.provider,
      formEndpoint: model.endpoint,
      formApiKey: model.apiKey || '',
      formModel: model.model,
      formMaxTokens: model.maxTokens,
      formTemperature: model.temperature,
      formIsDefault: model.isDefault,
      formDisableTools: model.disableTools ?? false,
      formUseMaxTokens: model.useMaxTokens ?? (model.tokenParam !== 'none'),
      formApiStyle: model.apiStyle ?? '',
      formTokenParam: model.tokenParam ?? '',
      formContextWindow: model.contextWindow ?? 128000,
      formContextStrategy: model.contextStrategy ?? 'balanced',
      formTopP: model.topP != null ? String(model.topP) : '',
      formSupportsTemperature: model.supportsTemperature ?? true,
      formReasoningMode: model.reasoningMode ?? 'none',
      formStrictAlternation: model.strictAlternation ?? false,
      formAuthStyle: model.authStyle ?? 'bearer',
      formSkillCatalogMode: model.skillCatalogMode ?? 'names',
      formToolResultMaxChars: model.toolResultMaxChars ?? 4000,
      formShowAdvanced: false,
    });
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
      apiStyle: form.formApiStyle || undefined,
      tokenParam: form.formTokenParam || (form.formUseMaxTokens ? undefined : 'none'),
      contextWindow: form.formContextWindow || undefined,
      contextStrategy: form.formContextStrategy,
      topP: form.formTopP !== '' ? parseFloat(form.formTopP) : undefined,
      supportsTemperature: form.formSupportsTemperature,
      reasoningMode: form.formReasoningMode,
      strictAlternation: form.formStrictAlternation || undefined,
      authStyle: form.formAuthStyle,
      skillCatalogMode: form.formSkillCatalogMode,
      toolResultMaxChars: form.formToolResultMaxChars,
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

          {(['cn', 'global', 'local'] as const).map(region => {
            const list = PROVIDER_PRESETS.filter(p => (p.region || 'global') === region);
            if (!list.length) return null;
            const title = region === 'cn' ? '🇨🇳 国内' : region === 'local' ? '🏠 本地' : '🌍 国际';
            return (
              <div key={region} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>{title}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                  {list.map(preset => (
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
                          {preset.needsApiKey ? 'API Key' : 'No key'} · {preset.model || 'auto'}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}

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

          {/* Context strategy — primary token-cost control */}
          <div className="form-group">
            <label>Context strategy (token cost)</label>
            <select
              className="form-select"
              value={form.formContextStrategy}
              onChange={e => setFormField('formContextStrategy', e.target.value as ContextStrategy)}
            >
              <option value="minimal">Minimal — lowest cost (short history, name-only skills)</option>
              <option value="balanced">Balanced — default (truncate tools, drop old turns)</option>
              <option value="full">Full — keep more history (higher cost)</option>
            </select>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
              Packs system + recent turns under a budget; older turns become a compact stub or LLM summary.
            </span>
          </div>

          <button
            type="button"
            className="btn-ghost"
            style={{ marginBottom: 12, fontSize: 12 }}
            onClick={() => setFormField('formShowAdvanced', !form.formShowAdvanced)}
          >
            {form.formShowAdvanced ? '▼' : '▶'} Advanced provider params
          </button>

          {form.formShowAdvanced && (
            <div style={{
              border: '1px solid var(--border-color)',
              borderRadius: 8,
              padding: 12,
              marginBottom: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}>
              <div className="form-row">
                <div className="form-group">
                  <label>API style</label>
                  <select
                    className="form-select"
                    value={form.formApiStyle}
                    onChange={e => setFormField('formApiStyle', e.target.value as ApiStyle | '')}
                  >
                    <option value="">Auto-detect</option>
                    <option value="openai">OpenAI-compatible</option>
                    <option value="anthropic">Anthropic Messages</option>
                    <option value="ollama">Ollama</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Token param</label>
                  <select
                    className="form-select"
                    value={form.formTokenParam}
                    onChange={e => setFormField('formTokenParam', e.target.value as TokenParamStyle | '')}
                  >
                    <option value="">Auto</option>
                    <option value="max_tokens">max_tokens</option>
                    <option value="max_completion_tokens">max_completion_tokens (o1/o3)</option>
                    <option value="num_predict">num_predict (Ollama)</option>
                    <option value="none">Omit</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Context window</label>
                  <input
                    type="number"
                    className="form-input"
                    min={2048}
                    max={2000000}
                    value={form.formContextWindow}
                    onChange={e => setFormField('formContextWindow', parseInt(e.target.value) || 128000)}
                  />
                </div>
                <div className="form-group">
                  <label>Auth style</label>
                  <select
                    className="form-select"
                    value={form.formAuthStyle}
                    onChange={e => setFormField('formAuthStyle', e.target.value as FormState['formAuthStyle'])}
                  >
                    <option value="bearer">Bearer token</option>
                    <option value="anthropic-x-api-key">Anthropic x-api-key</option>
                    <option value="query">Query ?key=</option>
                    <option value="none">None</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Reasoning mode</label>
                  <select
                    className="form-select"
                    value={form.formReasoningMode}
                    onChange={e => setFormField('formReasoningMode', e.target.value as FormState['formReasoningMode'])}
                  >
                    <option value="none">None</option>
                    <option value="auto">Auto (parse reasoning fields)</option>
                    <option value="enabled">Enabled (no temperature)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Skill catalog</label>
                  <select
                    className="form-select"
                    value={form.formSkillCatalogMode}
                    onChange={e => setFormField('formSkillCatalogMode', e.target.value as FormState['formSkillCatalogMode'])}
                  >
                    <option value="names">Names only (cheap)</option>
                    <option value="full">Full descriptions</option>
                    <option value="off">Off</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Top P (optional)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. 0.95"
                    value={form.formTopP}
                    onChange={e => setFormField('formTopP', e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Tool result max chars</label>
                  <input
                    type="number"
                    className="form-input"
                    min={500}
                    max={50000}
                    value={form.formToolResultMaxChars}
                    onChange={e => setFormField('formToolResultMaxChars', parseInt(e.target.value) || 4000)}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={form.formSupportsTemperature}
                    onChange={e => setFormField('formSupportsTemperature', e.target.checked)}
                  />
                  Send temperature
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={form.formStrictAlternation}
                    onChange={e => setFormField('formStrictAlternation', e.target.checked)}
                  />
                  Strict user/assistant alternation
                </label>
              </div>
            </div>
          )}

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
