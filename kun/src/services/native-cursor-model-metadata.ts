import { MAX_MODEL_CONTEXT_WINDOW_TOKENS, MAX_MODEL_OUTPUT_TOKENS } from '../contracts/capabilities-core.js'
import { parseNativeReasoning, parseProviderModelDescriptor, type DiscoveredModelProfile } from './provider-model-descriptors.js'
import { metadataEvidence } from '../contracts/model-metadata-evidence.js'

export type NativeCursorCatalogModel = {
  id: string
  displayName: string
  parameters?: Array<{ id: string; displayName?: string; values: Array<{ value: string; displayName?: string }> }>
  variants?: Array<{ displayName: string; isDefault?: boolean; params: Array<{ id: string; value: string }> }>
}

/** SDK execution sends only {id}; only the declared default variant is active. */
export function cursorModelMetadata(model: NativeCursorCatalogModel, explicit: unknown = {}): DiscoveredModelProfile | undefined {
  const profile = parseProviderModelDescriptor(explicit)
  const factsFor = (params: Array<{ id: string; value: string }>) => {
    const facts: DiscoveredModelProfile = {}
    for (const parameter of params) {
      const key = parameter.id.toLowerCase().replace(/[_-]/g, '')
      const tokens = tokenLimit(parameter.value)
      if (tokens && ['context', 'contextwindow', 'contextlength'].includes(key)) facts.contextWindowTokens = tokens
      if (tokens && ['input', 'maxinputtokens', 'inputtokens'].includes(key)) facts.maxInputTokens = tokens
      if (tokens && tokens <= MAX_MODEL_OUTPUT_TOKENS && ['output', 'maxoutputtokens', 'outputtokens'].includes(key)) facts.maxOutputTokens = tokens
      if (['thinking', 'reasoning', 'reasoningeffort'].includes(key)) {
        const native = parseNativeReasoning([parameter.value], parameter.value, 'none')
        if (native) {
          facts.supportsReasoning = parameter.value !== 'off' && parameter.value !== 'none'
          // The SDK owns parameter selection. Expose its default as information,
          // never offer a depth control the current launcher cannot send.
          facts.reasoning = { ...native, supportedEfforts: ['auto'], defaultEffort: 'auto', effortMapping: undefined }
        }
      }
    }
    return facts
  }
  const defaultVariant = model.variants?.find((variant) => variant.isDefault)
  if (defaultVariant) Object.assign(profile, factsFor(defaultVariant.params))
  const conditions = (model.variants ?? []).filter((variant) => !variant.isDefault).flatMap((variant) => {
    const { supportsReasoning: _reasoning, ...values } = factsFor(variant.params)
    return Object.keys(values).length ? [{ condition: `cursor-sdk-variant:${variant.displayName}`.slice(0, 512), ...values }] : []
  })
  // Parameter choices do not imply a selected value. Keep them inspectable
  // without activating a context window or a wire reasoning control.
  for (const parameter of model.parameters ?? []) {
    for (const option of parameter.values) {
      const { supportsReasoning: _reasoning, ...values } = factsFor([{ id: parameter.id, value: option.value }])
      if (Object.keys(values).length) conditions.push({ condition: `cursor-sdk-parameter:${parameter.id}=${option.value}`.slice(0, 512), ...values })
    }
  }
  if (conditions.length) profile.conditionalCapabilities = conditions.slice(0, 64)
  if (!Object.keys(profile).some((field) => field !== 'evidence')) return undefined
  const values = profile as DiscoveredModelProfile
  return { ...values, evidence: metadataEvidence(values, 'provider', new Date().toISOString()) }
}

function tokenLimit(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)\s*([km])?$/i.exec(value.trim())
  if (!match) return undefined
  const tokens = Number(match[1]) * (match[2]?.toLowerCase() === 'm' ? 1_000_000 : match[2]?.toLowerCase() === 'k' ? 1_000 : 1)
  return Number.isSafeInteger(tokens) && tokens > 0 && tokens <= MAX_MODEL_CONTEXT_WINDOW_TOKENS ? tokens : undefined
}
