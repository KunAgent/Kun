import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import { rendererRuntimeClient } from '../agent/runtime-client'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import type { BrowserStorageLike } from '../lib/browser-storage'

const registryMock = vi.hoisted(() => ({
  getProvider: vi.fn()
}))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))

const applyThemeLibMock = vi.hoisted(() => ({
  applyCursorSpotlight: vi.fn(),
  applyCursorSpotlightColor: vi.fn(),
  applyTheme: vi.fn(),
  applyUiFontScale: vi.fn(),
  applyChatContentMaxWidth: vi.fn(),
  applyDocumentLocale: vi.fn()
}))

vi.mock('../lib/apply-theme', () => applyThemeLibMock)

import { createNavigationActions } from './chat-store-navigation-actions'

function thread(
  overrides: Partial<NormalizedThread> & Pick<NormalizedThread, 'id' | 'workspace'>
): NormalizedThread {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    updatedAt: overrides.updatedAt ?? '2026-06-12T00:00:00.000Z',
    model: overrides.model ?? 'deepseek-v4-pro',
    mode: overrides.mode ?? 'agent',
    workspace: overrides.workspace,
    ...(overrides.status ? { status: overrides.status } : {})
  }
}

class MemoryStorage implements BrowserStorageLike {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function buildHarness(): {
  actions: ReturnType<typeof createNavigationActions>
  state: ChatState
} {
  let state = {
    activeThreadId: null,
    busy: false,
    clawChannels: [],
    codeWorkspaceRoots: ['~/.kun/default_workspace'],
    composerPickList: [],
    createThread: vi.fn(async () => undefined),
    currentTurnId: null,
    currentTurnUserId: null,
    error: null,
    loadComposerModels: vi.fn(async () => undefined),
    openWrite: vi.fn(async () => undefined),
    probeRuntime: vi.fn(async () => undefined),
    refreshThreads: vi.fn(async () => undefined),
    route: 'chat',
    runtimeConnection: 'ready',
    selectThread: vi.fn(async () => undefined),
    subscribeThreadEventsLive: vi.fn(async () => undefined),
    recoverActiveTurn: vi.fn(async () => true),
    threads: [] as NormalizedThread[],
    unreadThreadIds: {},
    watchTurnCompletion: {},
    workspaceLabel: 'default_workspace',
    workspaceRoot: '~/.kun/default_workspace'
  } as unknown as ChatState

  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    state = { ...state, ...update }
  }
  const get: ChatStoreGet = () => state
  return {
    actions: createNavigationActions({ set, get, sseAbortRef: { current: null } }),
    get state() {
      return state
    }
  }
}

describe('refreshThreads runtime state reconciliation transport', () => {
  beforeEach(() => {
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
  })

  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('reconciles running candidates through the batch endpoint without per-thread reads', async () => {
    const listed = [
      thread({ id: 'thr_done', workspace: '/project', status: 'running' }),
      thread({ id: 'thr_live', workspace: '/project', status: 'running' })
    ]
    const provider = {
      listThreads: vi.fn(async () => listed),
      getThreadDetail: vi.fn(async () => ({ blocks: [{ kind: 'user' as const, id: 'u', text: 'work' }] })),
      getThreadStates: vi.fn(async (ids: string[]) => [
        {
          id: ids[0],
          ok: true as const,
          state: {
            status: 'running',
            updatedAt: '2026-06-12T00:00:01.000Z',
            latestSeq: 2,
            pendingUserInputIds: [],
            latestTurnId: 'turn_done',
            latestTurnStatus: 'completed'
          }
        },
        {
          id: ids[1],
          ok: true as const,
          state: {
            status: 'idle',
            updatedAt: '2026-06-12T00:00:02.000Z',
            latestSeq: 3,
            pendingUserInputIds: [],
            latestTurnId: 'turn_live',
            latestTurnStatus: 'running'
          }
        }
      ]),
      getThreadState: vi.fn(async () => {
        throw new Error('per-thread reads must not run when the batch route is available')
      })
    }
    registryMock.getProvider.mockReturnValue(provider)
    vi.stubGlobal('window', {
      localStorage: new MemoryStorage(),
      kunGui: {
        getSettings: vi.fn(async () => ({
          write: { defaultWorkspaceRoot: '', activeWorkspaceRoot: '', workspaces: [] }
        }))
      }
    })
    const harness = buildHarness()
    harness.state.threads = listed
    harness.state.watchTurnCompletion = { thr_done: true, thr_live: true }

    await harness.actions.refreshThreads()

    // First call is the refresh reconciliation itself; the completion-watch
    // poller may add more batch calls, but nothing may fan out per-thread.
    expect(provider.getThreadStates.mock.calls[0]).toEqual([['thr_done', 'thr_live']])
    expect(provider.getThreadState).not.toHaveBeenCalled()
    expect(harness.state.threads.find((item) => item.id === 'thr_done')).toMatchObject({
      status: 'idle',
      latestTurnId: 'turn_done',
      latestTurnStatus: 'completed'
    })
    expect(harness.state.threads.find((item) => item.id === 'thr_live')).toMatchObject({
      status: 'running',
      latestTurnId: 'turn_live',
      latestTurnStatus: 'running'
    })
    expect(harness.state.watchTurnCompletion).toEqual({ thr_live: true })
  })
})
