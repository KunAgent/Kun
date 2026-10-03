import type { AdeHarnessRow } from '../ade-harnesses'
import type { KunHarnessEnabledProfileV1 } from '../app-settings-types-kun-runtime'

/** Test-only explicit consent plus a current runtime proof; never used by production paths. */
export function withHarnessReadiness(row: AdeHarnessRow, profiles?: KunHarnessEnabledProfileV1[]): AdeHarnessRow {
  const enabledProfiles = profiles ?? row.definition.credentialModes.flatMap<KunHarnessEnabledProfileV1>((credentialMode) =>
    credentialMode === 'native-login' ? [{ harnessId: row.definition.id, credentialMode }] :
      ['deepseek', 'stepfun', 'source', 'cursor-account'].map((providerId) => ({ harnessId: row.definition.id, credentialMode, providerId })))
  const ready = row.status.installed === 'yes' && row.status.versionSupported !== false && row.status.ready !== 'no' && row.status.ready !== 'unknown'
  return { ...row, enabled: true, enabledProfiles,
    readyProfiles: ready ? enabledProfiles.filter((profile) => profile.credentialMode !== 'native-login' || row.status.login !== 'signed-out')
      .map((profile) => ({ ...profile, expiresAt: new Date(Date.now() + 300_000).toISOString() })) : [] }
}
