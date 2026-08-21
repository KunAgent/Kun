import { resolveProviderCatalogSource } from '@kun/provider-catalog'
import {
  MAX_MODEL_CONTEXT_WINDOW_TOKENS,
  MAX_MODEL_OUTPUT_TOKENS,
  type ModelCapabilityMetadata
} from '../contracts/capabilities.js'
import type { RegistryDocument } from './model-connection-registry-core.js'

export function normalizeModelCapabilityMetadata(
  capability: ModelCapabilityMetadata | undefined
): ModelCapabilityMetadata | undefined {
  if (!capability) return undefined
  const invalidContextWindow = capability.contextWindowTokens !== undefined &&
    capability.contextWindowTokens > MAX_MODEL_CONTEXT_WINDOW_TOKENS
  const invalidMaxOutput = capability.maxOutputTokens !== undefined &&
    capability.maxOutputTokens > MAX_MODEL_OUTPUT_TOKENS
  if (!invalidContextWindow && !invalidMaxOutput) return capability
  const {
    contextWindowTokens: _contextWindowTokens,
    maxOutputTokens: _maxOutputTokens,
    ...remaining
  } = capability
  return {
    ...remaining,
    ...(!invalidContextWindow && capability.contextWindowTokens !== undefined
      ? { contextWindowTokens: capability.contextWindowTokens }
      : {}),
    ...(!invalidMaxOutput && capability.maxOutputTokens !== undefined
      ? { maxOutputTokens: capability.maxOutputTokens }
      : {})
  }
}

export function repairRegistryModelCapabilityLimits(
  document: RegistryDocument
): RegistryDocument | null {
  let changed = false
  const profiles = Object.fromEntries(Object.entries(document.profiles).map(([providerId, profile]) => {
    const source = resolveProviderCatalogSource({
      id: profile.id,
      presetSource: profile.presetSource,
      presetMode: profile.presetMode
    })
    const repairedIdentity = source && (
      profile.presetSource !== source.presetSource ||
      profile.presetMode !== source.presetMode ||
      (profile.authType === 'api-key' && source.preset.authType === 'subscription')
    )
    const profileWithIdentity = repairedIdentity
      ? {
          ...profile,
          presetSource: source!.presetSource,
          presetMode: source!.presetMode,
          ...(profile.authType === 'api-key' && source!.preset.authType === 'subscription'
            ? { authType: 'subscription' as const }
            : {})
        }
      : profile
    if (!profileWithIdentity.modelCapabilities) {
      if (!repairedIdentity) return [providerId, profile]
      changed = true
      return [providerId, profileWithIdentity]
    }
    let profileChanged = repairedIdentity
    const modelCapabilities = Object.fromEntries(
      Object.entries(profileWithIdentity.modelCapabilities).map(([modelId, capability]) => {
        const normalized = normalizeModelCapabilityMetadata(capability) ?? capability
        const safeReasoning = source?.presetSource === 'opencode-go' &&
          normalized.reasoning?.requestProtocol === 'thinking-toggle-chat-completions'
          ? { supportedEfforts: ['auto'] as const, defaultEffort: 'auto' as const, requestProtocol: 'none' as const }
          : normalized.reasoning
        const repaired = safeReasoning === normalized.reasoning
          ? normalized
          : { ...normalized, reasoning: safeReasoning }
        if (repaired !== capability) profileChanged = true
        return [modelId, repaired]
      })
    )
    if (!profileChanged) return [providerId, profile]
    changed = true
    return [providerId, { ...profileWithIdentity, modelCapabilities }]
  }))
  return changed ? { ...document, profiles } : null
}
