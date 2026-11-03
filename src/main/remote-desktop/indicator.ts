import { app, BrowserWindow, ipcMain, screen, type IpcMainEvent } from 'electron'
import { join } from 'node:path'
import { DESKTOP_INDICATOR_CHANNEL } from '../../shared/remote-desktop'
import { DESKTOP_INDICATOR_STATUS } from '../../shared/desktop-indicator-channels'
import { markProtectedWindowContents } from '../protected-window-contents'
type IndicatorStatus = { peer: string; display: string; mode: 'view' | 'control' }
export interface DesktopIndicatorPort { show(value: IndicatorStatus, end: () => void): void; update(value: IndicatorStatus): void; hide(): void }
export class DesktopShareIndicator implements DesktopIndicatorPort {
  private window?: BrowserWindow
  private url = ''
  private end?: () => void
  private status?: IndicatorStatus
  constructor() { ipcMain.on(DESKTOP_INDICATOR_CHANNEL, this.onEnd) }
  private onEnd = (event: IpcMainEvent) => {
    if (this.window && !this.window.isDestroyed() && event.sender === this.window.webContents && event.senderFrame === this.window.webContents.mainFrame && event.senderFrame.url === this.url) this.end?.()
  }
  show(value: IndicatorStatus, end: () => void) {
    this.hide(); this.end = end
    this.status = value
    const area = screen.getPrimaryDisplay().workArea
    const window = new BrowserWindow({ width: 540, height: 56, x: area.x + Math.round((area.width - 540) / 2), y: area.y + 12,
      frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, webPreferences: { preload: join(__dirname, '../preload/remote-desktop-indicator.cjs'), sandbox: true, nodeIntegration: false, contextIsolation: true } })
    this.window = window
    markProtectedWindowContents(window.webContents)
    const html = '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'none\'"><title>Kun remote desktop sharing</title><style>body{margin:0;font:13px system-ui;background:#202124;color:#fff;display:flex;align-items:center;gap:12px;padding:12px;-webkit-app-region:drag}span{white-space:nowrap;text-overflow:ellipsis;overflow:hidden}button{margin-left:auto;flex-shrink:0;min-height:32px;color:white;background:#c73337;border:0;border-radius:6px;padding:0 12px;-webkit-app-region:no-drag}</style><span id="status">Kun · Desktop sharing</span><button id="end">End session</button>'
    this.url = 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.webContents.on('did-finish-load', () => { if (this.status) this.update(this.status) })
    window.on('close', event => { if (this.window === window) { event.preventDefault(); this.end?.() } })
    void window.loadURL(this.url)
  }
  update(value: IndicatorStatus) {
    this.status = value
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send(DESKTOP_INDICATOR_STATUS, { ...value, display: value.display.slice(0, 80), zh: app.getLocale().toLowerCase().startsWith('zh') })
  }
  hide() { const window = this.window; this.window = undefined; this.end = undefined; this.status = undefined; if (window && !window.isDestroyed()) window.destroy() }
}
