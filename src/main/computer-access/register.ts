import { app, ipcMain, net } from 'electron'
import { hostname } from 'node:os'
import { join } from 'node:path'
import type { ArtAccountAccess } from '../art-assets/account-access'
import type { RegisterAppIpcHandlersOptions } from '../ipc/app-ipc-handler-options'
import { assertTrustedWorkbenchSender } from '../ipc/app-ipc-handler-utils'
import { COMPUTER_ACCESS_CHANNELS as channels } from '../../shared/computer-access'
import { loadIdentity, resetIdentity } from '../mobile-link/identity'
import { MobileLinkSockets } from '../mobile-link/socket'
import type { MobileLinkService } from '../mobile-link/service'
import { ComputerAccessService } from './service'
import { ComputerViewerWindow } from './viewer-window'
import { registerComputerSession } from './lifecycle'

export function registerComputerAccess(options: RegisterAppIpcHandlersOptions, account: ArtAccountAccess, host: MobileLinkService) {
  const links = join(app.getPath('userData'), 'mobile-link'), sockets = new MobileLinkSockets()
  let viewer: ComputerViewerWindow
  const service = new ComputerAccessService({ account, name: hostname(), origin: 'https://api-kun-server.com',
    supported: process.platform === 'darwin' && process.arch === 'arm64',
    identity: (owner, role) => loadIdentity(join(links, owner, role === 'host' ? 'identity.enc' : 'computer-controller.enc')),
    fetch: (input, init) => net.fetch(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, init),
    socket: (url, headers) => sockets.open(url, headers), event: value => viewer?.event(value) })
  viewer = new ComputerViewerWindow(service)
  const unregister = registerComputerSession(viewer)
  const handle = (channel: string, run: (...args: any[]) => unknown) => ipcMain.handle(channel, (event, ...args) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow); return run(...args)
  })
  handle(channels.status, () => service.status())
  handle(channels.refresh, () => service.refresh())
  handle(channels.pair, id => service.pair(id))
  handle(channels.open, id => viewer.open(id))
  handle(channels.close, async () => { await viewer.close(); return service.status() })
  handle(channels.confirmClosed, () => service.confirmClosed())
  handle(channels.host, value => { if (typeof value !== 'boolean') throw Error('INVALID_REQUEST'); return host.enableComputerAccess(value) })
  app.once('will-quit', () => { unregister(); void viewer.dispose(); void service.dispose(); sockets.dispose() })
  return { async resetIdentity(owner: string) {
    await viewer.close('identity_reset'); await service.reset()
    try { await resetIdentity(join(links, owner, 'computer-controller.enc')) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  } }
}
