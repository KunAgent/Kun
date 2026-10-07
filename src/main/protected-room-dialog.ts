import { resolveNamedPreloadPath } from './main-paths'
import { app, BrowserWindow, screen, type WebFrameMain } from 'electron'
import { randomBytes } from 'node:crypto'
import { protectedRoomDialogHtml, type ProtectedRoomDialogContent } from './protected-room-dialog-html'
import { markProtectedWindowContents } from './protected-window-contents'

export const PROTECTED_DIALOG_TIMEOUT_MS = 5 * 60_000
const FITTED_MIN_HEIGHT = 220
const FITTED_MAX_HEIGHT = 640
// Main-authored and read-only: lays the dialog out once at its natural height.
// Short prompts then carry no empty band above the buttons, long ones grow
// before they scroll. Setting CSSOM properties is not an inline style for CSP.
const NATURAL_HEIGHT_SCRIPT = `(() => {
  const main = document.querySelector('main'), scroll = document.querySelector('.content-scroll');
  if (!main || !scroll) return 0;
  main.style.height = 'auto'; scroll.style.flex = 'none';
  const height = Math.ceil(main.getBoundingClientRect().height);
  main.style.height = ''; scroll.style.flex = '';
  return height;
})()`

type FrameIdentity = { processId: number; routingId: number; url: string }
function frameIdentity(frame: WebFrameMain): FrameIdentity {
  return { processId: frame.processId, routingId: frame.routingId, url: frame.url }
}
function frameMatches(frame: WebFrameMain | null, identity: FrameIdentity): boolean {
  return Boolean(frame && !frame.detached && frame.processId === identity.processId &&
    frame.routingId === identity.routingId && frame.url === identity.url)
}

/** A dedicated Main-owned surface; no workbench bridge, extension scripts or shared session. */
export function showProtectedRoomDialog(
  parent: BrowserWindow,
  content: ProtectedRoomDialogContent,
  current?: () => Promise<boolean>
): Promise<boolean> {
  if (parent.isDestroyed() || parent.webContents.isDestroyed()) return Promise.resolve(false)
  const parentFrame = frameIdentity(parent.webContents.mainFrame)
  const nonce = randomBytes(24).toString('hex')
  const documentUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(protectedRoomDialogHtml(content, nonce))
  const bounds = parent.getBounds()
  const area = screen.getDisplayMatching(bounds).workArea
  const width = Math.max(1, Math.min(560, area.width - 32))
  const preferredHeight = content.variant === 'notice' ? 320 : content.variant === 'confirmation' ? 360 : 500
  const height = Math.max(1, Math.min(preferredHeight, area.height - 32))
  const x = Math.round(Math.max(area.x, Math.min(bounds.x + (bounds.width - width) / 2, area.x + area.width - width)))
  const y = Math.round(Math.max(area.y, Math.min(bounds.y + (bounds.height - height) / 2, area.y + area.height - height)))
  const view = new BrowserWindow({
    parent, modal: true, frame: false, show: false, width, height, x, y,
    resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, autoHideMenuBar: true,
    backgroundColor: content.dark ? '#1a1a1a' : '#fafafa',
    webPreferences: {
      preload: resolveNamedPreloadPath(app.getAppPath(), 'protected-room-dialog'),
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
      devTools: false, partition: 'kun-protected-' + nonce
    }
  })
  markProtectedWindowContents(view.webContents)
  view.setMenu(null)
  const session = view.webContents.session
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)
  // The document and its assets are entirely inline. A unique nonpersistent
  // session prevents any workbench/extension resource handler from joining it.
  session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: details.url !== documentUrl || details.resourceType !== 'mainFrame' })
  })

  return new Promise((resolve) => {
    let settled = false
    let polling = false
    let confirming = false
    let initialNavigationStarted = false
    let readyToShow = false
    let fitted = false
    let loadedFrame: FrameIdentity | undefined
    let generation = 0
    const parentIsCurrent = (): boolean => !parent.isDestroyed() && !parent.webContents.isDestroyed() &&
      frameMatches(parent.webContents.mainFrame, parentFrame)
    const documentIsCurrent = (): boolean => !view.isDestroyed() && !view.webContents.isDestroyed() &&
      Boolean(loadedFrame && frameMatches(view.webContents.mainFrame, loadedFrame)) &&
      view.webContents.getURL() === documentUrl
    const finish = (confirmed: boolean): void => {
      if (settled) return
      settled = true
      clearInterval(pollTimer)
      clearTimeout(timeout)
      parent.removeListener('closed', parentClosed)
      parent.webContents.removeListener('destroyed', parentClosed)
      parent.webContents.removeListener('did-start-navigation', parentNavigation)
      resolve(confirmed)
      if (!view.isDestroyed()) view.destroy()
    }
    const showWhenReady = (): void => {
      if (!settled && loadedFrame && readyToShow && fitted && parentIsCurrent()) view.show()
    }
    const fitToContent = async (): Promise<void> => {
      if (typeof view.webContents.executeJavaScript !== 'function') return
      const natural = Number(await view.webContents.executeJavaScript(NATURAL_HEIGHT_SCRIPT))
      if (settled || view.isDestroyed() || !Number.isFinite(natural) || natural <= 0) return
      const fittedHeight = Math.round(Math.max(1, Math.min(Math.max(natural, FITTED_MIN_HEIGHT), FITTED_MAX_HEIGHT, area.height - 32)))
      if (fittedHeight === height) return
      const fittedY = Math.round(Math.max(area.y, Math.min(bounds.y + (bounds.height - fittedHeight) / 2, area.y + area.height - fittedHeight)))
      view.setBounds({ x, y: fittedY, width, height: fittedHeight })
    }
    const parentClosed = (): void => finish(false)
    const parentNavigation = (_event: unknown, _url: string, _inPlace: boolean, isMainFrame: boolean): void => {
      if (isMainFrame) finish(false)
    }
    const pollTimer = setInterval(() => {
      if (!current || settled || polling || confirming) return
      polling = true
      void Promise.resolve().then(current).then((active) => {
        if (!active || !parentIsCurrent()) finish(false)
      }, () => finish(false)).finally(() => { polling = false })
    }, 1_000)
    pollTimer.unref()
    const timeout = setTimeout(() => finish(false), PROTECTED_DIALOG_TIMEOUT_MS)
    timeout.unref()
    parent.once('closed', parentClosed)
    parent.webContents.once('destroyed', parentClosed)
    parent.webContents.on('did-start-navigation', parentNavigation)
    view.once('closed', () => finish(false))
    view.webContents.once('destroyed', () => finish(false))
    view.webContents.once('preload-error', () => finish(false))
    view.webContents.once('render-process-gone', () => finish(false))
    view.webContents.on('did-fail-load', () => finish(false))
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    view.webContents.on('will-navigate', (event) => { event.preventDefault(); finish(false) })
    view.webContents.on('will-redirect', (event) => { event.preventDefault(); finish(false) })
    view.webContents.on('will-attach-webview', (event) => { event.preventDefault(); finish(false) })
    view.webContents.on('did-start-navigation', (_event, url, inPlace, isMainFrame) => {
      if (!isMainFrame) { finish(false); return }
      generation += 1
      if (initialNavigationStarted || loadedFrame || inPlace || url !== documentUrl) { finish(false); return }
      initialNavigationStarted = true
    })
    view.webContents.on('did-finish-load', () => {
      if (settled) return
      if (loadedFrame || !parentIsCurrent() || view.webContents.getURL() !== documentUrl) { finish(false); return }
      loadedFrame = frameIdentity(view.webContents.mainFrame)
      void fitToContent().catch(() => undefined).finally(() => {
        fitted = true
        showWhenReady()
      })
    })
    view.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') finish(false)
    })
    view.webContents.on('ipc-message', (event, channel, payload: unknown) => {
      if (settled || channel !== 'protected-room:confirm' || !payload || typeof payload !== 'object') return
      const decision = payload as { confirmed?: unknown; nonce?: unknown }
      if (typeof decision.confirmed !== 'boolean' || decision.nonce !== nonce ||
        event.sender.id !== view.webContents.id || !loadedFrame ||
        !frameMatches(event.senderFrame, loadedFrame) || !documentIsCurrent() || !parentIsCurrent()) return
      if (!decision.confirmed) { finish(false); return }
      if (confirming) return
      confirming = true
      const submittedGeneration = generation
      void Promise.resolve().then(() => current?.() ?? true).then((active) => {
        finish(active === true && generation === submittedGeneration && parentIsCurrent() && documentIsCurrent())
      }, () => finish(false))
    })
    view.once('ready-to-show', () => {
      readyToShow = true
      showWhenReady()
    })
    if (!parentIsCurrent()) { finish(false); return }
    void view.loadURL(documentUrl).catch(() => finish(false))
  })
}
