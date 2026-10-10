import { ArtAccountSession } from '../art-assets/account-session'
import { authenticatedArtFetch, type ArtAccountAccess } from '../art-assets/account-access'
import { bindArtResourceReader } from '../art-assets/protocol'
import { app, BrowserWindow, ipcMain, net } from 'electron'
import { join } from 'node:path'
import { ART_CHANNELS as channels } from '../../shared/kun-art'
import type { ArtState } from '../../shared/kun-art'
import { ArtAssetService } from '../art-assets/service'
import { ArtStorage } from '../art-assets/storage'
import { assertTrustedWorkbenchSender, trustedWorkbenchSenderIsCurrent } from './app-ipc-handler-utils'
import type { RuntimeCall } from '../kun-account/wardrobe-sync'
export function registerKunArtIpc(getMainWindow: () => BrowserWindow | null, runtime: RuntimeCall, account: ArtAccountAccess): void {
  let last: ArtState | undefined
  const publish = (state: ArtState) => {
    if (last && last.phase === state.phase && last.manifest === state.manifest && state.completed % 16 !== 0 && state.completed !== state.total) return
    last = state
    const window = getMainWindow()
    for (const target of BrowserWindow.getAllWindows()) {
      if (!target.isDestroyed() && !target.webContents.isDestroyed() &&
          trustedWorkbenchSenderIsCurrent({ sender: target.webContents, senderFrame: target.webContents.mainFrame }, window)) target.webContents.send(channels.state, state)
    }
  }
  const activate = async (manifest: ArtState['manifest']) => {
    const result = await runtime('/v1/rooms/wardrobe/art-catalog', 'POST', JSON.stringify({ catalog: manifest?.catalog ?? null }))
    if (!result.ok) throw new Error('runtime_catalog_unavailable')
  }
  const service = new ArtAccountSession({ account, changed: publish, reset: () => activate(null),
    create: (changed, current) => new ArtAssetService({
      storage: new ArtStorage(join(app.getPath('userData'), 'art-assets')),
      failed: code => console.warn(`[kun-art] ${code}`),
      fetch: authenticatedArtFetch(account, (input, options) => net.fetch(String(input), options), current),
      appVersion: app.getVersion(), activate, changed
    })
  })
  ipcMain.handle(channels.get, event => { assertTrustedWorkbenchSender(event, getMainWindow); return service.getState() })
  bindArtResourceReader(url => service.resource(url))
  let stopped = false
  let timer: ReturnType<typeof setTimeout>
  // The server is asked once per local day, on the first run after launch or midnight; a tick that finds the day
  // already answered only reads a date, and a failed day is retried on the next tick.
  const tick = async () => {
    await service.checkIfDue()
    if (!stopped) { timer = setTimeout(() => { void tick() }, 30 * 60_000); timer.unref() }
  }
  timer = setTimeout(() => { void tick() }, 10_000)
  timer.unref()
  app.once('before-quit', () => { stopped = true; clearTimeout(timer); service.dispose() })
}
