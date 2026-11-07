import { app, BrowserWindow, ipcMain, powerMonitor, type IpcMainInvokeEvent, type IpcMainEvent } from 'electron'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import type { ComputerViewerEvent } from '../../shared/computer-access'
import { COMPUTER_VIEWER_CHANNELS as channels } from '../../shared/computer-viewer-channels'
import { resolveNamedPreloadPath } from '../main-paths'
import { markProtectedWindowContents } from '../protected-window-contents'
import type { ComputerAccessService } from './service'
import { controlRuntimeHost } from '../control-host/runtime-host'
import { loadControlViewer, secureControlViewer } from '../control-host/viewer-resources'

/** No workbench bridge, account credentials, permission grants or arbitrary navigation. */
export class ComputerViewerWindow {
  private window?: BrowserWindow
  private url = ''
  private hostId = ''
  private heartbeatAt = 0
  private timer?: ReturnType<typeof setInterval>
  private disposed = false
  private opening = false
  private generation = 0
  private releasePackage?: () => void
  constructor(private readonly service: ComputerAccessService) {
    ipcMain.handle(channels.configuration, event => { this.require(event); return service.configuration() })
    ipcMain.handle(channels.invoke, (event, method, params) => {
      this.require(event)
      if (method === 'desktop.control.acquire' && !this.window?.isFocused()) throw Error('DESKTOP_WINDOW_INACTIVE')
      if (typeof method !== 'string' || Buffer.byteLength(JSON.stringify(params ?? null)) > 100000) throw Error('INVALID_REQUEST')
      return service.invoke(method as any, params)
    })
    ipcMain.handle(channels.ice, event => { this.require(event); return service.ice() })
    ipcMain.handle(channels.restart, event => { this.require(event); return this.restart() })
    ipcMain.handle(channels.close, event => { this.require(event); return this.close('user_ended') })
    ipcMain.handle(channels.fullscreen, event => {
      this.require(event); const window = this.window!; window.setFullScreen(!window.isFullScreen()); return window.isFullScreen()
    })
    ipcMain.on(channels.heartbeat, this.heartbeat)
    powerMonitor.on('lock-screen', this.inactive)
    powerMonitor.on('suspend', this.inactive)
    powerMonitor.on('user-did-resign-active', this.inactive)
  }
  private require(event: IpcMainInvokeEvent | IpcMainEvent) {
    if (this.disposed || !this.window || this.window.isDestroyed() || event.sender !== this.window.webContents ||
        event.senderFrame !== this.window.webContents.mainFrame || event.senderFrame.url !== this.url) throw Error('UNTRUSTED_DESKTOP_VIEWER')
  }
  private heartbeat = (event: IpcMainEvent) => {
    try {
      this.require(event)
      if (!this.window!.isVisible() || this.window!.isMinimized()) { void this.close('window_hidden'); return }
      this.heartbeatAt = performance.now()
      this.event({ type: 'lease', validForMs: 1500 })
    } catch { /* Untrusted heartbeats never extend the current viewer's lifetime. */ }
  }
  private inactive = () => { void this.close('controller_inactive') }
  private async restart() {
    if (this.opening || this.disposed) throw Error('DESKTOP_BUSY')
    const window = this.window, generation = this.generation
    this.opening = true
    try {
      const configuration = await this.service.open(this.hostId)
      if (this.disposed || generation !== this.generation || this.window !== window || window?.isDestroyed())
        throw Error('DESKTOP_CANCELLED')
      return configuration
    } catch (error) {
      if (generation !== this.generation || this.window !== window) await this.close('viewer_cancelled')
      throw error
    } finally {
      this.opening = false
      if (!this.window) { this.releasePackage?.(); this.releasePackage = undefined }
    }
  }
  event(value: ComputerViewerEvent) {
    const window = this.window
    if (window && !window.isDestroyed()) window.webContents.send(channels.event, value)
    if (value.type === 'close') {
      ++this.generation
      clearInterval(this.timer); this.timer = undefined; this.window = undefined
      if (window && !window.isDestroyed()) window.destroy()
      if (!this.opening) { this.releasePackage?.(); this.releasePackage = undefined }
    }
  }
  async open(hostId: string) {
    if (this.disposed || this.opening) throw Error('DESKTOP_BUSY')
    if (this.window && !this.window.isDestroyed()) {
      if (this.service.status().active) throw Error('DESKTOP_BUSY')
      const ended = this.window; this.window = undefined
      clearInterval(this.timer); this.timer = undefined; ended.destroy()
      this.releasePackage?.(); this.releasePackage = undefined
    }
    this.opening = true
    const generation = ++this.generation
    try {
      const resource = await controlRuntimeHost().viewerResource()
      if (this.disposed || generation !== this.generation) { resource.release(); throw Error('DESKTOP_CANCELLED') }
      this.releasePackage = resource.release
      const configuration = await this.service.open(hostId)
      if (this.disposed || generation !== this.generation) throw Error('DESKTOP_CANCELLED')
      this.hostId = hostId
      const appPath = app.getAppPath()
      const window = new BrowserWindow({ title: `${configuration.name} — Kun`, width: 1180, height: 780, minWidth: 640, minHeight: 460, show: false,
        webPreferences: { preload: resolveNamedPreloadPath(appPath, 'remote-desktop-viewer'), partition: 'kun-viewer-' + randomUUID(),
          sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
      this.window = window
      markProtectedWindowContents(window.webContents)
      this.url = pathToFileURL(resource.entry).href
      secureControlViewer(window, resource.entry)
      window.webContents.once('render-process-gone', () => { void this.close('viewer_crashed') })
      window.on('blur', () => this.service.release())
      window.on('minimize', () => { void this.close('window_minimized') })
      window.on('hide', () => { void this.close('window_hidden') })
      window.on('close', event => { event.preventDefault(); void this.close('window_closed') })
      window.once('closed', () => { if (this.window === window) { this.window = undefined; void this.close('window_closed') } })
      window.show()
      await loadControlViewer(window, this.url)
      if (this.window !== window || window.isDestroyed()) throw Error('DESKTOP_CANCELLED')
      window.show(); this.heartbeatAt = performance.now()
      this.timer = setInterval(() => { if (performance.now() - this.heartbeatAt > 2500) void this.close('viewer_unresponsive') }, 500)
      this.timer.unref()
    } catch (error) { await this.close('viewer_load_failed'); throw error }
    finally {
      this.opening = false
      if (!this.window) { this.releasePackage?.(); this.releasePackage = undefined }
    }
    return this.service.status()
  }
  async close(reason = 'user_ended') {
    ++this.generation
    // A delayed stop reply must not release a newer window's package reservation.
    const releasePackage = this.releasePackage
    clearInterval(this.timer); this.timer = undefined
    const stopping = this.service.close(reason)
    const window = this.window; this.window = undefined
    if (window && !window.isDestroyed()) window.destroy()
    await stopping
    if (!this.opening && this.releasePackage === releasePackage) { releasePackage?.(); this.releasePackage = undefined }
  }
  async dispose() {
    await this.close('application_quit'); this.disposed = true
    ipcMain.removeListener(channels.heartbeat, this.heartbeat)
    powerMonitor.removeListener('lock-screen', this.inactive)
    powerMonitor.removeListener('suspend', this.inactive)
    powerMonitor.removeListener('user-did-resign-active', this.inactive)
    for (const channel of [channels.configuration, channels.invoke, channels.ice, channels.close, channels.fullscreen, channels.restart]) ipcMain.removeHandler(channel)
  }
}
