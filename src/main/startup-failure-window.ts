import { app, BrowserWindow, clipboard, dialog, shell } from 'electron'
import { appIcon } from './main-app-context'
import { logError, logWarn } from './logger'
import {
  parseStartupFailureAction,
  sanitizeStartupFailureMessage,
  startupFailurePresentation,
  startupFailureHtml
} from './startup-failure-content'
import { startupFailureCopy, startupFailureLanguage } from './startup-failure-copy'
import { readStartupLogTail, startupDiagnosticsReport, startupLogSource } from './startup-failure-log'
import type { StartupFailurePageOptions } from './startup-failure-page'

export const STARTUP_RECOVERY_TIMEOUT_MS = 45_000

export function showStartupFailureWindow(
  error: unknown,
  logDir: string,
  options: {
    recoverHandoff?: (signal: AbortSignal) => Promise<void>
    recoverRetry?: (signal: AbortSignal) => Promise<void>
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
      height: 640,
      minWidth: 560,
      minHeight: 480,
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
    const launchIdentity = {
      appVersion: app.getVersion(),
      execPath: process.execPath
    }
    const locale = app.getLocale()
    const copy = startupFailureCopy(startupFailureLanguage(locale))
    const logSource = startupLogSource(message, logDir)
    // A missing referenced log is itself a finding; a missing desktop log is not.
    const logTail = () => {
      if (!logSource) return undefined
      const tail = readStartupLogTail(logSource.path)
      return tail || !logSource.referenced ? tail ?? undefined : null
    }
    let recoveryInFlight = false
    let recoveryController: AbortController | undefined
    let notice: StartupFailurePageOptions['notice']
    const htmlOptions = (busy = false): StartupFailurePageOptions => ({
      kind: presentation.kind,
      handoff: presentation.handoff,
      retryable: presentation.handoff ? canRecoverHandoff : presentation.retryable,
      recheck: presentation.recheck,
      orphaned: presentation.orphaned,
      busy,
      locale,
      notice,
      logTail: logTail(),
      ...launchIdentity
    })
    const render = (busy = false): void => {
      if (window.isDestroyed()) return
      void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(startupFailureHtml(
        message,
        logDir,
        htmlOptions(busy)
      ))}`).catch((loadError) => {
        logError('startup', 'Failed to render startup recovery window.', {
          message: sanitizeStartupFailureMessage(loadError)
        })
      })
    }
    const recover = async (operation: (signal: AbortSignal) => Promise<void>): Promise<void> => {
      recoveryInFlight = true
      const controller = new AbortController()
      recoveryController = controller
      notice = undefined
      render(true)
      let rejectAborted!: (error: unknown) => void
      const aborted = new Promise<never>((_resolve, reject) => { rejectAborted = reject })
      const onAbort = () => rejectAborted(controller.signal.reason)
      controller.signal.addEventListener('abort', onAbort, { once: true })
      const timer = presentation.handoff ? undefined : setTimeout(() => controller.abort(new Error(
        'Recovery timed out after 45 seconds. Kun has not restarted. Retry to recheck the remaining processes, or quit and reopen the app.'
      )), STARTUP_RECOVERY_TIMEOUT_MS)
      try {
        // Catch synchronous failures too, and never relaunch on a late result
        // after timeout, window close, or an explicit Quit.
        await Promise.race([operation(controller.signal), aborted])
        controller.signal.throwIfAborted()
        if (window.isDestroyed()) return
        app.relaunch()
        app.quit()
      } catch (recoveryError) {
        const detail = sanitizeStartupFailureMessage(recoveryError)
        logWarn('startup', 'Kun startup retry cleanup failed.', { message: detail })
        notice = { tone: 'error', text: `${copy.retryFailed} ${detail}` }
        render()
      } finally {
        if (timer) clearTimeout(timer)
        controller.signal.removeEventListener('abort', onAbort)
        recoveryInFlight = false
        recoveryController = undefined
      }
    }
    window.once('closed', () => recoveryController?.abort(new Error('Recovery window closed')))
    window.webContents.on('will-navigate', (event, targetUrl) => {
      const action = parseStartupFailureAction(targetUrl)
      if (!action) {
        event.preventDefault()
        return
      }
      event.preventDefault()
      if (action === 'retry') {
        if (recoveryInFlight || !presentation.retryable) return
        if ((presentation.recheck || presentation.orphaned) && !options.recoverRetry) return
        if (!presentation.handoff) {
          void recover(options.recoverRetry ?? (async () => undefined))
          return
        }
        if (!canRecoverHandoff || !options.recoverHandoff) return
        void recover(options.recoverHandoff)
      } else if (action === 'quit') {
        recoveryController?.abort(new Error('Recovery cancelled by Quit'))
        app.quit()
      } else if (action === 'copy-diagnostics') {
        clipboard.writeText(startupDiagnosticsReport({
          title: copy.kinds[presentation.kind].title,
          kind: presentation.kind,
          message,
          logDir,
          logTail: logTail(),
          ...launchIdentity
        }))
        if (recoveryInFlight) return
        notice = { tone: 'info', text: copy.copied }
        render()
      } else {
        const target = action === 'open-log-file' && logSource ? logSource.path : logDir
        void shell.openPath(target).then((openError) => {
          if (!openError) return
          logWarn('startup', 'Failed to open startup log location.', { message: openError })
          dialog.showErrorBox('Could not open the log', openError)
        })
      }
    })
    window.once('ready-to-show', () => window.show())
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(startupFailureHtml(
      message,
      logDir,
      htmlOptions()
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
