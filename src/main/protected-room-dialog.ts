import { resolveNamedPreloadPath } from './main-paths'
import { app, BrowserWindow } from 'electron'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { protectedRoomDialogHtml, type ProtectedRoomDialogContent } from './protected-room-dialog-html'

/** A separate sandboxed surface, with no workbench bridge, extension scripts or shared session. */
export function showProtectedRoomDialog(parent: BrowserWindow, content: ProtectedRoomDialogContent, current?: () => Promise<boolean>): Promise<boolean> {
  if (parent.isDestroyed()) return Promise.resolve(false)
  const nonce = randomBytes(18).toString('hex')
  const bounds = parent.getBounds()
  const width = Math.min(560, Math.max(340, bounds.width - 48)), height = Math.min(470, Math.max(320, bounds.height - 48))
  const view = new BrowserWindow({ parent, modal: true, frame: false, show: false, width, height,
    x: Math.round(bounds.x + (bounds.width - width) / 2), y: Math.round(bounds.y + (bounds.height - height) / 2),
    resizable: false, minimizable: false, maximizable: false, skipTaskbar: true,
    backgroundColor: content.dark ? '#181a1d' : '#f9fbfc',
    webPreferences: { preload: resolveNamedPreloadPath(join(app.getAppPath(), 'out/main'), 'protected-room-dialog'), sandbox: true,
      contextIsolation: true, nodeIntegration: false, webviewTag: false, partition: 'kun-protected-' + nonce } })
  return new Promise((resolve, reject) => {
    let settled = false, checking = false
    const finish = (value: boolean, error?: Error) => { if (settled) return; settled = true; clearInterval(timer); parent.removeListener('closed', parentClosed); if (error) reject(error); else resolve(value); if (!view.isDestroyed()) view.close() }
    const parentClosed = () => finish(false)
    const timer = setInterval(() => {
      if (!current || settled || checking) return
      checking = true
      void current().then((active) => { if (!active) finish(false) }, () => finish(false)).finally(() => { checking = false })
    }, 1000)
    timer.unref()
    parent.once('closed', parentClosed)
    view.on('closed', () => finish(false))
    view.webContents.once('preload-error', (_event, _path, error) => finish(false, error))
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    view.webContents.on('will-navigate', (event) => event.preventDefault())
    view.webContents.on('will-attach-webview', (event) => event.preventDefault())
    view.webContents.on('ipc-message', (event, channel, value) => {
      if (channel !== 'protected-room:confirm' || typeof value !== 'boolean' || view.isDestroyed() || parent.isDestroyed()) return
      if (event.senderFrame?.processId !== view.webContents.mainFrame.processId || event.senderFrame?.routingId !== view.webContents.mainFrame.routingId) return
      finish(value)
    })
    view.once('ready-to-show', () => { if (!settled) view.show() })
    void view.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(protectedRoomDialogHtml(content, nonce))).catch((error) => finish(false, error))
  })
}
