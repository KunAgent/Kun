import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import type { Manifest } from '@kun/control-host'
import { resolveNamedPreloadPath } from '../main-paths'
import { COMPUTER_VIEWER_CHANNELS as channels } from '../../shared/computer-viewer-channels'

/** Only called with a manifest and directory already authenticated by ControlPackageManager. */
export function controlViewerEntry(directory: string, release: Manifest): string {
  if (release.viewerApi !== 1 || release.entrypoints.viewer !== 'viewer/index.html' ||
      !['viewer/index.html', 'viewer/viewer.js', 'viewer/viewer.css'].every(path => release.files[path]))
    throw Error('CONTROL_VIEWER_UPGRADE_REQUIRED')
  return join(directory, release.entrypoints.viewer)
}

export function secureControlViewer(window: BrowserWindow, entry: string) {
  const url = pathToFileURL(entry)
  const allowed = new Set([url.href, new URL('viewer.js', url).href, new URL('viewer.css', url).href])
  const session = window.webContents.session
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)
  session.setDisplayMediaRequestHandler((_request, callback) => callback({}))
  session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowed.has(details.url) }))
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.on('will-redirect', event => event.preventDefault())
}

/** A parsed HTML file alone is insufficient: wait for the packaged JS to reach its boot handshake. */
export async function loadControlViewer(window: BrowserWindow, url: string, timeoutMs = 8000) {
  let cleanup = () => {}
  const boot = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('CONTROL_VIEWER_START_TIMEOUT')), timeoutMs)
    const ready = (event: Electron.IpcMainEvent, api: unknown) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== url) return
      if (api === 1) resolve()
      else reject(Error('CONTROL_VIEWER_API_MISMATCH'))
    }
    const failed = () => reject(Error('CONTROL_VIEWER_START_FAILED'))
    ipcMain.on(channels.ready, ready)
    window.webContents.once('render-process-gone', failed)
    window.once('closed', failed)
    cleanup = () => {
      clearTimeout(timer); ipcMain.removeListener(channels.ready, ready)
      window.removeListener('closed', failed)
      if (!window.webContents.isDestroyed()) window.webContents.removeListener('render-process-gone', failed)
    }
  })
  try { await Promise.all([window.loadURL(url), boot]) } finally { cleanup() }
}

/** Exercises the candidate UI without credentials, signaling, capture or native input. */
export async function probeControlViewer(directory: string, release: Manifest) {
  const entry = controlViewerEntry(directory, release)
  const window = new BrowserWindow({ show: false, webPreferences: {
    preload: resolveNamedPreloadPath(app.getAppPath(), 'control-viewer-probe'),
    partition: 'kun-control-probe-' + randomUUID(), sandbox: true, contextIsolation: true,
    nodeIntegration: false, backgroundThrottling: false
  } })
  try {
    secureControlViewer(window, entry)
    await loadControlViewer(window, pathToFileURL(entry).href)
  } finally { if (!window.isDestroyed()) window.destroy() }
}
