import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROTECTED_DIALOG_TIMEOUT_MS, showProtectedRoomDialog } from './protected-room-dialog'

const electronMock = vi.hoisted(() => ({
  createWindow: vi.fn(),
  getDisplayMatching: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1280, height: 800 } }))
}))
vi.mock('electron', () => ({
  app: { getAppPath: () => '/app' },
  BrowserWindow: function (options: unknown) { return electronMock.createWindow(options) },
  screen: { getDisplayMatching: electronMock.getDisplayMatching }
}))
vi.mock('./main-paths', () => ({ resolveNamedPreloadPath: (_app: string, name: string) => `/preload/${name}.cjs` }))
vi.mock('./protected-room-dialog-html', () => ({ protectedRoomDialogHtml: (_content: unknown, nonce: string) => `<html>${nonce}</html>` }))

class Contents extends EventEmitter {
  id = 20
  mainFrame = { processId: 30, routingId: 40, url: 'about:blank', detached: false }
  destroyed = false
  session = {
    setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(),
    webRequest: { onBeforeRequest: vi.fn() }
  }
  setWindowOpenHandler = vi.fn()
  isDestroyed = () => this.destroyed
  getURL = () => this.mainFrame.url
}
class Window extends EventEmitter {
  destroyed = false
  autoLoad = true
  webContents = new Contents()
  show = vi.fn()
  setMenu = vi.fn()
  getBounds = () => ({ x: 400, y: 200, width: 1000, height: 700 })
  isDestroyed = () => this.destroyed
  destroy = vi.fn(() => { this.destroyed = true; this.emit('closed') })
  loadURL = vi.fn(async (url: string) => {
    if (!this.autoLoad) return
    this.webContents.mainFrame.url = url
    this.webContents.emit('did-start-navigation', {}, url, false, true)
    this.webContents.emit('did-finish-load')
    this.emit('ready-to-show')
  })
}
const content = { title: 'Confirm', subtitle: 'Kun', body: 'Command', workspaceLabel: 'Workspace',
  footnote: 'Once', cancelLabel: 'Cancel', confirmLabel: 'Allow', dark: true }
function gate() {
  let resolve!: (value: boolean) => void
  const promise = new Promise<boolean>((done) => { resolve = done })
  return { promise, resolve }
}
function fixture(current?: () => Promise<boolean>, autoLoad = true, variant?: 'notice' | 'confirmation') {
  const parent = new Window()
  parent.webContents.id = 10
  parent.webContents.mainFrame.url = 'file:///app/index.html'
  const view = new Window()
  view.autoLoad = autoLoad
  electronMock.createWindow.mockReturnValue(view)
  const result = showProtectedRoomDialog(parent as unknown as BrowserWindow, { ...content, variant }, current)
  const options = electronMock.createWindow.mock.calls.at(-1)![0]
  const nonce = options.webPreferences.partition.replace('kun-protected-', '')
  const decide = (confirmed: boolean, override: Record<string, unknown> = {}, frame = view.webContents.mainFrame) => {
    view.webContents.emit('ipc-message', { sender: view.webContents, senderFrame: frame },
      'protected-room:confirm', { confirmed, nonce, ...override })
  }
  return { parent, view, result, options, nonce, decide }
}
async function flush() { for (let count = 0; count < 5; count += 1) await Promise.resolve() }

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks() })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('protected consent window boundary', () => {
  it.each([[undefined, 500], ['confirmation', 360], ['notice', 320]] as const)(
    'uses the appropriate height for %s content', async (variant, height) => {
      const f = fixture(undefined, true, variant)
      expect(f.options).toMatchObject({ width: 560, height })
      f.decide(false)
      await expect(f.result).resolves.toBe(false)
    }
  )

  it('owns a separate restricted session, denies network/permissions and fits the display', async () => {
    electronMock.getDisplayMatching.mockReturnValueOnce({ workArea: { x: 10, y: 20, width: 420, height: 380 } })
    const f = fixture()
    expect(f.options).toMatchObject({ modal: true, frame: false, width: 388, height: 348,
      x: 42, y: 52, backgroundColor: '#1a1a1a',
      webPreferences: { preload: '/preload/protected-room-dialog.cjs', sandbox: true,
        contextIsolation: true, nodeIntegration: false, webviewTag: false, devTools: false } })
    expect(f.nonce).toMatch(/^[a-f0-9]{48}$/)
    expect(f.options.webPreferences.partition).not.toContain('persist:')
    expect(f.view.webContents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' })
    expect(f.view.webContents.session.setPermissionCheckHandler.mock.calls[0][0]()).toBe(false)
    const callback = vi.fn()
    f.view.webContents.session.setPermissionRequestHandler.mock.calls[0][0]({}, 'camera', callback)
    expect(callback).toHaveBeenCalledWith(false)
    const request = f.view.webContents.session.webRequest.onBeforeRequest.mock.calls[0][0]
    request({ url: 'http://127.0.0.1:18899/health', resourceType: 'xhr' }, callback)
    expect(callback).toHaveBeenLastCalledWith({ cancel: true })
    request({ url: f.view.webContents.getURL(), resourceType: 'mainFrame' }, callback)
    expect(callback).toHaveBeenLastCalledWith({ cancel: false })
    f.decide(false)
    await expect(f.result).resolves.toBe(false)
  })

  it('ignores incorrect nonce, sender, subframe, primitive and pre-load decisions', async () => {
    const current = vi.fn(async () => true)
    const f = fixture(current)
    f.decide(true, { nonce: '0'.repeat(48) })
    f.decide(true, {}, { ...f.view.webContents.mainFrame, routingId: 99 })
    f.view.webContents.emit('ipc-message', { sender: { id: 99 }, senderFrame: f.view.webContents.mainFrame },
      'protected-room:confirm', { confirmed: true, nonce: f.nonce })
    f.view.webContents.emit('ipc-message', { sender: f.view.webContents, senderFrame: f.view.webContents.mainFrame },
      'protected-room:confirm', true)
    expect(current).not.toHaveBeenCalled()
    expect(f.view.destroy).not.toHaveBeenCalled()
    f.decide(false)
    await expect(f.result).resolves.toBe(false)
    const loading = fixture(current, false)
    loading.decide(true)
    expect(current).not.toHaveBeenCalled()
    loading.view.emit('closed')
    await expect(loading.result).resolves.toBe(false)
  })

  it('checks live approval at confirmation, ignores double clicks and resolves only once', async () => {
    const pending = gate()
    const current = vi.fn(() => pending.promise)
    const f = fixture(current)
    f.decide(true)
    f.decide(true)
    await flush()
    expect(current).toHaveBeenCalledOnce()
    expect(f.view.destroy).not.toHaveBeenCalled()
    pending.resolve(true)
    await expect(f.result).resolves.toBe(true)
    expect(f.view.destroy).toHaveBeenCalledOnce()
    expect(f.parent.listenerCount('closed')).toBe(0)
    expect(f.parent.webContents.listenerCount('did-start-navigation')).toBe(0)
  })

  it.each(['stale', 'reject', 'parent-frame', 'child-frame', 'cancel'])(
    'fails closed when final validation is %s', async (reason) => {
      const pending = gate()
      const f = fixture(reason === 'reject' ? async () => { throw new Error('offline') } : () => pending.promise)
      f.decide(true)
      await flush()
      if (reason === 'parent-frame') f.parent.webContents.mainFrame.routingId += 1
      if (reason === 'child-frame') f.view.webContents.mainFrame.routingId += 1
      if (reason === 'cancel') f.decide(false)
      pending.resolve(reason !== 'stale')
      await expect(f.result).resolves.toBe(false)
    }
  )

  it.each(['closed', 'navigation', 'crash', 'load-failure', 'preload-failure', 'redirect', 'webview', 'reload'])(
    'closes on %s while a confirmation check is pending', async (event) => {
      const pending = gate()
      const f = fixture(() => pending.promise)
      f.decide(true)
      await flush()
      const preventDefault = vi.fn()
      if (event === 'closed') f.parent.emit('closed')
      if (event === 'navigation') f.parent.webContents.emit('did-start-navigation', {}, 'file:///app/index.html', false, true)
      if (event === 'crash') f.view.webContents.emit('render-process-gone')
      if (event === 'load-failure') f.view.webContents.emit('did-fail-load')
      if (event === 'preload-failure') f.view.webContents.emit('preload-error')
      if (event === 'redirect') f.view.webContents.emit('will-redirect', { preventDefault })
      if (event === 'webview') f.view.webContents.emit('will-attach-webview', { preventDefault })
      if (event === 'reload') f.view.webContents.emit('did-start-navigation', {}, f.view.webContents.getURL(), false, true)
      await expect(f.result).resolves.toBe(false)
      pending.resolve(true)
      await flush()
      expect(f.view.destroy).toHaveBeenCalledOnce()
    }
  )

  it('closes on failed polling or timeout and treats Escape as cancellation', async () => {
    const stale = fixture(async () => false)
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(stale.result).resolves.toBe(false)
    const rejected = fixture(async () => { throw new Error('offline') })
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(rejected.result).resolves.toBe(false)
    const expired = fixture()
    await vi.advanceTimersByTimeAsync(PROTECTED_DIALOG_TIMEOUT_MS)
    await expect(expired.result).resolves.toBe(false)
    const escaped = fixture()
    escaped.view.webContents.emit('before-input-event', {}, { type: 'keyDown', key: 'Escape' })
    await expect(escaped.result).resolves.toBe(false)
  })
})
