import type { ProjectedCredentialHealth, StoredProfile } from './model-connection-registry-core.js'

type ProviderIdentity = { id?: string; presetSource?: string; kind?: string; authType?: string }

export function isAnonymousHttpProfile(profile: ProviderIdentity): boolean {
  return profile.authType === 'none' && (!profile.kind || profile.kind === 'http')
}

export function isRetiredOpenCodeFreeConnection(profile: ProviderIdentity): boolean {
  const id = profile.id?.trim() ?? ''
  if (/^opencode-free(?:-[0-9]+)?$/u.test(id)) return true
  return profile.presetSource === 'opencode-free'
}

export function isProfileUsable(
  profile: Pick<StoredProfile, 'id' | 'presetSource' | 'configured' | 'kind' | 'authType' | 'credentialRef' | 'credentialSourceId'>,
  health?: ProjectedCredentialHealth
): boolean {
  if (!profile.configured || isRetiredOpenCodeFreeConnection(profile)) return false
  if (isAnonymousHttpProfile(profile)) return true
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
    if (isRetiredOpenCodeFreeConnection(profile)) continue
    if (!isProfileUsable(profile, credentialHealth.get(profile.id))) continue
    const model = profile.selectedModel ?? profile.models[0]
    if (model) return { profile, model }
  }
  return undefined
}
