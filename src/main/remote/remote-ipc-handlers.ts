import type { IpcMain } from 'electron'
import type {
  AppSettingsPatch,
  AppSettingsV1,
  RemoteAccessSettingsPatchV1
} from '../../shared/app-settings'
import type { RemoteAccessConfigPatch, RemoteAccessStatus } from '../../shared/remote-access'
import { hashRemoteAccessPassword } from './remote-auth'
import { detectTailscaleAccess } from './remote-tailscale'
import type { RemoteAccessService } from './remote-access-service'

const REMOTE_PASSWORD_MIN_LENGTH = 6
const REMOTE_PASSWORD_MAX_LENGTH = 256

export type RegisterRemoteAccessIpcOptions = {
  ipcMain: IpcMain
  service: RemoteAccessService
  applySettingsPatch: (partial: AppSettingsPatch) => Promise<AppSettingsV1>
  getSettings: () => Promise<AppSettingsV1>
}

function normalizeRemoteConfigPatch(payload: unknown): RemoteAccessSettingsPatchV1 {
  const source = (payload && typeof payload === 'object' ? payload : {}) as RemoteAccessConfigPatch
  const patch: RemoteAccessSettingsPatchV1 = {}
  if (typeof source.enabled === 'boolean') patch.enabled = source.enabled
  if (source.bind === 'lan' || source.bind === 'loopback') patch.bind = source.bind
  if (
    typeof source.port === 'number' &&
    Number.isInteger(source.port) &&
    source.port >= 0 &&
    source.port <= 65_535
  ) {
    patch.port = source.port
  }
  return patch
}

export function registerRemoteAccessIpc(options: RegisterRemoteAccessIpcOptions): void {
  const { ipcMain, service, applySettingsPatch, getSettings } = options

  ipcMain.handle('remote:status:get', async () => {
    return service.status(await getSettings())
  })

  ipcMain.handle('remote:config:set', async (_event, payload: unknown) => {
    const patch = normalizeRemoteConfigPatch(payload)
    if (patch.enabled === true) {
      const current = await getSettings()
      if (!current.remote.passwordHash) {
        throw new Error('Set a Remote access password before enabling Remote.')
      }
    }
    if (patch.enabled === false) {
      // Disabling drops every live browser session immediately.
      service.revokeAllSessions()
    }
    await applySettingsPatch({ remote: patch })
    await service.sync()
    return service.status(await getSettings())
  })

  ipcMain.handle('remote:password:set', async (_event, payload: unknown) => {
    const password = typeof payload === 'string' ? payload : ''
    if (password.length < REMOTE_PASSWORD_MIN_LENGTH) {
      throw new Error(`Remote password must be at least ${REMOTE_PASSWORD_MIN_LENGTH} characters.`)
    }
    if (password.length > REMOTE_PASSWORD_MAX_LENGTH) {
      throw new Error('Remote password is too long.')
    }
    service.revokeAllSessions()
    await applySettingsPatch({ remote: { passwordHash: hashRemoteAccessPassword(password) } })
    await service.sync()
    return service.status(await getSettings())
  })

  ipcMain.handle('remote:sessions:revoke', async () => {
    service.revokeAllSessions()
    return service.status(await getSettings())
  })

  // Host-only probe: remote clients cannot invoke it (not in the allowlist).
  ipcMain.handle('remote:tailscale:detect', () => detectTailscaleAccess())
}
