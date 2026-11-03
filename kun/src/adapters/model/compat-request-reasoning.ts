import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import { isDeepSeekHost } from './model-error-probe.js'

type ModelReasoningCapability = NonNullable<ModelCapabilityMetadata['reasoning']>
type NormalizedReasoningEffort = ModelReasoningCapability['defaultEffort']

export function responsesReasoningForEffort(
  effort: string | undefined,
  reasoning?: ModelReasoningCapability,
  options: {
    maxEffort?: 'high' | 'xhigh'
    includeSummary?: boolean
  } = {}
): Record<string, unknown> | null {
  if (reasoning && reasoning.requestProtocol !== 'openai-responses') return null
  const resolved = reasoning
    ? resolveReasoningEffort(effort, reasoning)
    : normalizeReasoningEffortValue(effort)
  if (resolved === 'auto' || resolved === 'off' || !resolved) return null
  const normalized = resolved
  const payload = (wireEffort: string): Record<string, unknown> => ({
    effort: wireEffort,
    ...(options.includeSummary ? { summary: 'auto' } : {})
  })
  const mapped = reasoning?.effortMapping?.[normalized]
  if (mapped && (!reasoning?.nativeEfforts || reasoning.nativeEfforts.includes(mapped))) return payload(mapped)
  switch (normalized) {
    case 'low':
      return payload('low')
    case 'medium':
      return payload('medium')
    case 'high':
      return payload('high')
    case 'xhigh':
      return payload(reasoning?.supportedEfforts.includes('xhigh') ? 'xhigh' : (options.maxEffort ?? 'high'))
    case 'max':
      return payload(options.maxEffort ?? 'high')
    default:
      return null
  }
}


export function applyReasoningEffort(
  body: Record<string, unknown>,
  effort: string | undefined,
  options: {
    includeThinking?: boolean
    nativeDeepSeekHost?: boolean
    geminiOpenAiHost?: boolean
    reasoning?: ModelReasoningCapability
    maxReasoningEffort?: 'high' | 'max'
  } = {}
): void {
  const normalized = options.reasoning
    ? resolveReasoningEffort(effort, options.reasoning)
    : normalizeReasoningEffortValue(effort)
  if (!normalized) return
  const includeThinking = options.includeThinking !== false
  // thinking field in DeepSeek format is only supported on the official DeepSeek API.
  // Third-party OpenAI-compat proxies (SiliconFlow, OpenRouter, llama.cpp, etc.) may
  // reject or mishandle it, causing 400 errors or empty responses. See issue #26.
  const nativeDeepSeek = options.nativeDeepSeekHost === true
  if (options.geminiOpenAiHost === true) {
    applyGeminiOpenAiReasoningEffort(body, normalized)
    return
  }
  if (options.reasoning) {
    applyProfileReasoningEffort(body, normalized, options.reasoning, includeThinking, nativeDeepSeek)
    return
  }
  switch (normalized) {
    case 'off':
      if (nativeDeepSeek) body.thinking = { type: 'disabled' }
      break
    case 'low':
    case 'medium':
    case 'high':
      body.reasoning_effort = 'high'
      if (nativeDeepSeek) body.thinking = { type: 'enabled' }
      break
    case 'max':
      body.reasoning_effort = options.maxReasoningEffort ?? 'max'
      if (nativeDeepSeek) body.thinking = { type: 'enabled' }
      break
  }
}

function applyGeminiOpenAiReasoningEffort(
  body: Record<string, unknown>,
  effort: NormalizedReasoningEffort
): void {
  switch (effort) {
    case 'auto':
      return
    case 'off':
      // Gemini 3 models cannot disable thinking. "minimal" is the closest
      // compatible setting and is also accepted by Gemini 2.5.
      body.reasoning_effort = 'minimal'
      return
    case 'low':
    case 'medium':
    case 'high':
      body.reasoning_effort = effort
      return
    case 'max':
      body.reasoning_effort = 'high'
      return
  }
}

function applyProfileReasoningEffort(
  body: Record<string, unknown>,
  effort: NormalizedReasoningEffort,
  reasoning: ModelReasoningCapability,
  includeThinking: boolean,
  nativeDeepSeekHost: boolean
): void {
  switch (reasoning.requestProtocol) {
    case 'none':
    case 'openai-responses':
    case 'anthropic-thinking':
      return
    case 'openai-chat-completions': {
      const mapped = reasoning.effortMapping?.[effort]
      if (mapped && effort !== 'auto' && (!reasoning.nativeEfforts || reasoning.nativeEfforts.includes(mapped))) {
        body.reasoning_effort = mapped
      } else applyOpenAiChatReasoningEffort(body, effort)
      return
    }
    case 'qwen-chat-completions':
      applyQwenChatReasoningEffort(body, effort)
      return
    case 'thinking-toggle-chat-completions':
      applyThinkingToggleChatReasoningEffort(body, effort, includeThinking)
      return
    case 'deepseek-chat-completions':
      applyDeepSeekChatReasoningEffort(body, effort, nativeDeepSeekHost)
      return
    case 'glm-chat-completions':
      applyGlmChatReasoningEffort(body, effort, includeThinking)
      return
    case 'mimo-chat-completions':
      applyMimoChatReasoningEffort(body, effort, includeThinking)
      return
  }
}

function applyOpenAiChatReasoningEffort(
  body: Record<string, unknown>,
  effort: NormalizedReasoningEffort
): void {
  switch (effort) {
    case 'auto':
      return
    case 'off':
      body.reasoning_effort = 'none'
      return
    case 'low':
    case 'medium':
    case 'high':
    case 'max':
      body.reasoning_effort = effort
      return
  }
}

function applyQwenChatReasoningEffort(
  body: Record<string, unknown>,
  effort: NormalizedReasoningEffort
): void {
  body.enable_thinking = effort !== 'off'
}

function applyThinkingToggleChatReasoningEffort(
  body: Record<string, unknown>,
  effort: NormalizedReasoningEffort,
  includeThinking: boolean
): void {
  if (!includeThinking) return
  body.thinking = { type: effort === 'off' ? 'disabled' : 'enabled' }
}

function applyDeepSeekChatReasoningEffort(
  body: Record<string, unknown>,
  effort: NormalizedReasoningEffort,
  includeThinking: boolean
): void {
  if (effort === 'off') {
    if (includeThinking) body.thinking = { type: 'disabled' }
    return
  }
  if (effort === 'max') {
    body.reasoning_effort = 'max'
  } else if (effort !== 'auto') {
    body.reasoning_effort = 'high'
  }
  if (includeThinking && effort !== 'auto') body.thinking = { type: 'enabled' }
}

function applyGlmChatReasoningEffort(
  body: Record<string, unknown>,
  effort: NormalizedReasoningEffort,
  includeThinking: boolean
): void {
  if (!includeThinking || effort === 'auto') return
  body.thinking = {
    type: effort === 'off' ? 'disabled' : 'enabled',
    clear_thinking: true
  }
}

function applyMimoChatReasoningEffort(
  body: Record<string, unknown>,
  effort: NormalizedReasoningEffort,
  includeThinking: boolean
): void {
  if (effort === 'off') {
    if (includeThinking) body.thinking = { type: 'disabled' }
    return
  }
  if (effort === 'low' || effort === 'medium' || effort === 'high') {
    body.reasoning_effort = effort
    if (includeThinking) body.thinking = { type: 'enabled' }
  }
}

export function applyAnthropicReasoningEffort(
  body: Record<string, unknown>,
  effort: string | undefined,
  reasoning?: ModelReasoningCapability
): void {
  if (reasoning?.requestProtocol !== 'anthropic-thinking') return
  const resolved = resolveReasoningEffort(effort, reasoning)
  if (!resolved) return
  if (resolved === 'off') {
    body.thinking = { type: 'disabled' }
    return
  }
  body.thinking = { type: 'adaptive' }
  const outputEffort = anthropicOutputEffortForReasoningEffort(resolved)
  if (outputEffort) body.output_config = { effort: outputEffort }
}

function anthropicOutputEffortForReasoningEffort(
  effort: NormalizedReasoningEffort
): 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null {
  switch (effort) {
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
      return effort
    case 'auto':
    case 'off':
      return null
  }
}

export function resolveReasoningEffort(
  effort: string | undefined,
  reasoning: ModelReasoningCapability
): NormalizedReasoningEffort | undefined {
  const normalized = normalizeReasoningEffortValue(effort)
  if (!normalized || !reasoning.supportedEfforts.length) return undefined
  if (reasoning.supportedEfforts.includes(normalized)) return normalized
  // Providers without a distinct xhigh tier keep the historical xhigh → max alias.
  if (normalized === 'xhigh') {
    if (reasoning.supportedEfforts.includes('max')) return 'max'
    return reasoning.supportedEfforts.includes(reasoning.defaultEffort) ? reasoning.defaultEffort : undefined
  }
  if (
    normalized === 'low' &&
    reasoning.supportedEfforts.includes('off') &&
    !reasoning.supportedEfforts.includes('low')
  ) {
    return 'off'
  }
  return reasoning.supportedEfforts.includes(reasoning.defaultEffort) ? reasoning.defaultEffort : undefined
}

function normalizeReasoningEffortValue(effort: string | undefined): NormalizedReasoningEffort | undefined {
  switch (effort?.trim().toLowerCase()) {
    case 'auto':
    case 'adaptive':
      return 'auto'
    case 'off':
    case 'disabled':
    case 'none':
    case 'false':
      return 'off'
    case 'low':
    case 'minimal':
      return 'low'
    case 'medium':
    case 'mid':
      return 'medium'
    case 'high':
      return 'high'
    case 'xhigh':
      return 'xhigh'
    case 'max':
    case 'maximum':
      return 'max'
    default:
      return undefined
  }
}



function isAzureOpenAiEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl)
    const host = url.hostname.toLowerCase()
    return host.endsWith('.openai.azure.com') || host.endsWith('.cognitiveservices.azure.com')
  } catch {
    return /\.openai\.azure\.com\b|\.cognitiveservices\.azure\.com\b/i.test(baseUrl)
  }
}

function isThinkingMode(effort: string | undefined): boolean {
  const normalized = effort?.trim().toLowerCase()
  if (!normalized) return false
  return !['off', 'disabled', 'none', 'false'].includes(normalized)
}

export function requiresReasoningRoundTrip(
  effort: string | undefined,
  model: string | undefined,
  baseUrl: string,
  reasoning?: ModelReasoningCapability
): boolean {
  if (reasoning) {
    const resolved = resolveReasoningEffort(effort, reasoning)
    if (resolved) {
      return resolved !== 'off' && reasoning.requestProtocol !== 'none'
    }
    return isDeepSeekHost(baseUrl) && isThinkingProducerModel(model)
  }
  // Thinking-mode round trip is a DeepSeek-specific protocol extension.
  // OpenAI-compat providers (OpenRouter, llama.cpp, etc.) may reject
  // or misinterpret the `thinking` field, so we only auto-enable it
  // on the official DeepSeek host. User-selected reasoningEffort still
  // forces the path (opt-in). See issue #26.
  return isThinkingMode(effort) || (isDeepSeekHost(baseUrl) && isThinkingProducerModel(model))
}

function isThinkingProducerModel(model: string | undefined): boolean {
  const normalized = normalizeModelId(model)
  if (!normalized) return false
  return normalized === 'deepseek-v4-pro' ||
    normalized === 'deepseek-v4-flash' ||
    normalized.includes('deepseek-reasoner') ||
    normalized.endsWith('/deepseek-v4-pro') ||
    normalized.endsWith('/deepseek-v4-flash')
}

export function normalizeModelId(model: string | undefined): string {
  return model?.trim().toLowerCase() ?? ''
}
