import { app, BrowserWindow, dialog, shell } from 'electron'
import { appIcon } from './main-app-context'
import { logError, logWarn } from './logger'
import {
  parseStartupFailureAction,
  sanitizeStartupFailureMessage,
  startupFailurePresentation,
  startupFailureHtml
} from './startup-failure-content'

export function showStartupFailureWindow(
  error: unknown,
  logDir: string,
  options: {
    recoverHandoff?: () => Promise<void>
    recoverRetry?: () => Promise<void>
    replaceWindow?: BrowserWindow | null
  } = {}
): BrowserWindow | null {
  const presentation = startupFailurePresentation(error)
  const message = presentation.message
  const canRecoverHandoff = presentation.handoff &&
    presentation.retryable &&
    Boolean(options.recoverHandoff)
  logError('startup', 'Kun failed before the desktop became ready.', {
    platform: process.platform,
    packaged: app.isPackaged,
    message
  })

  try {
    const window = new BrowserWindow({
      width: 760,
      height: 560,
      minWidth: 620,
      minHeight: 460,
      title: 'Kun startup recovery',
      icon: appIcon.isEmpty() ? undefined : appIcon,
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        webviewTag: false
      }
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    let recoveryInFlight = false
    const render = (detail: string, busy = false): void => {
      if (window.isDestroyed()) return
      void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(startupFailureHtml(
        detail,
        logDir,
        {
          handoff: presentation.handoff,
          retryable: presentation.handoff ? canRecoverHandoff : true,
          busy
        }
      ))}`).catch((loadError) => {
        logError('startup', 'Failed to render startup recovery window.', {
          message: sanitizeStartupFailureMessage(loadError)
        })
      })
    }
    window.webContents.on('will-navigate', (event, targetUrl) => {
      const action = parseStartupFailureAction(targetUrl)
      if (!action) {
        event.preventDefault()
        return
      }
      event.preventDefault()
      if (action === 'retry') {
        if (recoveryInFlight) return
        if (!presentation.handoff) {
          recoveryInFlight = true
          render(message, true)
          void (options.recoverRetry?.() ?? Promise.resolve()).then(() => {
            app.relaunch()
            app.quit()
          }).catch((recoveryError) => {
            recoveryInFlight = false
            const detail = sanitizeStartupFailureMessage(recoveryError)
            logWarn('startup', 'Kun startup retry cleanup failed.', { message: detail })
            render(`${message}\n\nRetry failed: ${detail}`)
          })
          return
        }
        if (!canRecoverHandoff || !options.recoverHandoff) return
        recoveryInFlight = true
        render(message, true)
        void options.recoverHandoff().then(() => {
          app.relaunch()
          app.quit()
        }).catch((recoveryError) => {
          recoveryInFlight = false
          const detail = sanitizeStartupFailureMessage(recoveryError)
          logWarn('startup', 'Safe Kun handoff retry failed.', { message: detail })
          render(`${message}\n\nRetry failed: ${detail}`)
        })
      } else if (action === 'quit') {
        app.quit()
      } else {
        void shell.openPath(logDir).then((openError) => {
          if (!openError) return
          logWarn('startup', 'Failed to open startup log directory.', { message: openError })
          dialog.showErrorBox('Could not open log folder', openError)
        })
      }
    })
    window.once('ready-to-show', () => window.show())
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(startupFailureHtml(
      message,
      logDir,
      {
        handoff: presentation.handoff,
        retryable: presentation.handoff ? canRecoverHandoff : true
      }
    ))}`)
      .catch((loadError) => {
        logError('startup', 'Failed to render startup recovery window.', {
          message: sanitizeStartupFailureMessage(loadError)
        })
        if (!window.isDestroyed()) window.show()
        dialog.showErrorBox('Kun failed to start', message)
      })
    const replacedWindow = options.replaceWindow
    if (replacedWindow && replacedWindow !== window && !replacedWindow.isDestroyed()) {
      replacedWindow.destroy()
    }
    return window
  } catch (fallbackError) {
    logError('startup', 'Failed to create startup recovery window.', {
      message: sanitizeStartupFailureMessage(fallbackError)
    })
    dialog.showErrorBox('Kun failed to start', message)
    return null
  }
}
