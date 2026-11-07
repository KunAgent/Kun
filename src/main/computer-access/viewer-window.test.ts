import { afterEach, expect, it, vi } from 'vitest'
import { admitControlOperation, pauseControlAdmission, resumeControlAdmission } from '../control-host/admission'
const h = vi.hoisted(() => ({ resource: vi.fn(), windows: [] as any[], handlers: new Map<string, (...args: any[]) => any>() }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Window extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), {send: vi.fn(), mainFrame: {url: 'file:///verified/release/viewer/index.html'}})
    destroyed = false
    constructor() { super(); h.windows.push(this) }
    destroy() { this.destroyed = true; this.emit('closed') }
    isDestroyed() { return this.destroyed }
    show() {}
  }
  return { app: {getAppPath: () => '/app'}, BrowserWindow: Window,
    ipcMain: {handle: (name: string, run: (...args: any[]) => any) => h.handlers.set(name, run),
      removeHandler: (name: string) => h.handlers.delete(name), on: vi.fn(), removeListener: vi.fn()}, powerMonitor: new EventEmitter() }
})
vi.mock('../control-host/runtime-host', () => ({ controlRuntimeHost: () => ({viewerResource: h.resource}) }))
vi.mock('../control-host/viewer-resources', () => ({ loadControlViewer: vi.fn(async () => {}), secureControlViewer: vi.fn() }))
vi.mock('../main-paths', () => ({ resolveNamedPreloadPath: () => '/app/preload.cjs' }))
vi.mock('../protected-window-contents', () => ({ markProtectedWindowContents: vi.fn() }))
import { ComputerViewerWindow } from './viewer-window'

let viewer: ComputerViewerWindow | undefined
function fixture(open = async () => ({hostId: 'host', name: 'Mac'})) {
  resumeControlAdmission()
  h.resource.mockImplementation(async () => ({entry: '/verified/release/viewer/index.html', release: admitControlOperation()}))
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
