import { app } from 'electron'
import {
  appendUpdateHealthProgress,
  UPDATE_HEALTH_INTERNAL_TIMEOUT_MS,
  updateHealthDiagnosticBasePath,
  writeUpdateHealthBootstrapFailure
} from './update-health-bootstrap'

const HEALTH_PATH_ARG = '--kun-update-health-check='
const HEALTH_TOKEN_ARG = '--kun-update-health-token='
const HEALTH_TARGET_ARG = '--kun-update-target='

function bootstrapArgumentValue(prefix: string): string {
  for (const argument of process.argv) {
    const offset = argument.indexOf(prefix)
    if (offset < 0) continue
    const remainder = argument.slice(offset + prefix.length).trimStart()
    if (!remainder) return ''
    const quote = remainder[0] === '"' || remainder[0] === "'" ? remainder[0] : ''
    if (quote) {
      const end = remainder.indexOf(quote, 1)
      return (end < 0 ? remainder.slice(1) : remainder.slice(1, end)).trim()
    }
    const nextFlag = remainder.search(/\s+--[A-Za-z0-9-]+=/u)
    return (nextFlag < 0 ? remainder : remainder.slice(0, nextFlag)).trim()
  }
  return ''
}

const bootstrapHealthRequest = {
  resultPath: bootstrapArgumentValue(HEALTH_PATH_ARG),
  token: bootstrapArgumentValue(HEALTH_TOKEN_ARG),
  target: bootstrapArgumentValue(HEALTH_TARGET_ARG)
}

if (bootstrapHealthRequest.resultPath) {
  const healthStartedAt = new Date().toISOString()
  const healthDeadlineAt = Date.now() + UPDATE_HEALTH_INTERNAL_TIMEOUT_MS
  const reportProgress = (
    phase: string,
    detail?: Record<string, string | number | boolean | null | undefined>
  ): void => {
    try {
      appendUpdateHealthProgress({
        resultPath: bootstrapHealthRequest.resultPath,
        target: bootstrapHealthRequest.target,
        startedAt: healthStartedAt,
        phase,
        detail
      })
    } catch (error) {
      console.error('[kun-gui update health] failed to record progress:', error)
    }
  }
  reportProgress('bootstrap')
  void import('./update-health-check')
    .then(async ({ readUpdateHealthRequest, runUpdateHealthCheck }) => {
      const request = readUpdateHealthRequest()
      if (!request) throw new Error('The update health request disappeared during startup.')
      await runUpdateHealthCheck(request, {
        deadlineAt: healthDeadlineAt,
        diagnosticBasePath: updateHealthDiagnosticBasePath(request.resultPath),
        reportProgress
      })
    })
    .then(
      () => app.exit(0),
      (error) => {
        try {
          writeUpdateHealthBootstrapFailure({
            error,
            executablePath: process.execPath,
            ...bootstrapHealthRequest,
            argv: process.argv,
            startedAt: healthStartedAt,
            version: app.getVersion()
          })
        } catch (writeError) {
          console.error('[kun-gui update health] failed to record bootstrap failure:', writeError)
        }
        console.error('[kun-gui update health] failed:', error)
        app.exit(71)
      }
    )
} else {
  void import('./main-desktop-entry').then(
    ({ startDesktopMainEntry }) => startDesktopMainEntry(),
    (error) => {
      console.error('[kun-gui] desktop entry failed to load:', error)
      app.exit(1)
    }
  )
}
