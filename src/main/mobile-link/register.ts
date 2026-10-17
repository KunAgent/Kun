import { transferSharedFiles } from './share-file-services'
import { MobileDesktopSchedules } from './desktop-schedules'
import { app, ipcMain, net, powerMonitor } from 'electron'
import { hostname, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import type { ArtAccountAccess } from '../art-assets/account-access'
import type { RegisterAppIpcHandlersOptions } from '../ipc/app-ipc-handler-options'
import { assertTrustedWorkbenchSender } from '../ipc/app-ipc-handler-utils'
import { MOBILE_LINK_CHANNELS as channels } from '../../shared/mobile-link'
import { loadIdentity } from './identity'
import { MobileLinkService, type LinkDependencies } from './service'
import { transferFiles } from './files'
import { MobileLinkRecovery } from './recovery'
import { logInfo, logWarn } from '../logger'
import { MobileLinkSockets } from './socket'
const networkKey = () => Object.entries(networkInterfaces()).flatMap(([name, addresses]) =>
  (addresses ?? []).filter((address) => !address.internal && !address.address.startsWith('fe80:'))
    .map((address) => name + ':' + address.family + ':' + address.address)).sort().join('|')
const DIAGNOSTIC_CODES = new Set([
  'CONNECTING', 'CONNECTED', 'RENEWED', 'RENEW_RETRY', 'APPLICATION_CALLBACK_FAILED',
  'CONNECT_TIMEOUT', 'CONNECT_FAILED', 'SEND_FAILED', 'HELLO_TIMEOUT', 'PROTOCOL_ERROR',
  'SOCKET_ERROR', 'SOCKET_CLOSED', 'LEASE_EXPIRED', 'AUTHORIZATION_REJECTED',
  'PONG_TIMEOUT', 'HEARTBEAT_FAILED', 'HOST_SUSPENDED', 'HOST_RESUMED', 'HOST_CLOCK_GAP',
  'NETWORK_ONLINE', 'NETWORK_CHANGED', 'NETWORK_RECOVERY', 'NETWORK_HINT_CHECK', 'LOCAL_LEASE_EXPIRED',
  'PEER_METADATA_REFRESH_FAILED', 'PEER_RESYNC_FAILED',
  'NOTIFICATIONS_UNAVAILABLE', 'NOTIFICATION_POST_FAILED', 'NOTIFICATION_STREAM_RETRY',
  'SHARE_CAPABILITIES_UNAVAILABLE', 'SHARE_METADATA_UNAVAILABLE', 'SHARE_AUTHORIZATION_UNAVAILABLE', 'SHARE_CONNECTED', 'SHARE_RENEWED', 'SHARE_PONG_TIMEOUT', 'SHARE_RENEW_RETRY',
  'WSS_PROXY', 'WSS_DIRECT', 'WSS_PROXY_RESOLUTION_FAILED'
])
export function registerMobileLink(
  options: RegisterAppIpcHandlersOptions,
  account: ArtAccountAccess
) {
  const diagnostic: NonNullable<LinkDependencies['diagnostic']> = (code, details) => {
    if (!/^[A-Z0-9_]{1,64}$/.test(code) ||
        (!DIAGNOSTIC_CODES.has(code) && !/^SOCKET_CLOSED_[1-4][0-9]{3}$/.test(code))) return
    const safe: Record<string, number> = {}
    for (const key of ['attempt', 'elapsedMs'] as const)
      if (Number.isFinite(details?.[key]) && details![key]! >= 0)
        safe[key] = Math.min(1e9, details![key]!)
    const log = ['CONNECTING', 'CONNECTED', 'RENEWED', 'WSS_PROXY', 'WSS_DIRECT', 'NETWORK_HINT_CHECK'].includes(code) ? logInfo : logWarn
    log('mobile-link', code, Object.keys(safe).length ? safe : undefined)
  }
  const sockets = new MobileLinkSockets(undefined, diagnostic)
  const desktopSchedules = new MobileDesktopSchedules(options)
  const service = new MobileLinkService({
    account,
    origin: 'https://api-kun-server.com',
    name: hostname(),
    appVersion: app.getVersion(),
    platform:
      process.platform === 'darwin'
        ? 'macos'
        : process.platform === 'win32'
          ? 'windows'
          : 'linux',
    identity: (owner) =>
      loadIdentity(
        join(app.getPath('userData'), 'mobile-link', owner, 'identity.enc')
      ),
    fetch: (input, init) =>
      net.fetch(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
        init
      ),
    socket: (url, headers) => sockets.open(url, headers),
    lease: options.acquireRuntimeRequestLease,
    diagnostic,
    desktopSchedules: (method, params, scope, lease) => desktopSchedules.invoke(method, params, scope, lease),
    sharedFiles: transferSharedFiles,
    files: transferFiles
  })
  const recovery = new MobileLinkRecovery({
    online: () => net.isOnline(), network: networkKey,
    suspend: () => service.suspend(), reconnect: (reason) => service.reconnect(reason),
    power: (listener) => {
      const suspend = () => listener('suspend'), resume = () => listener('resume')
      powerMonitor.on('suspend', suspend)
      powerMonitor.on('resume', resume)
      return () => {
        powerMonitor.removeListener('suspend', suspend)
        powerMonitor.removeListener('resume', resume)
      }
    }
  })
  ipcMain.handle(channels.status, (event) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    return service.status()
  })
  ipcMain.handle(channels.enable, (event, value) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    if (typeof value !== 'boolean') throw new Error('INVALID_VALUE')
    return service.enable(value)
  })
  ipcMain.handle(channels.confirm, (event, id, scopes) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    return service.confirm(id, scopes)
  })
  ipcMain.handle(channels.setScopes, (event, id, scopes) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    return service.setScopes(id, scopes)
  })
  ipcMain.handle(channels.revoke, (event, id) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    return service.revoke(id)
  })
  // Remote access is session-only: registration and sign-in never start it.
  app.once('before-quit', () => { recovery.dispose(); service.dispose(); sockets.dispose() })
}
