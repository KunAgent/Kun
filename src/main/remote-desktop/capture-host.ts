import { BrowserWindow, desktopCapturer, ipcMain, screen, webContents, type IpcMainEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DESKTOP_CAPTURE_CHANNELS as channels, type CaptureEvent, type CaptureReply } from '../../shared/remote-desktop'
import { desktopProcessBirth, terminateDesktopProcess } from './native-input'
import { validateDesktopSdp } from '@kun/remote-protocol'
import { markProtectedWindowContents } from '../protected-window-contents'
function bounded(value: unknown, max: number) { try { return Buffer.byteLength(JSON.stringify(value)) <= max } catch { return false } }
export interface DesktopCapturePort {
  start(iceServers: unknown[], quality: string): Promise<{ type: 'offer'; sdp: string }>
  answer(value: unknown): Promise<void>
  ice(value: unknown[]): Promise<void>
  send(label: string, data: unknown, remainingMs?: number): Promise<void>
  quality(value: string): Promise<void>
  stop(): Promise<void>
  identity(): Promise<{ pid: number; birth: string }>
}
/** A dedicated nonpersistent renderer. Main never accepts capture IPC from the workbench. */
export class ElectronDesktopCapture implements DesktopCapturePort {
  private window?: BrowserWindow
  private sequence = 0
  private calls = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  private closing = false
  private ready!: () => void
  private readonly readyPromise = new Promise<void>(resolve => { this.ready = resolve })
  private url = ''
  private processIdentity?: { pid: number; birth: string }
  constructor(private readonly displayId: number, private readonly receive: (event: CaptureEvent) => void) {}
  private trusted(event: IpcMainEvent) {
    const window = this.window
    return !!window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === this.url
  }
  private onReply = (event: IpcMainEvent, result: CaptureReply) => {
    if (!this.trusted(event) || typeof result?.id !== 'string' || !bounded(result, 131072)) return
    const call = this.calls.get(result.id)
    if (!call) return
    this.calls.delete(result.id); clearTimeout(call.timer)
    if (result.error) call.reject(new Error('DESKTOP_CAPTURE_FAILED')); else call.resolve(result.value)
  }
  private onEvent = (event: IpcMainEvent, value: CaptureEvent) => {
    if (!this.trusted(event)) return
    if (value?.event === 'ready') { this.ready(); return }
    if (!['ice', 'data', 'closed', 'health'].includes(value?.event) || !bounded(value, 16384)) { this.receive({ event: 'closed' }); return }
    this.receive(value)
  }
  async open() {
    const partition = `kun-desktop-${randomUUID()}`
    const window = new BrowserWindow({ show: false, width: 1, height: 1, webPreferences: { preload: join(__dirname, '../preload/remote-desktop-capture.cjs'), partition,
      sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } })
    this.window = window
    markProtectedWindowContents(window.webContents)
    const dev = process.env.ELECTRON_RENDERER_URL
    this.url = dev ? new URL('remote-desktop-capture.html', dev.endsWith('/') ? dev : dev + '/').href : pathToFileURL(join(__dirname, '../renderer/remote-desktop-capture.html')).href
    const ses = window.webContents.session
    ses.setPermissionRequestHandler((contents, permission, callback) => callback(contents === window.webContents && String(permission) === 'display-capture' && contents.getURL() === this.url))
    ses.setPermissionCheckHandler((contents, permission) => contents === window.webContents && String(permission) === 'display-capture' && contents.getURL() === this.url)
    ses.setDisplayMediaRequestHandler(async (request, callback) => {
      if (this.closing || request.frame !== window.webContents.mainFrame || request.frame.url !== this.url) { callback({}); return }
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
        const source = sources.find(item => item.display_id === String(this.displayId))
        if (this.closing || !source) callback({}); else callback({ video: source })
      } catch { callback({}) }
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.webContents.once('render-process-gone', () => { if (!this.closing) this.receive({ event: 'closed' }) })
    ipcMain.on(channels.response, this.onReply); ipcMain.on(channels.event, this.onEvent)
    await window.loadURL(this.url)
    await Promise.race([this.readyPromise, new Promise((_, reject) => setTimeout(() => reject(new Error('DESKTOP_CAPTURE_TIMEOUT')), 5000))])
  }
  async identity() {
    const contents = this.window!.webContents, pid = contents.getOSProcessId()
    if (pid <= 1 || webContents.getAllWebContents().some(item => item !== contents && !item.isDestroyed() && item.getOSProcessId() === pid)) throw new Error('DESKTOP_CAPTURE_NOT_ISOLATED')
    const birth = await desktopProcessBirth(pid)
    if (!birth) throw new Error('DESKTOP_CAPTURE_NOT_ISOLATED')
    return this.processIdentity = { pid, birth }
  }
  private command(operation: string, params: Record<string, unknown> = {}) {
    const window = this.window
    if (!window || window.isDestroyed() || this.closing && operation !== 'stop') return Promise.reject(new Error('DESKTOP_CAPTURE_CLOSED'))
    if (this.calls.size >= 240) return Promise.reject(new Error('DESKTOP_INPUT_BACKPRESSURE'))
    const id = String(++this.sequence)
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { this.calls.delete(id); reject(new Error('DESKTOP_CAPTURE_TIMEOUT')) }, operation === 'start' ? 15000 : 2000)
      this.calls.set(id, { resolve, reject, timer }); window.webContents.send(channels.request, { id, operation, params })
    })
  }
  async start(iceServers: unknown[], quality: string): Promise<{ type: 'offer'; sdp: string }> {
    const value = validateDesktopSdp(await this.command('start', { iceServers, quality }), 'offer')
    return { type: 'offer', sdp: value.sdp }
  }
  async answer(answer: unknown) { await this.command('answer', { answer }) }
  async ice(candidates: unknown[]) { await this.command('ice', { candidates }) }
  async send(label: string, data: unknown, remainingMs = 0) { await this.command('send', { label, data, remainingMs }) }
  async quality(quality: string) { await this.command('quality', { quality }) }
  async stop() {
    if (this.closing) {
      if (this.processIdentity) await terminateDesktopProcess(this.processIdentity.pid, this.processIdentity.birth)
      return
    }
    this.closing = true
    await this.command('stop').catch(() => {})
    const window = this.window; this.window = undefined
    ipcMain.removeListener(channels.response, this.onReply); ipcMain.removeListener(channels.event, this.onEvent)
    for (const call of this.calls.values()) { clearTimeout(call.timer); call.reject(new Error('DESKTOP_CAPTURE_CLOSED')) }
    this.calls.clear()
    if (window && !window.isDestroyed()) window.destroy()
    // A renderer acknowledgement/window flag alone is not process-exit proof.
    if (this.processIdentity) await terminateDesktopProcess(this.processIdentity.pid, this.processIdentity.birth)
  }
}
export function displayFingerprint(display: Electron.Display) {
  return JSON.stringify([display.id, display.bounds, display.scaleFactor, display.rotation])
}
export const currentDesktopDisplays = () => screen.getAllDisplays()
