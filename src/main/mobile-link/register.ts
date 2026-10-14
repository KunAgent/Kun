import { app, ipcMain, net } from 'electron'
import { hostname } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import type { Socket } from '@kun/remote-protocol'
import type { ArtAccountAccess } from '../art-assets/account-access'
import type { RegisterAppIpcHandlersOptions } from '../ipc/app-ipc-handler-options'
import { assertTrustedWorkbenchSender } from '../ipc/app-ipc-handler-utils'
import { MOBILE_LINK_CHANNELS as channels } from '../../shared/mobile-link'
import { loadIdentity } from './identity'
import { MobileLinkService } from './service'
import { transferFiles } from './files'
export function registerMobileLink(
  options: RegisterAppIpcHandlersOptions,
  account: ArtAccountAccess
) {
  const service = new MobileLinkService({
    account,
    origin: 'https://api-kun-server.com',
    name: hostname(),
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
    socket: (url, headers) =>
      new WebSocket(url, { headers, maxPayload: 262144 }) as unknown as Socket,
    lease: options.acquireRuntimeRequestLease,
    files: transferFiles
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
  ipcMain.handle(channels.confirm, (event, id) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    return service.confirm(id)
  })
  ipcMain.handle(channels.revoke, (event, id) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    return service.revoke(id)
  })
  // Remote access is session-only: registration and sign-in never start it.
  app.once('before-quit', () => service.dispose())
}
