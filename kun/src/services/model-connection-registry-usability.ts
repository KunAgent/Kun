import type { ProjectedCredentialHealth, StoredProfile } from './model-connection-registry-core.js'

const OPENCODE_FREE_PROVIDER_ID = 'opencode-free'

type ProviderIdentity = { id?: string; presetSource?: string }

export function isAnonymousHttpProfile(profile: ProviderIdentity): boolean {
  return profile.id === OPENCODE_FREE_PROVIDER_ID ||
    profile.presetSource === OPENCODE_FREE_PROVIDER_ID
}

export function isProfileUsable(
  profile: Pick<StoredProfile, 'id' | 'presetSource' | 'configured' | 'kind' | 'credentialRef' | 'credentialSourceId'>,
  health?: ProjectedCredentialHealth
): boolean {
  if (!profile.configured) return false
  const requiresCredential = (profile.kind === 'http' && !isAnonymousHttpProfile(profile)) ||
    profile.kind === 'gemini-code-assist' ||
    Boolean(profile.credentialRef || profile.credentialSourceId)
  return !requiresCredential || health?.credentialStatus === 'ready'
}

export function configuredFallback(
  profiles: readonly StoredProfile[],
  credentialHealth: ReadonlyMap<string, ProjectedCredentialHealth> = new Map()
): { profile: StoredProfile; model: string } | undefined {
  for (const profile of profiles) {
    if (!isProfileUsable(profile, credentialHealth.get(profile.id))) continue
    const model = profile.selectedModel ?? profile.models[0]
    if (model) return { profile, model }
  }
  return undefined
}
