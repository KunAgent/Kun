import React, { lazy, useCallback, useEffect, useRef, useState } from 'react'
import type {
  DesktopStartupPhase,
  DesktopStartupStatePayload
} from '@shared/desktop-startup-state'
import { requestApplicationReload } from './lib/application-reload'
import startupCompanionsUrl from './assets/startup/kun-startup-companions.png'
import {
  mergeStartupPhase,
  startupPhaseLabel,
  startupShellAllowsWorkbench
} from './startup-shell'

const StorageRelocationBootView = lazy(async () => {
  const { StorageRelocationBootView: view } = await import('./components/StorageRelocationBootView')
  return { default: view }
})
const RuntimeMigrationRecoveryView = lazy(async () => {
  const { RuntimeMigrationRecoveryView: view } = await import('./components/RuntimeMigrationRecoveryView')
  return { default: view }
})
type AppModule = typeof import('./App')
let preparedWorkbenchApp: AppModule['default'] | null = null
const loadAppModule = (): Promise<AppModule> => import('./App').then((module) => {
  preparedWorkbenchApp = module.default
  return module
})
const LazyWorkbenchApp = lazy(async () => {
  const mod = await loadAppModule()
  return { default: mod.default }
})

const fallback = <div className="min-h-screen bg-ds-canvas" />
export const STARTUP_STATE_TIMEOUT_MS = 10_000

export interface StartupGateProps {
  storageRelocationMode: boolean
  runtimeMigrationRecoveryMode: boolean
}

type WorkbenchBootState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready' }

type StartupHandshakeState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; message: string }

function bootErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

function StartupErrorView({
  title,
  message,
  detail,
  actionError,
  onRetry,
  onOpenLogs
}: {
  title: string
  message: string
  detail: string
  actionError: string | null
  onRetry: () => void
  onOpenLogs: () => void
}): React.ReactElement {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ds-canvas p-8 text-ds-ink">
      <section className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-ds-border bg-ds-surface px-8 py-8 text-center shadow-sm">
        <span className="h-2.5 w-2.5 rounded-full bg-red-500" aria-hidden="true" />
        <h1 className="text-base font-semibold">{title}</h1>
        <p className="text-sm text-ds-faint">{message}</p>
        <p className="w-full break-words rounded-lg bg-ds-canvas px-3 py-2 font-mono text-xs text-ds-faint">
          {detail}
        </p>
        {actionError ? <p role="alert" className="text-xs text-red-600">{actionError}</p> : null}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button type="button" className="primary-button" onClick={onRetry}>Retry</button>
          <button type="button" className="secondary-button" onClick={onOpenLogs}>
            Open log folder
          </button>
          <button type="button" className="secondary-button" onClick={() => requestApplicationReload()}>
            Reload Kun
          </button>
        </div>
      </section>
    </main>
  )
}

/**
 * Owns the full renderer lifecycle for the single React root. Startup state and
 * workbench bootstrap failures are independently retryable.
 */
export function StartupGate({
  storageRelocationMode,
  runtimeMigrationRecoveryMode
}: StartupGateProps): React.ReactElement {
  const [phase, setPhase] = useState<DesktopStartupPhase>('bootstrapping')
  const [phaseDetail, setPhaseDetail] = useState<string | undefined>(undefined)
  const [startupHandshake, setStartupHandshake] = useState<StartupHandshakeState>({
    status: 'loading'
  })
  const [startupAttempt, setStartupAttempt] = useState(0)
  const [recoveryActionError, setRecoveryActionError] = useState<string | null>(null)
  const [boot, setBoot] = useState<WorkbenchBootState>({ status: 'idle' })
  const bootRunRef = useRef(0)

  useEffect(() => {
    if (storageRelocationMode || runtimeMigrationRecoveryMode) return
    setStartupHandshake({ status: 'loading' })
    setRecoveryActionError(null)
    const startup = window.kunGui?.startup
    if (!startup) {
      setStartupHandshake({
        status: 'error',
        message: 'The desktop startup API is unavailable.'
      })
      return
    }
    let active = true
    let observedPhase = false
    let timeout: ReturnType<typeof setTimeout> | null = null
    let unsubscribe: (() => void) | null = null
    const dispose = (): void => {
      if (!active) return
      active = false
      if (timeout) clearTimeout(timeout)
      unsubscribe?.()
    }
    const acceptPhase = (next: DesktopStartupPhase, detail?: string): void => {
      if (!active) return
      observedPhase = true
      if (timeout) {
        clearTimeout(timeout)
        timeout = null
      }
      setPhase((current) => mergeStartupPhase(current, next))
      setPhaseDetail(detail)
      setStartupHandshake({ status: 'ready' })
    }
    const acceptPayload = (payload: DesktopStartupStatePayload): void => {
      acceptPhase(payload.phase, payload.detail)
    }
    const fail = (error: unknown): void => {
      if (!active || observedPhase) return
      const message = bootErrorMessage(error)
      dispose()
      setStartupHandshake({ status: 'error', message })
    }
    try {
      unsubscribe = startup.onState(acceptPayload)
    } catch (error) {
      fail(error)
      return dispose
    }
    if (!observedPhase) {
      timeout = setTimeout(() => {
        fail(new Error(`Desktop startup state timed out after ${STARTUP_STATE_TIMEOUT_MS}ms.`))
      }, STARTUP_STATE_TIMEOUT_MS)
    }
    try {
      void startup.getState().then(acceptPayload, fail)
    } catch (error) {
      fail(error)
    }
    return dispose
  }, [storageRelocationMode, runtimeMigrationRecoveryMode, startupAttempt])

  const openLogs = useCallback(() => {
    setRecoveryActionError(null)
    const openLogDir = window.kunGui?.openLogDir
    if (typeof openLogDir !== 'function') {
      setRecoveryActionError('The desktop log folder API is unavailable.')
      return
    }
    void openLogDir().then((result) => {
      if (!result.ok) setRecoveryActionError(result.message || 'Failed to open the log folder.')
    }, (error) => setRecoveryActionError(bootErrorMessage(error)))
  }, [])

  const retryStartup = useCallback(() => {
    setStartupAttempt((attempt) => attempt + 1)
  }, [])

  const startWorkbench = useCallback(() => {
    bootRunRef.current += 1
    const run = bootRunRef.current
    setBoot({ status: 'loading' })
    void (async () => {
      try {
        await installSharedBusinessStorageForWorkbench()
        const app = await loadAppModule()
        await app.prepareWorkbenchApp()
        if (bootRunRef.current === run) setBoot({ status: 'ready' })
      } catch (error) {
        if (bootRunRef.current === run) {
          setBoot({ status: 'error', message: bootErrorMessage(error) })
        }
      }
    })()
  }, [])

  useEffect(() => {
    if (storageRelocationMode || runtimeMigrationRecoveryMode) return
    if (startupHandshake.status !== 'ready') return
    if (!startupShellAllowsWorkbench(phase)) return
    // 'idle' starts automatically once the shell allows the workbench;
    // 'error' only restarts through the explicit retry action.
    if (boot.status !== 'idle') return
    startWorkbench()
  }, [
    phase,
    boot.status,
    startupHandshake.status,
    storageRelocationMode,
    runtimeMigrationRecoveryMode,
    startWorkbench
  ])

  if (storageRelocationMode) {
    return (
      <React.Suspense fallback={fallback}>
        <StorageRelocationBootView />
      </React.Suspense>
    )
  }
  if (runtimeMigrationRecoveryMode) {
    return (
      <React.Suspense fallback={fallback}>
        <RuntimeMigrationRecoveryView />
      </React.Suspense>
    )
  }
  if (startupHandshake.status === 'error') {
    return (
      <StartupErrorView
        title="Failed to read Kun startup state"
        message="The desktop startup channel could not be initialized. Retry the connection or reload Kun."
        detail={startupHandshake.message}
        actionError={recoveryActionError}
        onRetry={retryStartup}
        onOpenLogs={openLogs}
      />
    )
  }
  if (boot.status === 'ready') {
    const WorkbenchApp = preparedWorkbenchApp ?? LazyWorkbenchApp
    return (
      <React.Suspense fallback={fallback}>
        <WorkbenchApp />
      </React.Suspense>
    )
  }
  if (boot.status === 'error') {
    return (
      <StartupErrorView
        title="Failed to start Kun workbench"
        message="The workbench could not finish starting up. Check the desktop runtime, then try again."
        detail={boot.message}
        actionError={recoveryActionError}
        onRetry={startWorkbench}
        onOpenLogs={openLogs}
      />
    )
  }
  const recovering = phase === 'recovery_required'
  if (recovering) {
    return (
      <main className="kun-startup" data-recovery="true">
        <section className="kun-startup__content" role="alert" aria-live="assertive">
          <div className="kun-startup__artwork" aria-hidden="true">
            <img
              className="kun-startup__companions"
              src={startupCompanionsUrl}
              alt=""
              data-testid="kun-startup-companions"
            />
          </div>
          <div className="kun-startup__copy">
            <h1 className="kun-startup__title">{startupPhaseLabel(phase)}</h1>
            {phaseDetail ? <p className="kun-startup__detail">{phaseDetail}</p> : null}
          </div>
          <p className="kun-startup__hint">
            Startup stopped before Kun could finish preparing the workspace.
          </p>
          <button type="button" className="secondary-button" onClick={() => requestApplicationReload()}>
            Reload Kun
          </button>
        </section>
      </main>
    )
  }
  const statusTitle = phase === 'ready'
    ? 'Opening your workspace...'
    : startupPhaseLabel(phase)
  return (
    <main className="kun-startup" data-recovery="false">
      <section
        className="kun-startup__content"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="kun-startup__artwork" aria-hidden="true">
          <span className="kun-startup__data-spark" />
          <img
            className="kun-startup__companions"
            src={startupCompanionsUrl}
            alt=""
            data-testid="kun-startup-companions"
          />
        </div>
        <div className="kun-startup__copy">
          <h1 className="kun-startup__title">{statusTitle}</h1>
          {phaseDetail ? <p className="kun-startup__detail">{phaseDetail}</p> : null}
        </div>
        <div
          className="kun-startup__progress"
          role="progressbar"
          aria-label="Kun startup progress"
        >
          <span className="kun-startup__progress-indicator" />
        </div>
        <p className="kun-startup__hint">
          Kun and Chick are preparing your workspace.
        </p>
      </section>
    </main>
  )
}

// Late import keeps this module free of the workbench storage implementation
// so the gate stays part of the small entry chunk.
let installSharedBusinessStorageForWorkbench = async (): Promise<void> => {
  const { installSharedBusinessStorage } = await import('./lib/shared-business-storage')
  installSharedBusinessStorageForWorkbench = async () => {
    await installSharedBusinessStorage()
  }
  await installSharedBusinessStorageForWorkbench()
}
