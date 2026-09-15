import { normalizeBoolean, normalizePositiveInteger } from './app-settings-normalizers'

export const REMOTE_ACCESS_PASSWORD_HASH_PREFIX = 'scrypt-v1'
export const REMOTE_ACCESS_SESSION_TTL_HOURS_DEFAULT = 24 * 7
export const REMOTE_ACCESS_SESSION_TTL_HOURS_MAX = 24 * 30
export const REMOTE_ACCESS_PORT_MAX = 65_535

export type RemoteAccessBindMode = 'lan' | 'loopback'

/**
 * Remote access lets a browser on the LAN reach the desktop workbench through
 * the Remote gateway hosted by the main process. `port` 0 means "pick a free
 * port on first enable and persist it".
 */
export type RemoteAccessSettingsV1 = {
  enabled: boolean
  bind: RemoteAccessBindMode
  port: number
  /** `scrypt-v1$N$saltHex$hashHex`; empty means no password has been set. */
  passwordHash: string
  sessionTtlHours: number
}

export type RemoteAccessSettingsPatchV1 = Partial<RemoteAccessSettingsV1>

export function defaultRemoteAccessSettings(): RemoteAccessSettingsV1 {
  return {
    enabled: false,
    bind: 'lan',
    port: 0,
    passwordHash: '',
    sessionTtlHours: REMOTE_ACCESS_SESSION_TTL_HOURS_DEFAULT
  }
}

function normalizeRemoteAccessBind(value: unknown): RemoteAccessBindMode {
  return value === 'loopback' ? 'loopback' : 'lan'
}

export function normalizeRemoteAccessSettings(
  input: RemoteAccessSettingsPatchV1 | undefined
): RemoteAccessSettingsV1 {
  const defaults = defaultRemoteAccessSettings()
  const passwordHash =
    typeof input?.passwordHash === 'string' &&
    input.passwordHash.startsWith(`${REMOTE_ACCESS_PASSWORD_HASH_PREFIX}$`)
      ? input.passwordHash
      : ''
  return {
    enabled: normalizeBoolean(input?.enabled, defaults.enabled),
    bind: normalizeRemoteAccessBind(input?.bind),
    port: normalizePositiveInteger(input?.port, defaults.port, 0, REMOTE_ACCESS_PORT_MAX),
    passwordHash,
    sessionTtlHours: normalizePositiveInteger(
      input?.sessionTtlHours,
      defaults.sessionTtlHours,
      1,
      REMOTE_ACCESS_SESSION_TTL_HOURS_MAX
    )
  }
}

export function mergeRemoteAccessSettings(
  current: RemoteAccessSettingsV1 | undefined,
  patch: RemoteAccessSettingsPatchV1 | undefined
): RemoteAccessSettingsV1 {
  const base = normalizeRemoteAccessSettings(current)
  if (!patch) return base
  const merged = normalizeRemoteAccessSettings({ ...base, ...patch })
  // Renderer-facing settings projections carry a blank passwordHash. An empty
  // patch value means "unchanged", never "clear the stored hash".
  if (!patch.passwordHash) merged.passwordHash = base.passwordHash
  return merged
}
