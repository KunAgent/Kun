import { bindArtResourceReader } from '../art-assets/protocol'
import { app, BrowserWindow, ipcMain, net } from 'electron'
import { join } from 'node:path'
import { ART_CHANNELS as channels } from '../../shared/kun-art'
import type { ArtState } from '../../shared/kun-art'
import { ArtAssetService } from '../art-assets/service'
import { ArtStorage } from '../art-assets/storage'
import { assertTrustedWorkbenchSender, trustedWorkbenchSenderIsCurrent } from './app-ipc-handler-utils'
import type { RuntimeCall } from '../kun-account/wardrobe-sync'
export function registerKunArtIpc(getMainWindow: () => BrowserWindow | null, runtime: RuntimeCall): void {
  let last: ArtState | undefined
  const service = new ArtAssetService({
    storage: new ArtStorage(join(app.getPath('userData'), 'art-assets')),
    failed: code => console.warn(`[kun-art] ${code}`),
    fetch: (url, options) => net.fetch(url, options), appVersion: app.getVersion(),
    activate: async (manifest) => {
      const result = await runtime('/v1/rooms/wardrobe/art-catalog', 'POST', JSON.stringify({ catalog: manifest?.catalog ?? null }))
      if (!result.ok) throw new Error('runtime_catalog_unavailable')
    },
    changed: (state) => {
      if (last && last.phase === state.phase && last.manifest === state.manifest && state.completed % 16 !== 0 && state.completed !== state.total) return
      last = state
      const window = getMainWindow()
      for (const target of BrowserWindow.getAllWindows()) {
        if (!target.isDestroyed() && !target.webContents.isDestroyed() &&
            trustedWorkbenchSenderIsCurrent({ sender: target.webContents, senderFrame: target.webContents.mainFrame }, window)) target.webContents.send(channels.state, state)
      }
    }
  })
  const run = (channel: string, action: () => Promise<ArtState>) => ipcMain.handle(channel, event => {
    assertTrustedWorkbenchSender(event, getMainWindow); return action()
  })
  run(channels.get, () => service.getState())
  run(channels.check, () => service.check(true))
  run(channels.rollback, () => service.rollback())
  bindArtResourceReader(url => service.resource(url))
  let stopped = false
  let timer: ReturnType<typeof setTimeout>
  const tick = async () => {
    const state = await service.check()
    if (!stopped) { timer = setTimeout(() => { void tick() }, state.phase === 'error' ? 60_000 : 30 * 60_000); timer.unref() }
  }
  timer = setTimeout(() => { void tick() }, 10_000)
  timer.unref()
  app.once('before-quit', () => { stopped = true; clearTimeout(timer); service.dispose() })
}
