/** @vitest-environment jsdom */
import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DesktopStartupPhase,
  DesktopStartupStatePayload
} from '@shared/desktop-startup-state'
import { StartupGate, STARTUP_STATE_TIMEOUT_MS } from './StartupGate'

vi.mock('./components/StorageRelocationBootView', () => ({
  StorageRelocationBootView: () => createElement('div', { 'data-testid': 'storage-relocation-view' })
}))
vi.mock('./components/RuntimeMigrationRecoveryView', () => ({
  RuntimeMigrationRecoveryView: () => createElement('div', { 'data-testid': 'runtime-recovery-view' })
}))
vi.mock('./App', () => ({
  default: () => createElement('div', { 'data-testid': 'workbench-app' })
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
    expect(api.onState).toHaveBeenCalled()
    expect(container.textContent).toContain('Preparing Kun desktop...')
    expect(container.querySelector('[data-testid="workbench-app"]')).toBeNull()
  })

  it('renders the workbench App once the phase reaches ready', async () => {
    const api = installStartupApi('bootstrapping')
    renderGate({})
    await act(async () => undefined)
    expect(container.textContent).toContain('Preparing Kun desktop...')

    await act(async () => {
      api.listeners.forEach((listener) => listener(phasePayload('runtime_starting')))
    })
    expect(container.textContent).toContain('Starting Kun runtime...')
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

  it('shows an error view when the App chunk fails to load', async () => {
    const installSharedBusinessStorage = await mockedInstallSharedBusinessStorage()
    installSharedBusinessStorage.mockRejectedValueOnce(new Error('App chunk load failed'))
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

  it('keeps the shell visible while the App chunk is still loading', async () => {
    const api = installStartupApi('bootstrapping')
    renderGate({})
    await act(async () => undefined)
    act(() => {
      api.listeners.forEach((listener) => listener(phasePayload('ready')))
    })
    // Before the async bootstrap (storage install + App import) resolves, the
    // shell must stay mounted showing the ready label instead of a blank page.
    expect(container.textContent).toContain('Kun is ready.')
    expect(container.querySelector('[data-testid="workbench-app"]')).toBeNull()
    await act(async () => undefined)
    expect(container.querySelector('[data-testid="workbench-app"]')).not.toBeNull()
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

  it('shows the recovery_required styling on the shell', async () => {
    const api = installStartupApi('bootstrapping')
    renderGate({})
    await act(async () => undefined)
    await act(async () => {
      api.listeners.forEach((listener) => listener(phasePayload('recovery_required')))
    })
    expect(container.textContent).toContain('Kun startup requires recovery.')
    expect(container.querySelector('.bg-red-500')).not.toBeNull()
  })
})
