import { MAX_MODEL_CONTEXT_WINDOW_TOKENS, MAX_MODEL_OUTPUT_TOKENS, type ModelReasoningEffort } from '../contracts/capabilities-core.js'
import { parseNativeReasoning, parseProviderModelDescriptor, type DiscoveredModelProfile } from './provider-model-descriptors.js'
import { metadataEvidence } from '../contracts/model-metadata-evidence.js'

export type NativeCursorCatalogModel = {
  id: string
  displayName: string
  parameters?: Array<{ id: string; displayName?: string; values: Array<{ value: string; displayName?: string }> }>
  variants?: Array<{ displayName: string; isDefault?: boolean; params: Array<{ id: string; value: string }> }>
}

const THINKING_PARAMETER_IDS = new Set(['thinking', 'reasoning', 'reasoningeffort', 'effort'])

export type CursorThinkingControl = {
  parameterId: string
  supportedEfforts: ModelReasoningEffort[]
  defaultEffort: ModelReasoningEffort
  effortMapping: Partial<Record<ModelReasoningEffort, string>>
  nativeEfforts: string[]
  nativeDefaultEffort?: string
}

/** Parameter ids the SDK uses for thinking depth. `fast` and `optimize_for` are not thinking. */
export function cursorThinkingParameterId(id: string): boolean {
  return THINKING_PARAMETER_IDS.has(id.toLowerCase().replace(/[_-]/g, ''))
}

/**
 * Selectable thinking levels for one SDK model. Parameter values are the full
 * set; the default variant picks the default level. Values Kun cannot name
 * are left out, and a model with no mappable level has no control.
 */
export function cursorThinkingControl(model: NativeCursorCatalogModel): CursorThinkingControl | undefined {
  const parameter = thinkingParameter(model)
  if (!parameter) return undefined
  const parsed = parseNativeReasoning(parameter.values, parameter.defaultValue, 'none')
  if (!parsed?.effortMapping || Object.keys(parsed.effortMapping).length === 0) return undefined
  return {
    parameterId: parameter.id,
    supportedEfforts: parsed.supportedEfforts,
    defaultEffort: parsed.defaultEffort,
    effortMapping: parsed.effortMapping,
    nativeEfforts: parsed.nativeEfforts ?? parameter.values,
    ...(parsed.nativeDefaultEffort ? { nativeDefaultEffort: parsed.nativeDefaultEffort } : {})
  }
}

/** Capability facts from the SDK catalog. Thinking levels come from the parameter, not a single variant. */
export function cursorModelMetadata(model: NativeCursorCatalogModel, explicit: unknown = {}): DiscoveredModelProfile | undefined {
  const profile = parseProviderModelDescriptor(explicit)
  const factsFor = (params: Array<{ id: string; value: string }>) => {
    const facts: DiscoveredModelProfile = {}
    for (const parameter of params) {
      if (cursorThinkingParameterId(parameter.id)) continue
      const key = parameter.id.toLowerCase().replace(/[_-]/g, '')
      const tokens = tokenLimit(parameter.value)
      if (tokens && ['context', 'contextwindow', 'contextlength'].includes(key)) facts.contextWindowTokens = tokens
      if (tokens && ['input', 'maxinputtokens', 'inputtokens'].includes(key)) facts.maxInputTokens = tokens
      if (tokens && tokens <= MAX_MODEL_OUTPUT_TOKENS && ['output', 'maxoutputtokens', 'outputtokens'].includes(key)) facts.maxOutputTokens = tokens
    }
    return facts
  }
  const defaultVariant = model.variants?.find((variant) => variant.isDefault)
  if (defaultVariant) Object.assign(profile, factsFor(defaultVariant.params))
  const conditions = (model.variants ?? []).filter((variant) => !variant.isDefault).flatMap((variant) => {
    const values = factsFor(variant.params)
    return Object.keys(values).length ? [{ condition: `cursor-sdk-variant:${variant.displayName}`.slice(0, 512), ...values }] : []
  })
  // Parameter choices do not imply a selected context window. Thinking levels
  // are collected separately so the composer can offer every mapped value.
  for (const parameter of model.parameters ?? []) {
    if (cursorThinkingParameterId(parameter.id)) continue
    for (const option of parameter.values) {
      const values = factsFor([{ id: parameter.id, value: option.value }])
      if (Object.keys(values).length) conditions.push({ condition: `cursor-sdk-parameter:${parameter.id}=${option.value}`.slice(0, 512), ...values })
    }
  }
  const thinking = cursorThinkingControl(model)
  if (thinking) {
    profile.supportsReasoning = thinking.supportedEfforts.some((effort) => effort !== 'off')
    profile.reasoning = {
      supportedEfforts: thinking.supportedEfforts,
      defaultEffort: thinking.defaultEffort,
      requestProtocol: 'none',
      nativeEfforts: thinking.nativeEfforts,
      ...(thinking.nativeDefaultEffort ? { nativeDefaultEffort: thinking.nativeDefaultEffort } : {}),
      effortMapping: thinking.effortMapping
    }
  }
  if (conditions.length) profile.conditionalCapabilities = conditions.slice(0, 64)
  if (!Object.keys(profile).some((field) => field !== 'evidence')) return undefined
  const values = profile as DiscoveredModelProfile
  return { ...values, evidence: metadataEvidence(values, 'provider', new Date().toISOString()) }
}

function thinkingParameter(model: NativeCursorCatalogModel): { id: string; values: string[]; defaultValue?: string } | undefined {
  const declared = (model.parameters ?? []).find((entry) => cursorThinkingParameterId(entry.id) && entry.values.some((value) => value.value))
  const defaultParam = model.variants?.find((variant) => variant.isDefault)?.params.find((param) => cursorThinkingParameterId(param.id))
  if (declared) {
    const values = declared.values.map((entry) => entry.value).filter(Boolean)
    return values.length ? {
      id: declared.id,
      values,
      ...(defaultParam && values.includes(defaultParam.value) ? { defaultValue: defaultParam.value } : {})
    } : undefined
  }
  return defaultParam?.value ? { id: defaultParam.id, values: [defaultParam.value], defaultValue: defaultParam.value } : undefined
}

function tokenLimit(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)\s*([km])?$/i.exec(value.trim())
  if (!match) return undefined
  const tokens = Number(match[1]) * (match[2]?.toLowerCase() === 'm' ? 1_000_000 : match[2]?.toLowerCase() === 'k' ? 1_000 : 1)
  return Number.isSafeInteger(tokens) && tokens > 0 && tokens <= MAX_MODEL_CONTEXT_WINDOW_TOKENS ? tokens : undefined
}
