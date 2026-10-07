import {
  contextThresholdsForModel,
  type ModelContextProfile,
  type ModelContextThresholds
} from '../loop/model-context-profile.js'
import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import { providerScopedModelCapabilities } from './runtime-factory-model.js'
import type { KunServeRuntimeOptions } from './runtime-factory-types.js'

export type DelegatedContextProfile = {
  contextWindowTokens: number
  softThresholdTokens: number
  hardThresholdTokens: number
}

/**
 * Window and thresholds reported for a turn run by a third-party agent runtime
 * (Claude Code, Cursor, Antigravity). The window is declared on the provider
 * (`modelCapabilities` / `modelProfiles`), exactly as the Kun-managed request
 * path reads it, so the provider id must travel with the model: resolving by
 * model id alone falls back to the conservative 32k estimate.
 */
export function delegatedContextProfile(input: {
  model: string
  providerId?: string
  defaults: ModelContextThresholds
  providers: KunServeRuntimeOptions['providers']
  profilesForProvider: (providerId?: string) => readonly ModelContextProfile[]
  modelCapabilities: (model: string, providerId?: string) => ModelCapabilityMetadata
}): DelegatedContextProfile {
  const { model, providerId } = input
  const thresholds = contextThresholdsForModel(
    model,
    input.defaults,
    input.profilesForProvider(providerId)
  )
  const capabilities = providerId
    ? providerScopedModelCapabilities(
        providerId,
        input.providers?.[providerId],
        input.modelCapabilities
      )(model)
    : input.modelCapabilities(model)
  return {
    contextWindowTokens: capabilities.contextWindowTokens ??
      Math.max(thresholds.softThreshold, thresholds.hardThreshold),
    softThresholdTokens: thresholds.softThreshold,
    hardThresholdTokens: thresholds.hardThreshold
  }
}
