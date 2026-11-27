import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ipcMain } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { admitControlOperation, pauseControlAdmission, resumeControlAdmission } from '../control-host/admission'
const viewerEntry = resolve('verified release', 'viewer', 'index.html')
const h = vi.hoisted(() => ({ resource: vi.fn(), windows: [] as any[], handlers: new Map<string, (...args: any[]) => any>() }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Window extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), {send: vi.fn(), mainFrame: {url: pathToFileURL(viewerEntry).href}})
    destroyed = false
    full = false
    setFullScreen = vi.fn()
    constructor() { super(); h.windows.push(this) }
    destroy() { this.destroyed = true; this.emit('closed') }
    isDestroyed() { return this.destroyed }
    isVisible() { return true }
    isMinimized() { return false }
    isFullScreen() { return this.full }
    show() {}
  }
  return { app: {getAppPath: () => '/app'}, BrowserWindow: Window,
    ipcMain: Object.assign(new EventEmitter(), {handle: (name: string, run: (...args: any[]) => any) => h.handlers.set(name, run),
      removeHandler: (name: string) => h.handlers.delete(name)}), powerMonitor: new EventEmitter() }
})
vi.mock('node:child_process', async importOriginal => {
  const { EventEmitter } = await import('node:events')
  // The Linux session watcher belongs to the OS, not to the mocked viewer lifecycle.
  return { ...await importOriginal<typeof import('node:child_process')>(), spawn: () => new EventEmitter() }
})
vi.mock('../control-host/runtime-host', () => ({ controlRuntimeHost: () => ({viewerResource: h.resource}) }))
vi.mock('../control-host/viewer-resources', () => ({ loadControlViewer: vi.fn(async () => {}), secureControlViewer: vi.fn() }))
vi.mock('../main-paths', () => ({ resolveNamedPreloadPath: () => '/app/preload.cjs' }))
vi.mock('../protected-window-contents', () => ({ markProtectedWindowContents: vi.fn() }))
import { ComputerViewerWindow } from './viewer-window'

let viewer: ComputerViewerWindow | undefined
function fixture(open = async () => ({hostId: 'host', name: 'Mac'})) {
  resumeControlAdmission()
  h.resource.mockImplementation(async () => ({entry: viewerEntry, release: admitControlOperation()}))
  const service = { open: vi.fn(open), close: vi.fn(async () => {}), status: () => ({}), release: vi.fn(), configuration: vi.fn() }
  viewer = new ComputerViewerWindow(service as any)
  return service
}
afterEach(async () => { await viewer?.dispose(); viewer = undefined; resumeControlAdmission(); h.windows.length = 0; vi.clearAllMocks() })
it('pins the package for the complete viewer lifetime including gaps between desktop sessions', async () => {
  const service = fixture()
  await viewer!.open('host')
  expect(service.status()).toEqual({}) // No active remote session while changing display.
  expect(pauseControlAdmission()).toBe(false)
  await viewer!.close()
  expect(pauseControlAdmission()).toBe(true)
})
it('keeps update admission closed until a cancelled asynchronous open has drained', async () => {
  let finish!: (value: {hostId: string; name: string}) => void
  const service = fixture(() => new Promise(resolve => { finish = resolve }))
  const opening = viewer!.open('host')
  const rejected = expect(opening).rejects.toThrow('DESKTOP_CANCELLED')
  await vi.waitFor(() => expect(service.open).toHaveBeenCalled())
  await viewer!.close()
  expect(pauseControlAdmission()).toBe(false)
  finish({hostId: 'host', name: 'Mac'})
  await rejected
  expect(h.windows).toHaveLength(0)
  expect(pauseControlAdmission()).toBe(true)
})
it('releases the package after an unexpected native window destruction even without a live session', async () => {
  fixture()
  await viewer!.open('host')
  h.windows[0].destroy()
  await vi.waitFor(() => expect(pauseControlAdmission()).toBe(true))
})
it('rejects fullscreen IPC after the main frame leaves the verified viewer URL', async () => {
  fixture(); await viewer!.open('host')
  const window = h.windows[0], contents = window.webContents
  contents.mainFrame.url = new URL('other.html', contents.mainFrame.url).href
  expect(() => h.handlers.get('computer-viewer:fullscreen')!({ sender: contents, senderFrame: contents.mainFrame }, true))
    .toThrow('UNTRUSTED_DESKTOP_VIEWER')
  expect(window.setFullScreen).not.toHaveBeenCalled()
})
it('waits for native fullscreen, coalesces clicks and follows an exit performed through system controls', async () => {
  fixture(); await viewer!.open('host')
  const window = h.windows[0], contents = window.webContents
  const toggle = (active?: boolean) => h.handlers.get('computer-viewer:fullscreen')!({sender:contents,senderFrame:contents.mainFrame}, active)
  const enter = toggle(true)
  expect(toggle(true)).toBe(enter)
  expect(window.setFullScreen).toHaveBeenCalledExactlyOnceWith(true)
  window.full = true; window.emit('enter-full-screen')
  await expect(enter).resolves.toBe(true)
  window.full = false; window.emit('leave-full-screen')
  expect(contents.send).toHaveBeenLastCalledWith('computer-viewer:event', {type:'fullscreen',active:false})
  const again = toggle()
  expect(window.setFullScreen).toHaveBeenLastCalledWith(true)
  window.destroy()
  await expect(again).rejects.toThrow('DESKTOP_CANCELLED')
})
it('reports a native fullscreen transition that never completed and allows another request', async () => {
  vi.useFakeTimers()
  try {
    fixture(); await viewer!.open('host')
    const window = h.windows[0], contents = window.webContents
    const event = { sender: contents, senderFrame: contents.mainFrame }
    const toggle = () => h.handlers.get('computer-viewer:fullscreen')!(event, true)
    const rejected = expect(toggle()).rejects.toThrow('DESKTOP_FULLSCREEN_FAILED')
    for (let elapsed = 0; elapsed < 4500; elapsed += 500) {
      ipcMain.emit('computer-viewer:heartbeat', event)
      await vi.advanceTimersByTimeAsync(500)
    }
    await rejected
    const retry = toggle()
    window.full = true; window.emit('enter-full-screen')
    await expect(retry).resolves.toBe(true)
  } finally { vi.useRealTimers() }
})
it.each(['window_close', 'authority_close'])('fences a pending display restart after %s before releasing the package', async reason => {
  const service = fixture()
  await viewer!.open('host')
  let finish!: (value: {hostId: string; name: string}) => void
  service.open.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const contents = h.windows[0].webContents
  const restart = h.handlers.get('computer-viewer:restart')!({ sender: contents, senderFrame: contents.mainFrame })
  const rejected = expect(restart).rejects.toThrow('DESKTOP_CANCELLED')
  await vi.waitFor(() => expect(service.open).toHaveBeenCalledTimes(2))
  if (reason === 'window_close') await viewer!.close()
  else viewer!.event({type: 'close', reason: 'account_changed'})
  expect(pauseControlAdmission()).toBe(false)
  finish({hostId: 'host', name: 'Mac'})
  await rejected
  expect(service.close).toHaveBeenCalledWith('viewer_cancelled')
  expect(pauseControlAdmission()).toBe(true)
})
it('an old close reply cannot release the package pinned by a newer viewer', async () => {
  const service = fixture()
  await viewer!.open('host')
  let finish!: () => void
  service.close.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const oldClose = viewer!.close()
  viewer!.event({type: 'close', reason: 'confirmed_ended'})
  await viewer!.open('host')
  finish(); await oldClose
  expect(pauseControlAdmission()).toBe(false)
  await viewer!.close()
  expect(pauseControlAdmission()).toBe(true)
})
