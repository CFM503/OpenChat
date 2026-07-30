// ============================================================================
// ModelConfigPanel Component
// Provider presets, quick add, model auto-detect, and manual config
// ============================================================================

import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { ModelConfig, ModelProvider, ContextStrategy, TokenParamStyle, ApiStyle } from '../core/types';
import { ModelRouter, normalizeEndpoint, PROVIDER_PRESETS, type ProviderPreset } from '../core/modelRouter';
import {
  inferContextWindowFromId,
  formatContextLabel,
  type DiscoveredModel,
  type ContextSource,
} from '../../server/src/providers/inferContextWindow';

interface ModelConfigPanelProps {
  models: ModelConfig[];
  activeModelId: string | null;
  onAddModel: (config: ModelConfig) => void;
  onUpdateModel: (config: ModelConfig) => void;
  onDeleteModel: (id: string) => void;
  onSetActive: (id: string) => void;
}

/** Keep skill catalog + tool truncation aligned with context strategy (matches server resolveCaps). */
function strategyLinkedDefaults(strategy: ContextStrategy): {
  skillCatalogMode: 'full' | 'names' | 'off';
  toolResultMaxChars: number;
} {
  switch (strategy) {
    case 'minimal':
      return { skillCatalogMode: 'names', toolResultMaxChars: 2_000 };
    case 'full':
      return { skillCatalogMode: 'full', toolResultMaxChars: 12_000 };
    case 'cache_max':
      return { skillCatalogMode: 'full', toolResultMaxChars: 12_000 };
    case 'balanced':
    default:
      return { skillCatalogMode: 'names', toolResultMaxChars: 4_000 };
  }
}

/** Cloud vs local default strategy when preset omits it */
function defaultStrategyForPreset(preset: ProviderPreset): ContextStrategy {
  if (preset.defaults?.contextStrategy) return preset.defaults.contextStrategy;
  if (preset.region === 'local' || preset.provider === 'ollama') return 'balanced';
  return 'cache_max';
}

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

/** Shared sane defaults for cloud coding + prompt-cache savings */
const blankForm: FormState = {
  formId: '',
  formName: '',
  formProvider: 'openai',
  formEndpoint: '',
  formApiKey: '',
  formModel: '',
  formMaxTokens: 8192,
  formTemperature: 0.4,
  formIsDefault: false,
  formDisableTools: false,
  formUseMaxTokens: true,
  formApiStyle: '',
  formTokenParam: '',
  formContextWindow: 128000,
  formContextStrategy: 'cache_max',
  formTopP: '',
  formSupportsTemperature: true,
  formReasoningMode: 'none',
  formStrictAlternation: false,
  formAuthStyle: 'bearer',
  formSkillCatalogMode: 'full',
  formToolResultMaxChars: 12_000,
  formShowAdvanced: false,
};

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
  const [form, setForm] = useState<FormState>(blankForm);
  const [errors, setErrors] = useState<string[]>([]);
  const [detectingModels, setDetectingModels] = useState(false);
  const [detectedModels, setDetectedModels] = useState<DiscoveredModel[]>([]);
  const [detectError, setDetectError] = useState('');
  /** How the current context window was chosen (for UI hint) */
  const [contextHint, setContextHint] = useState<{
    source: ContextSource | 'preset' | 'manual';
    label: string;
  } | null>(null);
  /** Skip auto-infer after user manually edits context window */
  const contextManualRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const handleExportAll = useCallback(() => {
    try {
      const payload = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        models: models,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `openchat-models-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatusMsg({ text: `✓ Successfully exported ${models.length} model route(s)!`, type: 'success' });
    } catch (err: any) {
      setStatusMsg({ text: `Export failed: ${err.message}`, type: 'error' });
    }
  }, [models]);

  const handleExportSingle = useCallback((model: ModelConfig) => {
    try {
      const payload = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        models: [model],
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `openchat-model-${model.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatusMsg({ text: `✓ Exported model "${model.name}"`, type: 'success' });
    } catch (err: any) {
      setStatusMsg({ text: `Export failed: ${err.message}`, type: 'error' });
    }
  }, []);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);

        let rawList: any[] = [];
        if (Array.isArray(parsed)) {
          rawList = parsed;
        } else if (parsed && Array.isArray(parsed.models)) {
          rawList = parsed.models;
        } else if (parsed && typeof parsed === 'object' && parsed.name && parsed.endpoint) {
          rawList = [parsed];
        } else {
          throw new Error('Invalid format: File does not contain valid model configurations.');
        }

        let importedCount = 0;
        const existingIds = new Set(models.map(m => m.id));

        for (const item of rawList) {
          if (!item.name || !item.endpoint || !item.provider) continue;

          let newId = item.id;
          if (!newId || existingIds.has(newId)) {
            newId = `model_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          }
          existingIds.add(newId);

          const config: ModelConfig = {
            id: newId,
            name: item.name,
            provider: item.provider || 'openai',
            endpoint: item.endpoint,
            apiKey: item.apiKey || undefined,
            model: item.model || '',
            maxTokens: typeof item.maxTokens === 'number' ? item.maxTokens : 4096,
            temperature: typeof item.temperature === 'number' ? item.temperature : 0.7,
            isDefault: false,
            disableTools: !!item.disableTools,
            useMaxTokens: item.useMaxTokens,
            apiStyle: item.apiStyle,
            tokenParam: item.tokenParam,
            contextWindow: item.contextWindow,
            contextStrategy: item.contextStrategy || 'cache_max',
            topP: item.topP,
            supportsTemperature: item.supportsTemperature,
            reasoningMode: item.reasoningMode,
            strictAlternation: item.strictAlternation,
            authStyle: item.authStyle,
            skillCatalogMode: item.skillCatalogMode,
            toolResultMaxChars: item.toolResultMaxChars,
          };

          onAddModel(config);
          importedCount++;
        }

        if (importedCount === 0) {
          throw new Error('No valid model configurations found in the file.');
        }

        setStatusMsg({ text: `✓ Successfully imported ${importedCount} model route(s)!`, type: 'success' });
      } catch (err: any) {
        setStatusMsg({ text: `Import failed: ${err.message}`, type: 'error' });
      } finally {
        if (e.target) e.target.value = '';
      }
    };
    reader.readAsText(file);
  }, [models, onAddModel]);

  const setFormField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  }, []);

  const applyContextWindow = useCallback((n: number, source: ContextSource | 'preset' | 'manual') => {
    if (!n || n < 2048) return;
    setForm(prev => ({ ...prev, formContextWindow: n }));
    setContextHint({
      source,
      label: formatContextLabel(n),
    });
    if (source === 'manual') contextManualRef.current = true;
    else contextManualRef.current = false;
  }, []);

  /** Auto-fill context when model id or endpoint changes (unless user locked it manually) */
  useEffect(() => {
    if (!isEditing || contextManualRef.current) return;
    const id = form.formModel.trim();
    if (!id) return;
    const n = inferContextWindowFromId(id, form.formEndpoint);
    if (n != null) {
      setForm(prev => {
        // Don't thrash if already matching
        if (prev.formContextWindow === n) return prev;
        return { ...prev, formContextWindow: n };
      });
      setContextHint({ source: 'inferred', label: formatContextLabel(n) });
    }
  }, [form.formModel, form.formEndpoint, isEditing]);

  /** Changing strategy also updates linked skill/tool defaults (user can still override after). */
  const setContextStrategy = useCallback((strategy: ContextStrategy) => {
    const linked = strategyLinkedDefaults(strategy);
    setForm(prev => ({
      ...prev,
      formContextStrategy: strategy,
      formSkillCatalogMode: linked.skillCatalogMode,
      formToolResultMaxChars: linked.toolResultMaxChars,
    }));
  }, []);

  const resetForm = useCallback(() => {
    setDetectedModels([]);
    setDetectError('');
    setErrors([]);
    setContextHint(null);
    contextManualRef.current = false;
  }, []);

  const applyPreset = useCallback((preset: ProviderPreset) => {
    const d = preset.defaults || {};
    const strategy = defaultStrategyForPreset(preset);
    const linked = strategyLinkedDefaults(strategy);
    const isLocal = preset.region === 'local' || preset.provider === 'ollama';
    const ctx =
      d.contextWindow ??
      (preset.model ? inferContextWindowFromId(preset.model, preset.endpoint) : undefined) ??
      (isLocal ? 32_000 : 128_000);
    contextManualRef.current = false;
    setForm({
      ...blankForm,
      formId: `model_${preset.id}_${Date.now()}`,
      formName: preset.name,
      formProvider: preset.provider,
      formEndpoint: preset.endpoint,
      formApiKey: '',
      formModel: preset.model,
      formMaxTokens: d.maxTokens ?? (isLocal ? 4096 : 8192),
      formTemperature: d.temperature ?? (isLocal ? 0.5 : 0.4),
      formIsDefault: false,
      formDisableTools: d.disableTools ?? false,
      formUseMaxTokens: d.tokenParam !== 'none',
      formApiStyle: d.apiStyle ?? '',
      formTokenParam: d.tokenParam ?? '',
      formContextWindow: ctx,
      formContextStrategy: strategy,
      formSupportsTemperature: d.supportsTemperature ?? true,
      formReasoningMode: d.reasoningMode ?? 'none',
      formAuthStyle: d.authStyle ?? 'bearer',
      formSkillCatalogMode: d.skillCatalogMode ?? linked.skillCatalogMode,
      formToolResultMaxChars: d.toolResultMaxChars ?? linked.toolResultMaxChars,
      formShowAdvanced: false,
    });
    setContextHint({
      source: d.contextWindow != null ? 'preset' : 'inferred',
      label: formatContextLabel(ctx),
    });
    setDetectedModels([]);
    setDetectError('');
    setErrors([]);
    setIsEditing(true);
    setEditingId(null);
    setShowPresets(false);
  }, []);

  // Auto-detect models from endpoint (returns id + context when available)
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
    } else if (modelsUrl.endsWith('/v1/messages')) {
      modelsUrl = modelsUrl.replace(/\/v1\/messages$/, '/v1/models');
    } else if (!/\/(models|tags)$/i.test(modelsUrl)) {
      modelsUrl = modelsUrl + '/models';
    }

    try {
      const qs = new URLSearchParams({ url: modelsUrl });
      if (form.formApiKey.trim()) qs.set('apiKey', form.formApiKey.trim());
      const resp = await fetch(`/api/discover-models?${qs}`, {
        signal: AbortSignal.timeout(12000),
      });
      const ct = resp.headers.get('content-type') || '';
      if (!resp.ok || !ct.includes('application/json')) {
        throw new Error(`HTTP ${resp.status} (Not a JSON endpoint)`);
      }
      const data = await resp.json();
      const list: DiscoveredModel[] = Array.isArray(data.models)
        ? data.models.map((m: any) =>
            typeof m === 'string'
              ? {
                  id: m,
                  source: 'inferred' as const,
                  contextWindow: inferContextWindowFromId(m, form.formEndpoint),
                }
              : {
                  id: m.id,
                  contextWindow:
                    m.contextWindow ??
                    inferContextWindowFromId(m.id, form.formEndpoint),
                  source: (m.source as ContextSource) || 'unknown',
                },
          )
        : [];
      if (list.length > 0) {
        setDetectedModels(list);
      } else {
        setDetectError(data.error || 'No models found');
      }
    } catch (err: any) {
      setDetectError(err.message || 'Failed to detect models');
    } finally {
      setDetectingModels(false);
    }
  }, [form.formEndpoint, form.formApiKey]);

  const selectDetectedModel = useCallback((m: DiscoveredModel) => {
    setFormField('formModel', m.id);
    setDetectedModels([]);
    if (m.contextWindow) {
      applyContextWindow(m.contextWindow, m.source === 'api' ? 'api' : 'inferred');
    } else {
      const n = inferContextWindowFromId(m.id, form.formEndpoint);
      if (n) applyContextWindow(n, 'inferred');
    }
  }, [applyContextWindow, form.formEndpoint, setFormField]);

  const handleEdit = (model: ModelConfig) => {
    setIsEditing(true);
    setEditingId(model.id);
    const strategy = model.contextStrategy ?? 'cache_max';
    const linked = strategyLinkedDefaults(strategy);
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
      formContextStrategy: strategy,
      formTopP: model.topP != null ? String(model.topP) : '',
      formSupportsTemperature: model.supportsTemperature ?? true,
      formReasoningMode: model.reasoningMode ?? 'none',
      formStrictAlternation: model.strictAlternation ?? false,
      formAuthStyle: model.authStyle ?? 'bearer',
      // Prefer saved values; if missing, align with strategy (not hard-coded names/4000)
      formSkillCatalogMode: model.skillCatalogMode ?? linked.skillCatalogMode,
      formToolResultMaxChars: model.toolResultMaxChars ?? linked.toolResultMaxChars,
      formShowAdvanced: false,
    });
    contextManualRef.current = model.contextWindow != null;
    setContextHint(
      model.contextWindow != null
        ? { source: 'manual', label: formatContextLabel(model.contextWindow) }
        : null,
    );
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
    setForm({
      ...blankForm,
      formId: `model_${Date.now()}`,
      formName: '',
      formProvider: 'openai',
      formEndpoint: 'https://api.openai.com/v1',
      formApiKey: '',
      formModel: '',
    });
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Model Routes</h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileImport}
                accept=".json"
                style={{ display: 'none' }}
              />
              <button
                type="button"
                className="btn-ghost"
                onClick={handleExportAll}
                style={{ fontSize: '0.8rem', padding: '4px 10px', border: '1px solid var(--border-color)', borderRadius: '6px' }}
                title="Export all model routes to a JSON file"
              >
                📤 Export
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={handleImportClick}
                style={{ fontSize: '0.8rem', padding: '4px 10px', border: '1px solid var(--border-color)', borderRadius: '6px' }}
                title="Import model routes from a JSON file"
              >
                📥 Import
              </button>
              <button className="btn-primary" onClick={handleAddNew} id="btn-add-model-open">
                + Add Model
              </button>
            </div>
          </div>

          {statusMsg && (
            <div
              style={{
                marginBottom: '12px',
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '0.85rem',
                background: statusMsg.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                color: statusMsg.type === 'success' ? 'var(--color-success, #10b981)' : 'var(--color-error, #ef4444)',
                border: `1px solid ${statusMsg.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>{statusMsg.text}</span>
              <button
                type="button"
                className="btn-ghost"
                style={{ padding: '2px 6px', fontSize: '0.75rem', marginLeft: '8px' }}
                onClick={() => setStatusMsg(null)}
              >
                ✕
              </button>
            </div>
          )}

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
                  <button className="btn-ghost" onClick={() => handleExportSingle(m)} style={{ padding: '4px 8px' }} title="Export this model config">
                    Export
                  </button>
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
                maxHeight: '180px', overflowY: 'auto',
              }}>
                {detectedModels.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => selectDetectedModel(m)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      padding: '4px 8px',
                      background: form.formModel === m.id ? 'var(--bg-surface-elevated)' : 'transparent',
                      border: 'none',
                      borderRadius: '4px',
                      color: 'var(--text-primary)',
                      fontSize: '12px',
                      fontFamily: 'var(--font-mono)',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.id}</span>
                    {m.contextWindow != null && (
                      <span
                        style={{
                          flexShrink: 0,
                          fontSize: 11,
                          color: 'var(--text-muted)',
                          fontFamily: 'var(--font-sans, sans-serif)',
                        }}
                        title={
                          m.source === 'api'
                            ? 'Reported by provider API'
                            : 'Inferred from model name'
                        }
                      >
                        {formatContextLabel(m.contextWindow)}
                        {m.source === 'api' ? ' · API' : m.source === 'inferred' ? ' · ~' : ''}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {detectError && (
              <span style={{ fontSize: '11px', color: 'var(--color-error)', marginTop: '4px', display: 'block' }}>
                ⚠️ {detectError}
              </span>
            )}
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
              Detect lists models and context size when the API reports it; otherwise estimates from the name.
              Selecting a model auto-fills Context window.
            </span>
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
              <label title="Maximum tokens generated per reply (not the context window)">
                Max output tokens ({form.formMaxTokens.toLocaleString()})
              </label>
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
                  onClick={() => setFormField('formMaxTokens', Math.max(1024, form.formMaxTokens - 1024))}
                  disabled={!form.formUseMaxTokens}
                  style={{ padding: '4px 10px', fontSize: '16px', lineHeight: 1, minWidth: '32px', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: form.formUseMaxTokens ? 'pointer' : 'not-allowed', opacity: form.formUseMaxTokens ? 1 : 0.4 }}
                  title="Decrease by 1024"
                >
                  −
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setFormField('formMaxTokens', Math.min(128000, form.formMaxTokens + 1024))}
                  disabled={!form.formUseMaxTokens}
                  style={{ padding: '4px 10px', fontSize: '16px', lineHeight: 1, minWidth: '32px', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: form.formUseMaxTokens ? 'pointer' : 'not-allowed', opacity: form.formUseMaxTokens ? 1 : 0.4 }}
                  title="Increase by 1024"
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
                disabled={!form.formSupportsTemperature}
              />
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'block' }}>
                Coding: 0.2–0.5 · Chatty: 0.7+ · Reasoning models often ignore temperature
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
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
            <label
              style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px' }}
              title="Send an explicit output token cap (max_tokens / max_completion_tokens). Uncheck only if the gateway rejects it."
            >
              <input
                type="checkbox"
                checked={form.formUseMaxTokens}
                onChange={e => setFormField('formUseMaxTokens', e.target.checked)}
              />
              Cap output tokens
            </label>
          </div>

          {/* Context strategy — primary token-cost / cache control */}
          <div className="form-group">
            <label>Context strategy</label>
            <select
              className="form-select"
              value={form.formContextStrategy}
              onChange={e => setContextStrategy(e.target.value as ContextStrategy)}
            >
              <option value="cache_max">
                Cache max (recommended) — stable prefix, best cache hit rate on cloud APIs
              </option>
              <option value="balanced">
                Balanced — truncate tools, drop older turns (good for local / no cache)
              </option>
              <option value="full">Full — keep more history (higher input cost)</option>
              <option value="minimal">Minimal — shortest context (lowest raw tokens)</option>
            </select>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
              Changing strategy also sets skill catalog + tool truncation defaults (advanced can override).
              Use Cache max with DeepSeek / Claude / OpenAI-compatible caches; use Balanced/Minimal for Ollama.
            </span>
          </div>

          <div className="form-group">
            <label>
              Context window
              {contextHint && (
                <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
                  ({contextHint.source === 'api'
                    ? 'from API'
                    : contextHint.source === 'inferred'
                      ? 'auto ~' + contextHint.label
                      : contextHint.source === 'preset'
                        ? 'preset'
                        : 'manual'}
                  {contextHint.source !== 'inferred' ? ` ${contextHint.label}` : ''})
                </span>
              )}
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="number"
                className="form-input"
                min={2048}
                max={2000000}
                value={form.formContextWindow}
                onChange={e => {
                  const n = parseInt(e.target.value) || 128000;
                  contextManualRef.current = true;
                  setFormField('formContextWindow', n);
                  setContextHint({ source: 'manual', label: formatContextLabel(n) });
                }}
              />
              <button
                type="button"
                className="btn-ghost"
                style={{ whiteSpace: 'nowrap', fontSize: 12, border: '1px solid var(--border-color)', borderRadius: 6, padding: '8px 10px' }}
                title="Re-estimate from model id / endpoint"
                onClick={() => {
                  contextManualRef.current = false;
                  const n =
                    inferContextWindowFromId(form.formModel, form.formEndpoint) ??
                    (form.formProvider === 'ollama' ? 32_000 : 128_000);
                  applyContextWindow(n, 'inferred');
                }}
              >
                Auto
              </button>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
              Total input+output budget OpenChat uses for packing. Not the same as max output tokens.
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
                <div className="form-group">
                  <label>Context window (same as above)</label>
                  <input
                    type="number"
                    className="form-input"
                    min={2048}
                    max={2000000}
                    value={form.formContextWindow}
                    onChange={e => {
                      const n = parseInt(e.target.value) || 128000;
                      contextManualRef.current = true;
                      setFormField('formContextWindow', n);
                      setContextHint({ source: 'manual', label: formatContextLabel(n) });
                    }}
                  />
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
