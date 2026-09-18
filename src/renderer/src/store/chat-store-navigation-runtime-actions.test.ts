import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rendererRuntimeClient } from '../agent/runtime-client'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import {
  cancelOfflineRuntimeProbe,
  OFFLINE_RUNTIME_PROBE_INTERVAL_MS
} from './chat-store-schedulers'
import { createNavigationRuntimeActions } from './chat-store-navigation-runtime-actions'

const registryMock = vi.hoisted(() => ({
  getProvider: vi.fn()
}))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))

function buildHarness(overrides: { runtimeConnection?: ChatState['runtimeConnection'] } = {}): {
  actions: ReturnType<typeof createNavigationRuntimeActions>
  state: ChatState
  get: ChatStoreGet
} {
  let state = {
    activeThreadId: null,
    error: null,
    initialSetupMode: null,
    loadComposerModels: vi.fn(async () => undefined),
    refreshThreads: vi.fn(async () => undefined),
    runtimeConnection: overrides.runtimeConnection ?? 'ready',
    runtimeErrorDetail: null,
    threadListError: null,
    threadListStatus: 'ready',
    threads: []
  } as unknown as ChatState
  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    state = { ...state, ...update }
  }
  const get: ChatStoreGet = () => state
  const actions = createNavigationRuntimeActions({ set, get, sseAbortRef: { current: null } })
  // The offline re-probe chain calls get().probeRuntime('background'); point it
  // at the real action so the chain exercises the same path as production.
  state.probeRuntime = actions.probeRuntime
  return {
    actions,
    get state() {
      return state
    },
    get
  }
}

function stubKunGui(options: { restartRuntime?: ReturnType<typeof vi.fn> } = {}): {
  getSettings: ReturnType<typeof vi.fn>
  restartRuntime: ReturnType<typeof vi.fn>
} {
  const kunGui = {
    getSettings: vi.fn(async () => ({})),
    restartRuntime: options.restartRuntime ?? vi.fn(async () => undefined)
  }
  vi.stubGlobal('window', { kunGui })
  return kunGui
}

describe('probeRuntime recovery', () => {
  beforeEach(() => {
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
  })

  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    cancelOfflineRuntimeProbe()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('reconnects a healthy runtime without paying the heavyweight restart', async () => {
    const restartRuntime = vi.fn(async () => undefined)
    stubKunGui({ restartRuntime })
    const connect = vi.fn(async () => undefined)
    registryMock.getProvider.mockReturnValue({ connect })
    const h = buildHarness()

    await h.actions.probeRuntime('user', { restart: true })

    expect(connect).toHaveBeenCalledTimes(1)
    expect(restartRuntime).not.toHaveBeenCalled()
    expect(h.state.runtimeConnection).toBe('ready')
    expect(h.state.error).toBeNull()
  })

  it('escalates to restartRuntime only after the connection fails', async () => {
    const restartRuntime = vi.fn(async () => undefined)
    stubKunGui({ restartRuntime })
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValue(undefined)
    registryMock.getProvider.mockReturnValue({ connect })
    const h = buildHarness()

    await h.actions.probeRuntime('user', { restart: true })

    expect(restartRuntime).toHaveBeenCalledTimes(1)
    expect(connect).toHaveBeenCalledTimes(2)
    expect(h.state.runtimeConnection).toBe('ready')
  })

  it('reports offline when even the forced restart cannot reach the runtime', async () => {
    const restartRuntime = vi.fn(async () => undefined)
    stubKunGui({ restartRuntime })
    const connect = vi.fn(async () => {
      throw new Error('fetch failed')
    })
    registryMock.getProvider.mockReturnValue({ connect })
    const h = buildHarness()

    await h.actions.probeRuntime('user', { restart: true })

    expect(restartRuntime).toHaveBeenCalledTimes(1)
    expect(h.state.runtimeConnection).toBe('offline')
    expect(h.state.error).toBeTruthy()
  })

  it('re-probes in the background while offline and recovers without user action', async () => {
    vi.useFakeTimers()
    const restartRuntime = vi.fn(async () => undefined)
    stubKunGui({ restartRuntime })
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValue(undefined)
    registryMock.getProvider.mockReturnValue({ connect })
    const h = buildHarness()

    await h.actions.probeRuntime('user')
    expect(h.state.runtimeConnection).toBe('offline')
    expect(restartRuntime).not.toHaveBeenCalled()

    // The offline chain fires probeRuntime('background') after the interval;
    // with the runtime back the connection flips to ready on its own.
    await vi.advanceTimersByTimeAsync(OFFLINE_RUNTIME_PROBE_INTERVAL_MS)
    expect(connect).toHaveBeenCalledTimes(2)
    expect(h.state.runtimeConnection).toBe('ready')
    expect(h.state.error).toBeNull()
  })

  it('keeps re-probing while offline until the runtime comes back', async () => {
    vi.useFakeTimers()
    stubKunGui()
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValue(undefined)
    registryMock.getProvider.mockReturnValue({ connect })
    const h = buildHarness()

    await h.actions.probeRuntime('user')
    expect(h.state.runtimeConnection).toBe('offline')

    await vi.advanceTimersByTimeAsync(OFFLINE_RUNTIME_PROBE_INTERVAL_MS)
    expect(connect).toHaveBeenCalledTimes(2)
    expect(h.state.runtimeConnection).toBe('offline')

    await vi.advanceTimersByTimeAsync(OFFLINE_RUNTIME_PROBE_INTERVAL_MS)
    expect(connect).toHaveBeenCalledTimes(3)
    expect(h.state.runtimeConnection).toBe('ready')
  })
})
