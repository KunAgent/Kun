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
  applyDarkUiColors: vi.fn(),
  applyTheme: vi.fn(),
  applyUiFontScale: vi.fn(),
  applyChatContentMaxWidth: vi.fn(),
  applyDocumentLocale: vi.fn(),
  applyWriteTypography: vi.fn()
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
    ...(overrides.agentSurface ? { agentSurface: overrides.agentSurface } : {}),
    ...(overrides.workspaceMode ? { workspaceMode: overrides.workspaceMode } : {}),
    ...(overrides.status ? { status: overrides.status } : {}),
    ...(overrides.archived !== undefined ? { archived: overrides.archived } : {})
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
  selectThread: ReturnType<typeof vi.fn>
} {
  const selectThread = vi.fn(async () => undefined)
  let state = {
    activeThreadId: null,
    adeThreads: [],
    busy: false,
    clawChannels: [],
    codeWorkspaceRoots: ['~/.kun/default_workspace'],
    composerPickList: [],
    error: null,
    lastAdeThreadId: null,
    lastCodeThreadId: null,
    removedCodeWorkspaces: [],
    route: 'chat',
    runtimeConnection: 'ready',
    selectThread,
    showArchivedThreads: false,
    threads: [],
    unreadThreadIds: {},
    watchTurnCompletion: {},
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
    },
    selectThread
  }
}

describe('ADE mode navigation actions', () => {
  beforeEach(() => {
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
    vi.stubGlobal('window', {
      localStorage: new MemoryStorage(),
      kunGui: {
        getSettings: vi.fn(async () => ({
          write: { defaultWorkspaceRoot: '', activeWorkspaceRoot: '', workspaces: [] }
        }))
      }
    })
  })

  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('refreshAdeThreads lists the ADE inventory without touching the Code list', async () => {
    const listed = [
      thread({ id: 'ade_a', workspace: '/repo', workspaceMode: 'ade' }),
      thread({ id: 'ade_b', workspace: '/repo', workspaceMode: 'ade', archived: true })
    ]
    const provider = { listThreads: vi.fn(async () => listed) }
    registryMock.getProvider.mockReturnValue(provider)
    const harness = buildHarness()
    harness.state.threads = [
      thread({ id: 'code_a', workspace: '/repo' })
    ]

    await harness.actions.refreshAdeThreads()

    expect(provider.listThreads).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceMode: 'ade' })
    )
    expect(harness.state.adeThreads.map((item) => item.id)).toEqual(['ade_a', 'ade_b'])
    expect(harness.state.threads.map((item) => item.id)).toEqual(['code_a'])
  })

  it('refreshAdeThreads clears memory when the remembered ADE thread is gone', async () => {
    const provider = {
      listThreads: vi.fn(async () => [
        thread({ id: 'ade_live', workspace: '/repo', workspaceMode: 'ade' })
      ])
    }
    registryMock.getProvider.mockReturnValue(provider)
    const harness = buildHarness()
    harness.state.lastAdeThreadId = 'ade_gone'

    await harness.actions.refreshAdeThreads()

    expect(harness.state.lastAdeThreadId).toBeNull()
  })

  it('openAde restores the remembered ADE thread and routes to ade', async () => {
    const harness = buildHarness()
    harness.state.adeThreads = [
      thread({ id: 'ade_old', workspace: '/repo', workspaceMode: 'ade' }),
      thread({ id: 'ade_new', workspace: '/repo', workspaceMode: 'ade', updatedAt: '2026-06-13T00:00:00.000Z' })
    ]
    harness.state.lastAdeThreadId = 'ade_old'

    await harness.actions.openAde()

    expect(harness.state.route).toBe('ade')
    expect(harness.selectThread).toHaveBeenCalledWith('ade_old', expect.anything())
  })

  it('openAde falls back to the latest ADE thread when nothing is remembered', async () => {
    const harness = buildHarness()
    harness.state.adeThreads = [
      thread({ id: 'ade_old', workspace: '/repo', workspaceMode: 'ade' }),
      thread({
        id: 'ade_new',
        workspace: '/repo',
        workspaceMode: 'ade',
        updatedAt: '2026-06-13T00:00:00.000Z'
      }),
      thread({ id: 'ade_archived', workspace: '/repo', workspaceMode: 'ade', archived: true, updatedAt: '2026-06-14T00:00:00.000Z' })
    ]

    await harness.actions.openAde()

    expect(harness.state.route).toBe('ade')
    expect(harness.selectThread).toHaveBeenCalledWith('ade_new', expect.anything())
  })

  it('openAde keeps an already active ADE thread selected', async () => {
    const harness = buildHarness()
    harness.state.activeThreadId = 'ade_a'
    harness.state.adeThreads = [
      thread({ id: 'ade_a', workspace: '/repo', workspaceMode: 'ade' })
    ]

    await harness.actions.openAde()

    expect(harness.state.route).toBe('ade')
    expect(harness.selectThread).not.toHaveBeenCalled()
    expect(harness.state.activeThreadId).toBe('ade_a')
  })

  it('openAde clears the selection when no ADE thread exists', async () => {
    const harness = buildHarness()
    harness.state.activeThreadId = 'code_a'
    harness.state.threads = [thread({ id: 'code_a', workspace: '/repo' })]
    harness.state.blocks = [{ kind: 'user', id: 'u1', text: 'hi' }]

    await harness.actions.openAde()

    expect(harness.state.route).toBe('ade')
    expect(harness.state.activeThreadId).toBeNull()
    expect(harness.state.blocks).toEqual([])
  })

  it('openCode ignores ADE memory and restores only the remembered Code thread', async () => {
    const harness = buildHarness()
    harness.state.threads = [
      thread({ id: 'code_a', workspace: '/repo' }),
      thread({ id: 'code_b', workspace: '/repo', updatedAt: '2026-06-13T00:00:00.000Z' })
    ]
    harness.state.lastCodeThreadId = 'code_a'
    harness.state.lastAdeThreadId = 'ade_x'

    await harness.actions.openCode()

    expect(harness.state.route).toBe('chat')
    expect(harness.selectThread).toHaveBeenCalledWith('code_a', expect.anything())
  })

  it('refreshThreads scopes the Code inventory to workspaceMode code', async () => {
    const provider = {
      listThreads: vi.fn(async () => [
        thread({ id: 'code_a', workspace: '/repo' })
      ]),
      getThreadDetail: vi.fn(async () => ({ blocks: [{ kind: 'user', id: 'u', text: 'work' }] }))
    }
    registryMock.getProvider.mockReturnValue(provider)
    const harness = buildHarness()
    harness.state.showArchivedThreads = false

    await harness.actions.refreshThreads()

    expect(provider.listThreads).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceMode: 'code' })
    )
    expect(harness.state.threads.map((item) => item.id)).toEqual(['code_a'])
  })
})
