/**
 * Provider layer parameter validation.
 *
 * Before a provider adapter sends a request to a model API, this validator
 * checks that known parameters (reasoning_effort, max_tokens, temperature,
 * top_p) have valid types and values. Invalid parameters produce a clear
 * error instead of silently dropping them or sending a malformed request.
 *
 * Addresses GitHub Issue #281: reasoning_effort not transmitted to backend.
 */

import type { ModelRequest } from '../../ports/model-client.js'

export const REASONING_EFFORT_VALUES = ['auto', 'off', 'low', 'medium', 'high', 'max'] as const
export type ReasoningEffort = (typeof REASONING_EFFORT_VALUES)[number]

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && REASONING_EFFORT_VALUES.includes(value as ReasoningEffort)
}

/** Normalize reasoning effort aliases to canonical form. */
export function normalizeReasoningEffort(value: unknown): ReasoningEffort | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  switch (normalized) {
    case 'auto': case 'adaptive': return 'auto'
    case 'off': case 'disabled': case 'none': case 'false': return 'off'
    case 'low': case 'minimal': return 'low'
    case 'medium': case 'mid': return 'medium'
    case 'high': return 'high'
    case 'max': case 'maximum': case 'xhigh': return 'max'
    default: return undefined
  }
}

export type ModelValidationRules = {
  supportedReasoningEfforts?: readonly ReasoningEffort[]
  maxTokensRange?: [number, number]
  temperatureRange?: [number, number]
  topPRange?: [number, number]
  supportsStreaming?: boolean
  supportsToolCalls?: boolean
  supportsResponseFormat?: boolean
}

export type ValidationResult =
  | { valid: true; normalized: NormalizedModelParams }
  | { valid: false; error: string; field: string }

export type NormalizedModelParams = {
  reasoningEffort?: ReasoningEffort
  maxTokens?: number
  temperature?: number
  topP?: number
  stream: boolean
}

export const DEFAULT_VALIDATION_RULES: Required<ModelValidationRules> = {
  supportedReasoningEfforts: REASONING_EFFORT_VALUES as unknown as ReasoningEffort[],
  maxTokensRange: [1, 1_000_000],
  temperatureRange: [0, 2],
  topPRange: [0, 1],
  supportsStreaming: true,
  supportsToolCalls: true,
  supportsResponseFormat: true,
}

/**
 * Validate a model request against provider-specific rules.
 * On success returns normalized params; on failure returns field + message.
 */
export function validateModelRequest(
  request: Pick<ModelRequest, 'reasoningEffort' | 'maxTokens' | 'temperature' | 'topP' | 'stream'>,
  rules: ModelValidationRules = {}
): ValidationResult {
  const merged: NormalizedModelParams = { stream: request.stream ?? true }

  if (request.reasoningEffort !== undefined && request.reasoningEffort !== null) {
    const normalized = normalizeReasoningEffort(request.reasoningEffort)
    if (normalized === undefined) {
      return {
        valid: false, field: 'reasoningEffort',
        error: `Invalid reasoning_effort: "${String(request.reasoningEffort)}". Valid: ${REASONING_EFFORT_VALUES.join(', ')}`,
      }
    }
    const supported = rules.supportedReasoningEfforts ?? DEFAULT_VALIDATION_RULES.supportedReasoningEfforts
    if (!(supported as readonly string[]).includes(normalized)) {
      return {
        valid: false, field: 'reasoningEffort',
        error: `reasoning_effort "${normalized}" not supported by this provider. Supported: ${supported.join(', ')}`,
      }
    }
    merged.reasoningEffort = normalized
  }

  if (request.maxTokens !== undefined && request.maxTokens !== null) {
    if (typeof request.maxTokens !== 'number' || !Number.isFinite(request.maxTokens)) {
      return { valid: false, field: 'maxTokens', error: `max_tokens must be a number, got ${typeof request.maxTokens}` }
    }
    const [min, max] = rules.maxTokensRange ?? DEFAULT_VALIDATION_RULES.maxTokensRange
    if (request.maxTokens < min || request.maxTokens > max) {
      return { valid: false, field: 'maxTokens', error: `max_tokens ${request.maxTokens} out of range [${min}, ${max}]` }
    }
    if (!Number.isInteger(request.maxTokens)) {
      return { valid: false, field: 'maxTokens', error: `max_tokens must be an integer, got ${request.maxTokens}` }
    }
    merged.maxTokens = request.maxTokens
  }

  if (request.temperature !== undefined && request.temperature !== null) {
    if (typeof request.temperature !== 'number' || !Number.isFinite(request.temperature)) {
      return { valid: false, field: 'temperature', error: `temperature must be a number, got ${typeof request.temperature}` }
    }
    const [min, max] = rules.temperatureRange ?? DEFAULT_VALIDATION_RULES.temperatureRange
    if (request.temperature < min || request.temperature > max) {
      return { valid: false, field: 'temperature', error: `temperature ${request.temperature} out of range [${min}, ${max}]` }
    }
    merged.temperature = request.temperature
  }

  if (request.topP !== undefined && request.topP !== null) {
    if (typeof request.topP !== 'number' || !Number.isFinite(request.topP)) {
      return { valid: false, field: 'topP', error: `top_p must be a number, got ${typeof request.topP}` }
    }
    const [min, max] = rules.topPRange ?? DEFAULT_VALIDATION_RULES.topPRange
    if (request.topP < min || request.topP > max) {
      return { valid: false, field: 'topP', error: `top_p ${request.topP} out of range [${min}, ${max}]` }
    }
    merged.topP = request.topP
  }

  return { valid: true, normalized: merged }
}

/** Per-provider validation rules. */
export const PROVIDER_VALIDATION_RULES: Record<string, ModelValidationRules> = {
  openai: {
    supportedReasoningEfforts: ['auto', 'low', 'medium', 'high'],
    maxTokensRange: [1, 200000], temperatureRange: [0, 2], topPRange: [0, 1],
    supportsStreaming: true, supportsToolCalls: true, supportsResponseFormat: true,
  },
  deepseek: {
    supportedReasoningEfforts: ['auto', 'off', 'low', 'medium', 'high', 'max'],
    maxTokensRange: [1, 32768], temperatureRange: [0, 2], topPRange: [0, 1],
    supportsStreaming: true, supportsToolCalls: true, supportsResponseFormat: true,
  },
  siliconflow: {
    supportedReasoningEfforts: ['off', 'low', 'medium', 'high'],
    maxTokensRange: [1, 32768], temperatureRange: [0, 2], topPRange: [0, 1],
    supportsStreaming: true, supportsToolCalls: true, supportsResponseFormat: true,
  },
  anthropic: {
    supportedReasoningEfforts: ['off', 'low', 'medium', 'high', 'max'],
    maxTokensRange: [1, 8192], temperatureRange: [0, 1], topPRange: [0, 1],
    supportsStreaming: true, supportsToolCalls: true, supportsResponseFormat: false,
  },
  gemini: {
    supportedReasoningEfforts: ['off', 'low', 'medium', 'high'],
    maxTokensRange: [1, 65536], temperatureRange: [0, 2], topPRange: [0, 1],
    supportsStreaming: true, supportsToolCalls: true, supportsResponseFormat: true,
  },
}

/** Detect provider rules from base URL. */
export function detectProviderRules(baseUrl: string): ModelValidationRules {
  const lower = baseUrl.toLowerCase()
  if (lower.includes('api.deepseek.com')) return PROVIDER_VALIDATION_RULES.deepseek
  if (lower.includes('api.openai.com')) return PROVIDER_VALIDATION_RULES.openai
  if (lower.includes('api.siliconflow.cn') || lower.includes('siliconflow')) return PROVIDER_VALIDATION_RULES.siliconflow
  if (lower.includes('api.anthropic.com')) return PROVIDER_VALIDATION_RULES.anthropic
  if (lower.includes('generativelanguage') || lower.includes('gemini')) return PROVIDER_VALIDATION_RULES.gemini
  return DEFAULT_VALIDATION_RULES
}
