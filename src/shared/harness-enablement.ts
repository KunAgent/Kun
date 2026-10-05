import type { AdeHarnessRow } from './ade-harnesses'
import type { KunHarnessEnabledProfileV1, KunHarnessSettingsV1 } from './app-settings-types-kun-runtime'

/** Mirrored by the runtime; neither presence on disk nor a legacy setting is opt-in. */
export function harnessProfileKey(profile: KunHarnessEnabledProfileV1): string {
  return JSON.stringify([profile.harnessId, profile.credentialMode,
    profile.credentialMode === 'native-login' && (!profile.providerId?.trim() || profile.providerId.trim() === 'default')
      ? '' : profile.providerId?.trim() || 'default'])
}

export function normalizeEnabledProfiles(value: unknown): KunHarnessEnabledProfileV1[] {
  if (!Array.isArray(value)) return []
  const profiles = new Map<string, KunHarnessEnabledProfileV1>()
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const { harnessId, credentialMode, providerId } = entry as Record<string, unknown>
    if (typeof harnessId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(harnessId) ||
      harnessId === 'kun' || harnessId === 'gemini-cli' ||
      !['native-login', 'provider', 'kun-gateway'].includes(String(credentialMode))) continue
    if (providerId !== undefined && (typeof providerId !== 'string' || !providerId.trim() || providerId.length > 128)) continue
    const profile: KunHarnessEnabledProfileV1 = { harnessId,
      credentialMode: credentialMode as KunHarnessEnabledProfileV1['credentialMode'],
      ...(typeof providerId === 'string' ? { providerId: providerId.trim() } : {}) }
    profiles.set(harnessProfileKey(profile), profile)
    if (profiles.size >= 128) break
  }
  return [...profiles.values()]
}

export function selectedHarnessProfile(row: AdeHarnessRow, settings: KunHarnessSettingsV1): KunHarnessEnabledProfileV1 {
  const defaults = settings.defaults[row.definition.id]
  const credentialMode = defaults?.credentialMode && row.definition.credentialModes.includes(defaults.credentialMode)
    ? defaults.credentialMode : row.definition.credentialModes[0] ?? 'native-login'
  return { harnessId: row.definition.id, credentialMode,
    ...(defaults?.providerId ? { providerId: defaults.providerId } : {}) }
}

export function harnessProfileEnabled(settings: Pick<KunHarnessSettingsV1, 'enabledProfiles' | 'disabledIds'>,
  profile: KunHarnessEnabledProfileV1): boolean {
  if (profile.harnessId === 'kun') return true
  return profile.harnessId !== 'gemini-cli' && !settings.disabledIds.includes(profile.harnessId) &&
    (settings.enabledProfiles ?? []).some((entry) => harnessProfileKey(entry) === harnessProfileKey(profile))
}

/** Only unexpired runtime proofs for explicitly enabled exact routes can enter a picker. */
export function readyHarnessProfiles(row: AdeHarnessRow, now = Date.now()): KunHarnessEnabledProfileV1[] {
  if (row.definition.id === 'gemini-cli' || row.definition.availability === 'retired' || row.enabled !== true ||
    (row.status.installed !== 'yes' && !(row.status.installed === 'unknown' && row.status.detecting)) ||
    row.status.versionSupported === false) return []
  // A metadata refresh may be detecting while the runtime still supplies a
  // current proof for this exact profile. Never extend or invent that proof.
  return (row.readyProfiles ?? []).filter((profile) => profile.harnessId === row.definition.id &&
    row.definition.credentialModes.includes(profile.credentialMode) &&
    typeof profile.expiresAt === 'string' && Date.parse(profile.expiresAt) > now &&
    (row.enabledProfiles ?? []).some((enabled) => harnessProfileKey(enabled) === harnessProfileKey(profile)))
}

export function harnessProfileReady(row: AdeHarnessRow, profile: KunHarnessEnabledProfileV1): boolean {
  return row.definition.id === 'kun' || readyHarnessProfiles(row).some((entry) =>
    harnessProfileKey(entry) === harnessProfileKey(profile))
}
