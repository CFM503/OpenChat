// ============================================================================
// Infer capability defaults from model id / endpoint / explicit config
// ============================================================================

import type { ModelConfig, ResolvedModelCaps, TokenParamStyle, ApiStyle } from './modelTypes.js';

/** Known model family heuristics (domestic + international) */
function inferFromModelId(modelId: string, endpoint: string): Partial<ResolvedModelCaps> {
  const m = modelId.toLowerCase();
  const ep = endpoint.toLowerCase();

  // OpenAI o-series / gpt-5 reasoning
  if (/^o[1-9]/.test(m) || m.includes('o1-') || m.includes('o3-') || m.includes('o4-')
    || m.includes('gpt-5') || m.includes('gpt-4.1')) {
    return {
      tokenParam: 'max_completion_tokens',
      supportsTemperature: false,
      reasoningMode: 'enabled',
      contextWindow: m.includes('mini') ? 128_000 : 200_000,
    };
  }

  // DeepSeek
  if (m.includes('deepseek') || ep.includes('deepseek')) {
    const reasoner = m.includes('reasoner') || m.includes('r1');
    return {
      tokenParam: 'max_tokens',
      supportsTemperature: !reasoner,
      reasoningMode: reasoner ? 'enabled' : 'auto',
      contextWindow: 64_000,
      supportsTools: true,
    };
  }

  // Qwen / DashScope / Tongyi
  if (m.includes('qwen') || ep.includes('dashscope') || ep.includes('aliyuncs')) {
    return {
      tokenParam: 'max_tokens',
      contextWindow: m.includes('long') || m.includes('turbo') ? 128_000 : 32_000,
      supportsTools: true,
      strictAlternation: false,
    };
  }

  // Moonshot / Kimi
  if (m.includes('moonshot') || m.includes('kimi') || ep.includes('moonshot')) {
    return {
      tokenParam: 'max_tokens',
      contextWindow: m.includes('128k') || m.includes('k2') ? 128_000 : 32_000,
      supportsTools: true,
    };
  }

  // Zhipu GLM
  if (m.includes('glm') || ep.includes('bigmodel') || ep.includes('zhipuai')) {
    return {
      tokenParam: 'max_tokens',
      contextWindow: 128_000,
      supportsTools: true,
    };
  }

  // Baichuan
  if (m.includes('baichuan') || ep.includes('baichuan')) {
    return {
      tokenParam: 'max_tokens',
      contextWindow: 32_000,
      supportsTools: true,
    };
  }

  // MiniMax
  if (m.includes('minimax') || m.includes('abab') || ep.includes('minimax')) {
    return {
      tokenParam: 'max_tokens',
      contextWindow: 245_000,
      supportsTools: true,
    };
  }

  // Doubao / Volcengine / Ark
  if (m.includes('doubao') || ep.includes('volces') || ep.includes('volcengine') || ep.includes('ark.cn')) {
    return {
      tokenParam: 'max_tokens',
      contextWindow: 128_000,
      supportsTools: true,
    };
  }

  // Yi / 01.ai
  if (m.includes('yi-') || ep.includes('lingyiwanwu') || ep.includes('01.ai')) {
    return {
      tokenParam: 'max_tokens',
      contextWindow: 16_000,
    };
  }

  // SiliconFlow / Together-style
  if (ep.includes('siliconflow') || ep.includes('together.xyz')) {
    return {
      tokenParam: 'max_tokens',
      contextWindow: 32_000,
      supportsTools: true,
    };
  }

  // Xiaomi MiMo
  if (m.includes('mimo') || ep.includes('mimo') || ep.includes('xiaomi')) {
    return {
      tokenParam: 'max_tokens',
      contextWindow: 128_000,
      supportsTools: true,
    };
  }

  // StepFun
  if (m.includes('step-') || ep.includes('stepfun')) {
    return {
      tokenParam: 'max_tokens',
      contextWindow: 32_000,
    };
  }

  // Gemini
  if (m.includes('gemini') || ep.includes('generativelanguage.googleapis')) {
    return {
      tokenParam: 'max_tokens',
      contextWindow: m.includes('pro') ? 1_000_000 : 128_000,
      supportsTools: true,
      supportsVision: true,
    };
  }

  // Anthropic Claude
  if (m.includes('claude') || ep.includes('anthropic')) {
    return {
      apiStyle: 'anthropic',
      tokenParam: 'max_tokens',
      contextWindow: m.includes('opus') || m.includes('sonnet') ? 200_000 : 200_000,
      supportsTools: true,
      supportsVision: true,
      authStyle: 'anthropic-x-api-key',
    };
  }

  // Gemma / small open models — often strict alternation, weak tools
  if (m.includes('gemma') || m.includes('phi-') || m.includes('tinyllama')) {
    return {
      supportsTools: false,
      strictAlternation: true,
      contextWindow: 8_000,
      contextStrategy: 'minimal',
    };
  }

  // GPT-4o / standard OpenAI
  if (m.includes('gpt-4') || m.includes('gpt-3.5') || ep.includes('api.openai.com')) {
    return {
      tokenParam: 'max_tokens',
      contextWindow: m.includes('4o') || m.includes('turbo') ? 128_000 : 16_000,
      supportsTools: true,
      supportsVision: m.includes('4o') || m.includes('vision'),
    };
  }

  // Ollama
  if (ep.includes('11434') || ep.includes('/api/chat')) {
    return {
      apiStyle: 'ollama',
      tokenParam: 'num_predict',
      contextWindow: 32_000,
    };
  }

  return {};
}

function defaultContextWindow(provider: string): number {
  if (provider === 'ollama') return 32_000;
  return 128_000;
}

/**
 * Resolve full capability profile: explicit config > model heuristics > defaults.
 */
export function resolveModelCaps(model: ModelConfig): ResolvedModelCaps {
  const inferred = inferFromModelId(model.model || '', model.endpoint || '');

  const apiStyle: ApiStyle =
    model.apiStyle ??
    inferred.apiStyle ??
    (model.provider === 'ollama' ? 'ollama' : 'openai');

  let tokenParam: TokenParamStyle =
    model.tokenParam ??
    inferred.tokenParam ??
    (model.useMaxTokens === false ? 'none' : 'max_tokens');

  if (apiStyle === 'ollama') tokenParam = 'num_predict';

  const contextWindow =
    model.contextWindow ??
    inferred.contextWindow ??
    defaultContextWindow(model.provider);

  const contextStrategy =
    model.contextStrategy ??
    inferred.contextStrategy ??
    'balanced';

  // History budget by strategy
  const defaultHistoryFrac =
    contextStrategy === 'minimal' ? 0.35 :
    contextStrategy === 'full' ? 0.70 :
    0.55;

  const historyTokenBudget =
    model.historyTokenBudget ??
    Math.floor(contextWindow * defaultHistoryFrac);

  return {
    apiStyle,
    contextWindow,
    tokenParam,
    supportsTemperature:
      model.supportsTemperature ??
      inferred.supportsTemperature ??
      true,
    supportsTools:
      model.disableTools === true
        ? false
        : (model.supportsTools ?? inferred.supportsTools ?? true),
    supportsParallelToolCalls:
      model.supportsParallelToolCalls ??
      inferred.supportsParallelToolCalls ??
      true,
    supportsSystemRole:
      model.supportsSystemRole ??
      inferred.supportsSystemRole ??
      true,
    supportsVision:
      model.supportsVision ??
      inferred.supportsVision ??
      false,
    reasoningMode:
      model.reasoningMode ??
      inferred.reasoningMode ??
      'none',
    strictAlternation:
      model.strictAlternation ??
      inferred.strictAlternation ??
      false,
    contextStrategy,
    historyTokenBudget,
    toolResultMaxChars: model.toolResultMaxChars ?? (
      contextStrategy === 'minimal' ? 2_000 :
      contextStrategy === 'full' ? 12_000 :
      4_000
    ),
    compressionThreshold: model.compressionThreshold ?? (
      contextStrategy === 'minimal' ? 0.55 :
      contextStrategy === 'full' ? 0.85 :
      0.70
    ),
    memoryMaxChars: model.memoryMaxChars ?? (
      contextStrategy === 'minimal' ? 4_000 :
      contextStrategy === 'full' ? 20_000 :
      10_000
    ),
    skillCatalogMode: model.skillCatalogMode ?? (
      contextStrategy === 'minimal' ? 'names' :
      contextStrategy === 'full' ? 'full' :
      'names'
    ),
    maxHistoryMessages: model.maxHistoryMessages ?? (
      contextStrategy === 'minimal' ? 8 :
      contextStrategy === 'full' ? 40 :
      20
    ),
    authStyle:
      model.authStyle ??
      inferred.authStyle ??
      'bearer',
  };
}
