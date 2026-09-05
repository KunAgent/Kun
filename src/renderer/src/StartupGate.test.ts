/** @vitest-environment jsdom */
import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DesktopStartupPhase,
  DesktopStartupStatePayload
} from '@shared/desktop-startup-state'
import { StartupGate, STARTUP_STATE_TIMEOUT_MS } from './StartupGate'
import { KUN_STARTUP_VARIANTS } from './components/startup/kun-startup-variants'

const appMock = vi.hoisted(() => ({
  prepareWorkbenchApp: vi.fn<() => Promise<void>>(async () => undefined)
}))

vi.mock('./components/StorageRelocationBootView', () => ({
  StorageRelocationBootView: () => createElement('div', { 'data-testid': 'storage-relocation-view' })
}))
vi.mock('./components/RuntimeMigrationRecoveryView', () => ({
  RuntimeMigrationRecoveryView: () => createElement('div', { 'data-testid': 'runtime-recovery-view' })
}))
vi.mock('./App', () => ({
  default: () => createElement('div', { 'data-testid': 'workbench-app' }),
  prepareWorkbenchApp: appMock.prepareWorkbenchApp
}))
vi.mock('./lib/shared-business-storage', () => ({
  installSharedBusinessStorage: vi.fn(async () => undefined)
}))

async function mockedInstallSharedBusinessStorage(): Promise<ReturnType<typeof vi.fn>> {
  const { installSharedBusinessStorage } = await import('./lib/shared-business-storage')
  return installSharedBusinessStorage as unknown as ReturnType<typeof vi.fn>
}

async function flushAsync(rounds = 6): Promise<void> {
  await act(async () => {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve()
  })
}

type PhaseListener = (payload: DesktopStartupStatePayload) => void

function phasePayload(phase: DesktopStartupPhase, detail?: string): DesktopStartupStatePayload {
  return detail === undefined ? { phase } : { phase, detail }
}

function deferredValue<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function setReactActEnvironment(value: boolean): void {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = value
}

function installStartupApi(initial: DesktopStartupPhase): {
  listeners: Set<PhaseListener>
  getState: ReturnType<typeof vi.fn>
  onState: ReturnType<typeof vi.fn>
} {
  const listeners = new Set<PhaseListener>()
  const getState = vi.fn(async () => phasePayload(initial))
  const onState = vi.fn((handler: PhaseListener) => {
    listeners.add(handler)
    return () => listeners.delete(handler)
  })
  ;(window as unknown as { kunGui: unknown }).kunGui = { startup: { getState, onState } }
  return { listeners, getState, onState }
}

describe('StartupGate', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    appMock.prepareWorkbenchApp.mockReset().mockResolvedValue(undefined)
    setReactActEnvironment(true)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    setReactActEnvironment(false)
    delete (window as unknown as { kunGui?: unknown }).kunGui
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  function renderGate(props: { storageRelocationMode?: boolean; runtimeMigrationRecoveryMode?: boolean }): void {
    act(() => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(StartupGate, {
            storageRelocationMode: props.storageRelocationMode ?? false,
            runtimeMigrationRecoveryMode: props.runtimeMigrationRecoveryMode ?? false
          })
        )
      )
    })
  }

  it('shows a retryable error when the startup API is missing', async () => {
    renderGate({})
    await flushAsync()

    expect(container.textContent).toContain('Failed to read Kun startup state')
    expect(container.textContent).toContain('desktop startup API is unavailable')
    expect(container.querySelector('[data-testid="workbench-app"]')).toBeNull()
  })

  it('subscribes before reading startup state and never regresses a ready event', async () => {
    const calls: string[] = []
    const pending = deferredValue<DesktopStartupStatePayload>()
    const listeners = new Set<PhaseListener>()
    ;(window as unknown as { kunGui: unknown }).kunGui = {
      startup: {
        onState: vi.fn((listener: PhaseListener) => {
          calls.push('subscribe')
          listeners.add(listener)
          return () => listeners.delete(listener)
        }),
        getState: vi.fn(() => {
          calls.push('getState')
          return pending.promise
        })
      }
    }
    renderGate({})
    expect(calls[0]).toBe('subscribe')
    expect(calls[1]).toBe('getState')

    await act(async () => listeners.forEach((listener) => listener(phasePayload('ready'))))
    await flushAsync()
    expect(container.querySelector('[data-testid="workbench-app"]')).not.toBeNull()

    await act(async () => pending.resolve(phasePayload('runtime_starting')))
    await flushAsync()
    expect(container.querySelector('[data-testid="workbench-app"]')).not.toBeNull()
  })

  it('retries after startup state rejects', async () => {
    let shouldReject = true
    const listeners = new Set<PhaseListener>()
    ;(window as unknown as { kunGui: unknown }).kunGui = {
      startup: {
        onState: (listener: PhaseListener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        getState: () => shouldReject
          ? Promise.reject(new Error('startup IPC unavailable'))
          : Promise.resolve(phasePayload('ready'))
      }
    }
    renderGate({})
    await flushAsync()
    expect(container.textContent).toContain('startup IPC unavailable')

    shouldReject = false
    const retry = [...container.querySelectorAll('button')]
      .find((button) => button.textContent === 'Retry')
    await act(async () => retry?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await flushAsync()
    expect(container.querySelector('[data-testid="workbench-app"]')).not.toBeNull()
  })

  it('times out a pending startup snapshot and ignores its late result', async () => {
    vi.useFakeTimers()
    const pending = deferredValue<DesktopStartupStatePayload>()
    const listeners = new Set<PhaseListener>()
    ;(window as unknown as { kunGui: unknown }).kunGui = {
      startup: {
        onState: (listener: PhaseListener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        getState: () => pending.promise
      }
    }
    renderGate({})
    await act(async () => vi.advanceTimersByTimeAsync(STARTUP_STATE_TIMEOUT_MS))
    expect(container.textContent).toContain('timed out')

    await act(async () => pending.resolve(phasePayload('ready')))
    await flushAsync()
    expect(container.textContent).toContain('Failed to read Kun startup state')
    expect(container.querySelector('[data-testid="workbench-app"]')).toBeNull()
  })

  it('opens logs from a startup error and reports unavailable recovery APIs', async () => {
    renderGate({})
    await flushAsync()
    const openLogs = [...container.querySelectorAll('button')]
      .find((button) => button.textContent === 'Open log folder')
    await act(async () => openLogs?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.textContent).toContain('log folder API is unavailable')
  })

  it('shows the startup shell for the initial phase', async () => {
    const api = installStartupApi('bootstrapping')
    renderGate({})
    await act(async () => undefined)
    expect(container.textContent).toContain('Preparing Kun desktop...')
    expect(container.textContent).toContain('Kun is preparing your workspace.')
    expect(container.textContent).not.toContain('Chick')
    const status = container.querySelector('[role="status"]')
    expect(status?.getAttribute('aria-live')).toBe('polite')
    expect(status?.getAttribute('aria-busy')).toBe('true')
    const artwork = container.querySelector('[data-testid="kun-startup-artwork"]')
    expect(artwork?.getAttribute('aria-hidden')).toBe('true')
    expect(artwork?.getAttribute('data-motion')).toBe('running')
    const startupVariant = artwork?.getAttribute('data-variant')
    expect(KUN_STARTUP_VARIANTS).toContain(startupVariant)
    expect(container.querySelector('.kun-startup')?.getAttribute('data-startup-variant'))
      .toBe(startupVariant)
    expect(container.querySelector('[data-testid="kun-startup-kun"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="kun-startup-bird"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="kun-startup-orbit"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="kun-startup-hologram"]')?.getAttribute('data-wordmark')).toBe('KUN')
    expect(container.querySelector('[data-testid="kun-startup-workspace-link"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="kun-startup-kun"]')?.getAttribute('alt')).toBe('')
    expect(container.querySelector('[data-testid="kun-startup-bird"]')?.getAttribute('alt')).toBe('')
    expect(container.querySelector('[data-testid="kun-startup-wordmark"]')?.getAttribute('alt')).toBe('')
    expect(container.querySelector('[data-testid="kun-startup-wordmark"]')?.getAttribute('src')).toContain('kun-startup-wordmark.webp')
    const progress = container.querySelector('[role="progressbar"]')
    expect(progress?.getAttribute('aria-label')).toBe('Kun startup progress')
    expect(progress?.hasAttribute('aria-valuenow')).toBe(false)
    expect(container.querySelector('[data-testid="workbench-app"]')).toBeNull()
  })

  it('renders the workbench App once the phase reaches ready', async () => {
    const api = installStartupApi('bootstrapping')
    renderGate({})
    await act(async () => undefined)
    expect(container.textContent).toContain('Preparing Kun desktop...')
    const startupVariant = container
      .querySelector('[data-testid="kun-startup-artwork"]')
      ?.getAttribute('data-variant')

    await act(async () => {
      api.listeners.forEach((listener) => listener(phasePayload('runtime_starting')))
    })
    expect(container.textContent).toContain('Starting Kun runtime...')
    expect(container.querySelector('[data-testid="kun-startup-artwork"]')?.getAttribute('data-variant'))
      .toBe(startupVariant)
    expect(container.querySelector('[data-testid="workbench-app"]')).toBeNull()

    await act(async () => {
      api.listeners.forEach((listener) => listener(phasePayload('ready')))
    })
    expect(container.querySelector('[data-testid="workbench-app"]')).not.toBeNull()
  })

  it('installs shared business storage exactly once despite StrictMode double effects', async () => {
    const installSharedBusinessStorage = await mockedInstallSharedBusinessStorage()
    installStartupApi('ready')
    renderGate({})
    await act(async () => undefined)
    expect(installSharedBusinessStorage).toHaveBeenCalledTimes(1)
    expect(appMock.prepareWorkbenchApp).toHaveBeenCalledTimes(1)
  })

  it('shows an error view with retry when shared storage install fails', async () => {
    const installSharedBusinessStorage = await mockedInstallSharedBusinessStorage()
    installSharedBusinessStorage.mockRejectedValueOnce(new Error('shared storage unavailable'))
    installStartupApi('ready')
    renderGate({})
    await flushAsync()
    expect(container.querySelector('[data-testid="workbench-app"]')).toBeNull()
    expect(container.textContent).toContain('Failed to start Kun workbench')
    expect(container.textContent).toContain('shared storage unavailable')
    expect(container.querySelector('button')?.textContent).toBe('Retry')
  })

  it('shows an error view when initial workbench preparation fails', async () => {
    const installSharedBusinessStorage = await mockedInstallSharedBusinessStorage()
    appMock.prepareWorkbenchApp.mockRejectedValueOnce(new Error('App chunk load failed'))
    const api = installStartupApi('bootstrapping')
    renderGate({})
    await flushAsync()
    // Workbench must stay on the shell while the phase disallows it.
    expect(container.querySelector('[data-testid="workbench-app"]')).toBeNull()

    await act(async () => {
      api.listeners.forEach((listener) => listener(phasePayload('ready')))
    })
    await flushAsync()
    expect(installSharedBusinessStorage).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Failed to start Kun workbench')
    expect(container.textContent).toContain('App chunk load failed')
  })

  it('recovers into the workbench when the retry succeeds', async () => {
    const installSharedBusinessStorage = await mockedInstallSharedBusinessStorage()
    installSharedBusinessStorage.mockRejectedValueOnce(new Error('shared storage unavailable'))
    installStartupApi('ready')
    renderGate({})
    await flushAsync()
    expect(container.textContent).toContain('Failed to start Kun workbench')

    const retry = container.querySelector('button')
    expect(retry?.textContent).toBe('Retry')
    await act(async () => {
      retry?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushAsync()
    })
    expect(installSharedBusinessStorage).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-testid="workbench-app"]')).not.toBeNull()
  })

  it('does not restart the workbench on later phase updates after a failure', async () => {
    const installSharedBusinessStorage = await mockedInstallSharedBusinessStorage()
    installSharedBusinessStorage.mockRejectedValueOnce(new Error('shared storage unavailable'))
    const api = installStartupApi('ready')
    renderGate({})
    await flushAsync()
    expect(container.textContent).toContain('Failed to start Kun workbench')

    await act(async () => {
      api.listeners.forEach((listener) => listener(phasePayload('ready')))
    })
    await flushAsync()
    expect(installSharedBusinessStorage).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Failed to start Kun workbench')
  })

  it('keeps the branded shell visible until initial workbench preparation completes', async () => {
    const preparation = deferredValue<void>()
    appMock.prepareWorkbenchApp.mockReturnValueOnce(preparation.promise)
    const api = installStartupApi('bootstrapping')
    renderGate({})
    await act(async () => undefined)
    act(() => {
      api.listeners.forEach((listener) => listener(phasePayload('ready')))
    })
    // Desktop startup is ready, but the shell remains until store boot and the
    // initial route chunk are both prepared.
    expect(container.textContent).toContain('Opening your workspace...')
    expect(container.querySelector('[data-testid="kun-startup-artwork"]')?.getAttribute('data-motion')).toBe('running')
    expect(container.querySelector('[data-testid="workbench-app"]')).toBeNull()
    await act(async () => preparation.resolve())
    await flushAsync()
    expect(container.querySelector('[data-testid="workbench-app"]')).not.toBeNull()
    expect(container.textContent).not.toContain('Loading Kun...')
  })

  it('renders only the storage relocation view and never subscribes to startup state', async () => {
    const api = installStartupApi('bootstrapping')
    renderGate({ storageRelocationMode: true })
    await act(async () => undefined)
    expect(container.querySelector('[data-testid="storage-relocation-view"]')).not.toBeNull()
    expect(api.getState).not.toHaveBeenCalled()
    expect(api.onState).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="workbench-app"]')).toBeNull()
  })

  it('renders only the runtime recovery view and never subscribes to startup state', async () => {
    const api = installStartupApi('bootstrapping')
    renderGate({ runtimeMigrationRecoveryMode: true })
    await act(async () => undefined)
    expect(container.querySelector('[data-testid="runtime-recovery-view"]')).not.toBeNull()
    expect(api.getState).not.toHaveBeenCalled()
    expect(api.onState).not.toHaveBeenCalled()
  })

  it('announces recovery_required as a terminal state with a reload action', async () => {
    const api = installStartupApi('bootstrapping')
    renderGate({})
    await act(async () => undefined)
    await act(async () => {
      api.listeners.forEach((listener) => listener(phasePayload('recovery_required')))
    })
    expect(container.textContent).toContain('Kun startup requires recovery.')
    expect(container.querySelector('.kun-startup')?.getAttribute('data-recovery')).toBe('true')
    const alert = container.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert?.getAttribute('aria-busy')).toBeNull()
    const artwork = container.querySelector('[data-testid="kun-startup-artwork"]')
    expect(artwork?.getAttribute('data-motion')).toBe('paused')
    expect(container.querySelector('[data-testid="kun-startup-kun"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="kun-startup-bird"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="kun-startup-orbit"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="kun-startup-hologram"]')).not.toBeNull()
    expect(container.querySelector('[role="progressbar"]')).toBeNull()
    expect([...container.querySelectorAll('button')]
      .some((button) => button.textContent === 'Reload Kun')).toBe(true)
  })
})
