import type { BrowserWindow } from 'electron'
import { runtimeJsonError, mainState } from './main-app-context'
import { isAppQuitInProgress, runtimeShutdown } from './main-lifecycle'

const APP_QUITTING_CHANNEL = 'app:quitting'

/** Tell the renderer that quit has started, then hide the window without destroying it. */
export function notifyApplicationQuitting(targetWindow?: BrowserWindow | null): void {
  runtimeShutdown.requestQuit()
  const window = targetWindow && !targetWindow.isDestroyed()
    ? targetWindow
    : mainState.mainWindow
  if (!window || window.isDestroyed()) return
  if (!window.webContents.isDestroyed()) {
    window.webContents.send(APP_QUITTING_CHANNEL)
  }
  window.hide()
}

export function throwIfApplicationQuitting(): void {
  if (!isAppQuitInProgress()) return
  throw runtimeJsonError('runtime_shutting_down', 'Kun application is shutting down')
}
