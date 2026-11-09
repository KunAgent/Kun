import { controlRuntimeHost } from '../control-host/runtime-host'
import { registerControlPackage } from '../control-package/register'
import { registerComputerAccess } from '../computer-access/register'
import { readAccountEntitlements, requireAccountFeature } from '../account-entitlements'
import { transferSharedFiles } from './share-file-services'
import { MobileDesktopSchedules } from './desktop-schedules'
import { app, ipcMain, net, powerMonitor } from 'electron'
import { hostname, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import type { ArtAccountAccess } from '../art-assets/account-access'
import type { RegisterAppIpcHandlersOptions } from '../ipc/app-ipc-handler-options'
import { assertTrustedWorkbenchSender } from '../ipc/app-ipc-handler-utils'
import { MOBILE_LINK_CHANNELS as channels } from '../../shared/mobile-link'
import { hasKunAccountSession } from '../../shared/kun-account'
import { loadIdentity, resetIdentity } from './identity'
import { MobileLinkService, type LinkDependencies } from './service'
import { transferFiles } from './files'
import { MobileLinkRecovery } from './recovery'
import { createRuntimeOriginWorkspace } from './terminal-origin'
import { RelayPreference } from './relay-preference'
import { MobileRelayResume } from './relay-resume'
import { logInfo, logWarn } from '../logger'
import { MobileLinkSockets } from './socket'
import { registerDirectLink } from './direct-register'
import { createDesktopEngine } from '../remote-desktop/engine'
import { DesktopIceClient } from './desktop-ice'
import { createTerminalEngine } from '../remote-terminal/engine'
const networkKey = () => Object.entries(networkInterfaces()).flatMap(([name, addresses]) =>
  (addresses ?? []).filter((address) => !address.internal && !address.address.startsWith('fe80:'))
    .map((address) => name + ':' + address.family + ':' + address.address)).sort().join('|')
const DIAGNOSTIC_CODES = new Set([
  'CONNECTING', 'CONNECTED', 'RENEWED', 'RENEW_RETRY', 'APPLICATION_CALLBACK_FAILED',
  'CONNECT_TIMEOUT', 'CONNECT_FAILED', 'SEND_FAILED', 'HELLO_TIMEOUT', 'PROTOCOL_ERROR',
  'SOCKET_ERROR', 'SOCKET_CLOSED', 'LEASE_EXPIRED', 'AUTHORIZATION_REJECTED', 'VIP_REQUIRED',
  'PONG_TIMEOUT', 'HEARTBEAT_FAILED', 'HOST_SUSPENDED', 'HOST_RESUMED', 'HOST_CLOCK_GAP',
  'NETWORK_ONLINE', 'NETWORK_CHANGED', 'NETWORK_RECOVERY', 'NETWORK_HINT_CHECK', 'LOCAL_LEASE_EXPIRED',
  'PEER_METADATA_REFRESH_FAILED', 'PEER_RESYNC_FAILED',
  'NOTIFICATIONS_UNAVAILABLE', 'NOTIFICATION_POST_FAILED', 'NOTIFICATION_STREAM_RETRY',
  'SHARE_CAPABILITIES_UNAVAILABLE', 'SHARE_METADATA_UNAVAILABLE', 'SHARE_AUTHORIZATION_UNAVAILABLE', 'SHARE_CONNECTED', 'SHARE_RENEWED', 'SHARE_PONG_TIMEOUT', 'SHARE_RENEW_RETRY',
  'WSS_PROXY', 'WSS_DIRECT', 'WSS_PROXY_RESOLUTION_FAILED',
  'RELAY_RESUMED', 'RELAY_RESUME_RETRY', 'RELAY_PREFERENCE_FAILED', 'DEVICE_AUTHORIZATION_REQUIRED'
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
    const log = ['CONNECTING', 'CONNECTED', 'RENEWED', 'WSS_PROXY', 'WSS_DIRECT', 'NETWORK_HINT_CHECK', 'RELAY_RESUMED'].includes(code) ? logInfo : logWarn
    log('mobile-link', code, Object.keys(safe).length ? safe : undefined)
  }
  const sockets = new MobileLinkSockets(undefined, diagnostic)
  const links = join(app.getPath('userData'), 'mobile-link')
  const desktopSchedules = new MobileDesktopSchedules(options)
  const desktopIce = new DesktopIceClient({ account, origin: 'https://api-kun-server.com',
    identity: owner => loadIdentity(join(links, owner, 'identity.enc')),
    fetch: (input, init) => net.fetch(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, init),
    diagnostic: value => (value.event === 'ice_ready' ? logInfo : logWarn)('remote-desktop', 'Desktop ICE request.', value)
  })
  const desktop = createDesktopEngine(authority => desktopIce.request(authority), async (authority, resource) => {
    if (resource.kind === 'device') {
      if (authority.purpose !== 'desktop' || resource.id !== authority.hostId || !authority.current()) throw Error('DESKTOP_AUTHORITY_CHANGED')
      return
    }
    const lease = await options.acquireRuntimeRequestLease()
    if (!authority.current()) throw Error('DESKTOP_AUTHORITY_CHANGED')
    const response = await lease.request('/v1/remote/invoke', 'POST', JSON.stringify({ accountId: authority.accountId,
      deviceId: authority.deviceId, authorizationId: authority.authorizationId, scopes: authority.scopes,
      call: { method: `${resource.kind}.history`, params: resource.kind === 'code' ? { threadId: resource.id } : { agentId: resource.id }, requestId: crypto.randomUUID(), expiresAt: Date.now() + 15000 } }))
    if (!response.ok || !authority.current()) throw Error('DESKTOP_AUTHORITY_CHANGED')
  })
  const terminal = createTerminalEngine({
    invoke: async (call, authority) => {
      const lease = await options.acquireRuntimeRequestLease()
      if (!authority.current()) throw Error('TERMINAL_AUTHORITY_CHANGED')
      const response = await lease.request('/v1/remote/invoke', 'POST', JSON.stringify({ accountId: authority.accountId,
        deviceId: authority.deviceId, authorizationId: authority.authorizationId, scopes: authority.scopes,
        call: { ...call, requestId: crypto.randomUUID(), expiresAt: Date.now() + 15000 } }))
      if (!response.ok || !authority.current()) throw Error('TERMINAL_ORIGIN_UNAVAILABLE')
      return JSON.parse(response.body)
    },
    readWorkspace: createRuntimeOriginWorkspace(options)
  })
  registerControlPackage(options)
  const serviceDependencies: LinkDependencies = {
    createClient: deps => controlRuntimeHost().relay(deps),
    account,
    requireMembership: (owner) => requireAccountFeature(account, (input, init) => net.fetch(String(input), init), 'mobileRemote', owner),
    origin: 'https://api-kun-server.com',
    name: hostname(),
    appVersion: app.getVersion(),
    computerAccess: process.platform === 'darwin' && process.arch === 'arm64',
    platform:
      process.platform === 'darwin'
        ? 'macos'
        : process.platform === 'win32'
          ? 'windows'
          : 'linux',
    identity: (owner) => loadIdentity(join(links, owner, 'identity.enc')),
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
    desktop,
    terminal,
    desktopSchedules: (method, params, scope, lease) => desktopSchedules.invoke(method, params, scope, lease),
    sharedFiles: transferSharedFiles,
    files: transferFiles
  }
  const service = new MobileLinkService(serviceDependencies)
  const computers = registerComputerAccess(options, account, service)
  registerDirectLink(options, serviceDependencies, links)
  const resume = new MobileRelayResume({ account, relay: service, preference: new RelayPreference(links), diagnostic })
  let resettingIdentity = false
  const recovery = new MobileLinkRecovery({
    online: () => net.isOnline(), network: networkKey,
    suspend: () => service.suspend(), reconnect: (reason) => {
      service.reconnect(reason)
      resume.recover()
    },
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
  ipcMain.handle(channels.reconnect, (event) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    return resume.manual(true)
  })
  ipcMain.handle(channels.entitlements, (event) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    return readAccountEntitlements(account, (input, init) => net.fetch(String(input), init))
  })
  ipcMain.handle(channels.status, (event) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    return service.status()
  })
  ipcMain.handle(channels.enable, (event, value) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    if (typeof value !== 'boolean') throw new Error('INVALID_VALUE')
    if (resettingIdentity) throw new Error('OPERATION_IN_PROGRESS')
    return resume.manual(value)
  })
  ipcMain.handle(channels.resetIdentity, async (event) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    if (resettingIdentity) throw new Error('OPERATION_IN_PROGRESS')
    resettingIdentity = true
    try {
      const state = await account.getState()
      if (!hasKunAccountSession(state) || !state.user) throw new Error('LOGIN_REQUIRED')
      const status = await service.status()
      if (status.enabled || status.starting || status.error !== 'DEVICE_AUTHORIZATION_REQUIRED')
        throw new Error('INVALID_IDENTITY_RESET')
      await resume.manual(false)
      const current = await account.getState()
      if (!hasKunAccountSession(current) || current.user?.id !== state.user.id) throw new Error('ACCOUNT_CHANGED')
      await computers?.resetIdentity(state.user.id)
      await resetIdentity(join(links, state.user.id, 'identity.enc'))
      const latest = await account.getState()
      if (!hasKunAccountSession(latest) || latest.user?.id !== state.user.id) throw new Error('ACCOUNT_CHANGED')
      return service.status()
    } finally {
      resettingIdentity = false
    }
  })
  ipcMain.handle(channels.confirm, (event, id, scopes) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    return service.confirm(id, scopes)
  })
  ipcMain.handle(channels.setScopes, (event, id, scopes) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    return service.setScopes(id, scopes)
  })
  ipcMain.handle(channels.revoke, async (event, id) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    try { return await service.revoke(id) }
    catch (error) {
      // A failed cloud deletion must not restore this phone's default desktop rights on restart.
      await resume.manual(false).catch(() => {})
      throw error
    }
  })
  ipcMain.handle(channels.desktopStatus, event => { assertTrustedWorkbenchSender(event, options.getMainWindow); return desktop.status() })
  ipcMain.handle(channels.desktopConfigure, (event, value) => { assertTrustedWorkbenchSender(event, options.getMainWindow); return desktop.configure(value) })
  ipcMain.handle(channels.desktopStop, event => { assertTrustedWorkbenchSender(event, options.getMainWindow); return desktop.stopAll('host_user_ended') })
  // Sign-in alone never starts remote access; only a start the user left on resumes after a relaunch.
  app.once('before-quit', () => { recovery.dispose(); resume.dispose(); sockets.dispose() })
}
