import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
const electron = vi.hoisted(() => ({ ipcMain: { on: vi.fn(), removeListener: vi.fn() } }))
vi.mock('electron', () => ({ ...electron, app: {}, BrowserWindow: vi.fn() }))
import { controlViewerEntry, loadControlViewer, secureControlViewer } from './viewer-resources'

function windowFixture() {
  const contents = Object.assign(new EventEmitter(), {
    mainFrame: { url: 'file:///control/release/viewer/index.html' }, isDestroyed: () => false,
    setWindowOpenHandler: vi.fn(), session: {
      setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), setDisplayMediaRequestHandler: vi.fn(),
      webRequest: { onBeforeRequest: vi.fn() }
    }
  })
  return Object.assign(new EventEmitter(), { webContents: contents, loadURL: vi.fn(async () => {}) })
}
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers() })
it('requires an explicit compatible signed viewer entry and all boot resources', () => {
  const release = { viewerApi: 1, entrypoints: {viewer: 'viewer/index.html'},
    files: {'viewer/index.html': {}, 'viewer/viewer.js': {}, 'viewer/viewer.css': {}} } as any
  expect(controlViewerEntry('/signed/release', release)).toBe('/signed/release/viewer/index.html')
  expect(() => controlViewerEntry('/signed/release', {...release, viewerApi: undefined})).toThrow('CONTROL_VIEWER_UPGRADE_REQUIRED')
  expect(() => controlViewerEntry('/signed/release', {...release, entrypoints: {viewer: '../index.html'}})).toThrow()
})
it('ignores stale or foreign handshakes and bounds a page that never boots', async () => {
  vi.useFakeTimers()
  const window = windowFixture(), url = window.webContents.mainFrame.url
  const boot = loadControlViewer(window as any, url, 1000)
  const rejected = expect(boot).rejects.toThrow('CONTROL_VIEWER_START_TIMEOUT')
  const receive = electron.ipcMain.on.mock.calls[0][1]
  receive({ sender: {}, senderFrame: window.webContents.mainFrame }, 1)
  receive({ sender: window.webContents, senderFrame: {url} }, 1)
  await vi.advanceTimersByTimeAsync(1001); await rejected
  expect(electron.ipcMain.removeListener).toHaveBeenCalled()
})
it('accepts only the exact live main frame and clears startup listeners', async () => {
  const window = windowFixture(), url = window.webContents.mainFrame.url
  const boot = loadControlViewer(window as any, url)
  electron.ipcMain.on.mock.calls[0][1]({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, 1)
  await boot
  expect(window.listenerCount('closed')).toBe(0)
  expect(window.webContents.listenerCount('render-process-gone')).toBe(0)
})
it('blocks network requests and files outside the verified viewer resources', () => {
  const window = windowFixture()
  secureControlViewer(window as any, '/control/release/viewer/index.html')
  const request = window.webContents.session.webRequest.onBeforeRequest.mock.calls[0][0]
  for (const [url, cancel] of [
    ['file:///control/release/viewer/viewer.js', false],
    ['file:///control/release/viewer/viewer.css', false],
    ['file:///control/release/runtime/index.mjs', true], ['https://example.test/code.js', true]
  ] as const) {
    const callback = vi.fn(); request({url}, callback); expect(callback).toHaveBeenCalledWith({cancel})
  }
})
