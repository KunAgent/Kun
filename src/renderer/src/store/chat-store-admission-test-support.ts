import { vi } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { createThreadActions } from './chat-store-thread-actions'

export function admissionTestThread(id: string): NormalizedThread {
  return {
    id,
    title: id,
    updatedAt: '2026-06-09T00:00:00.000Z',
    model: 'deepseek-v4-pro',
    mode: 'agent',
    workspace: '/workspace/deepseek-gui',
    status: 'running'
  }
}

export function createAdmissionHarness(): {
  actions: ReturnType<typeof createThreadActions>
  state: ChatState
} {
  let state: ChatState
  state = {
    activeThreadId: 'thr_existing',
    blocks: [],
    busy: true,
    clawChannels: [],
    codeWorkspaceRoots: [],
    composerModel: '',
    composerMode: 'agent',
    composerOrchestration: 'direct',
    composerProviderId: '',
    currentTurnId: null,
    currentTurnOrchestration: null,
    currentTurnUserId: null,
    error: 'previous error',
    extensionComposerContexts: [],
    lastSeq: 0,
    loadComposerModels: vi.fn(async () => undefined),
    queuedMessages: [],
    recoverActiveTurn: vi.fn(async () => true),
    drainQueuedMessages: vi.fn(async () => undefined),
    refreshThreads: vi.fn(async () => undefined),
    route: 'chat',
    runtimeConnection: 'ready',
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    turnStartedAtByUserId: {},
    threads: [admissionTestThread('thr_existing')]
  } as unknown as ChatState

  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state
  const actions = createThreadActions({
    set,
    get,
    sseAbortRef: { current: null }
  })
  state.sendMessage = actions.sendMessage
  return { actions, state }
}

