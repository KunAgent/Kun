import { app, BrowserWindow, ipcMain, screen, type IpcMainEvent } from 'electron'
import { join } from 'node:path'
import { DESKTOP_INDICATOR_CHANNEL, DESKTOP_INDICATOR_STATUS } from '../../shared/desktop-indicator-channels'
import { markProtectedWindowContents } from '../protected-window-contents'
import type { TerminalActivity } from './session-service'

/**
 * Visible desktop entry while a phone terminal is running.
 *
 * Reuses the remote-desktop indicator preload and end channel, so there is one
 * protected, always-on-top strip with an explicit end action and no extra
 * permission prompt. The window only accepts the end message from its own frame.
 */
export class TerminalActivityIndicator implements TerminalActivity {
  private window?: BrowserWindow
  private url = ''
  private end?: () => void
  private peer = ''

  constructor() {
    ipcMain.on(DESKTOP_INDICATOR_CHANNEL, this.onEnd)
  }

  private onEnd = (event: IpcMainEvent) => {
    if (!this.window || this.window.isDestroyed()) return
    if (event.sender !== this.window.webContents) return
    if (event.senderFrame !== this.window.webContents.mainFrame) return
    if (event.senderFrame.url !== this.url) return
    this.end?.()
  }

  show(peer: string, end: () => void) {
    this.hide()
    this.end = end
    this.peer = peer
    const area = screen.getPrimaryDisplay().workArea
    const width = 460
    const window = new BrowserWindow({
      width, height: 56,
      x: area.x + Math.round((area.width - width) / 2), y: area.y + 12,
      frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/remote-desktop-indicator.cjs'),
        sandbox: true, nodeIntegration: false, contextIsolation: true
      }
    })
    this.window = window
    markProtectedWindowContents(window.webContents)
    const html = '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'none\'"><title>Kun remote terminal</title><style>body{margin:0;font:13px system-ui;background:#202124;color:#fff;display:flex;align-items:center;gap:12px;padding:12px;-webkit-app-region:drag}span{white-space:nowrap;text-overflow:ellipsis;overflow:hidden}button{margin-left:auto;flex-shrink:0;min-height:32px;color:white;background:#c73337;border:0;border-radius:6px;padding:0 12px;-webkit-app-region:no-drag}</style><span id="status">Kun · Terminal</span><button id="end">End session</button>'
    this.url = 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.on('did-finish-load', () => this.paint())
    window.on('close', (event) => { if (this.window === window) { event.preventDefault(); this.end?.() } })
    void window.loadURL(this.url)
  }

  update(peer: string) {
    this.peer = peer
    this.paint()
  }

  hide() {
    const window = this.window
    this.window = undefined
    this.end = undefined
    this.peer = ''
    if (window && !window.isDestroyed()) window.destroy()
  }

  private paint() {
    if (!this.window || this.window.isDestroyed()) return
    this.window.webContents.send(DESKTOP_INDICATOR_STATUS, {
      peer: this.peer.slice(0, 128), display: 'Terminal', mode: 'control',
      zh: app.getLocale().toLowerCase().startsWith('zh')
    })
  }
}
