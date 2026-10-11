import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import i18n from '../i18n'
import { clearThreadSnapshotCache } from './thread-snapshot-cache'

const registryMock = vi.hoisted(() => ({ getProvider: vi.fn() }))

vi.mock('../agent/registry', () => ({ getProvider: registryMock.getProvider }))

import { createThreadActions } from './chat-store-thread-actions'

function buildHarness(recover: (state: ChatState) => void) {
  const state = {
    activeThreadId: 'thr_existing',
    blocks: [{ kind: 'user', id: 'user-original', turnId: 'turn_active', text: 'Fix the bug',
      meta: { agentSurface: 'code', mode: 'agent' } }],
    busy: true,
    currentTurnId: 'turn_active',
    currentTurnOrchestration: null,
    currentTurnUserId: 'user-original',
    error: null,
    lastDelegatedRuntimeState: null,
    queuedMessages: [{ id: 'q-guide', text: 'commit to local develop when done', mode: 'agent' }],
    threads: [{ id: 'thr_existing', title: 'thr', updatedAt: '2026-10-11T00:00:00.000Z',
      model: 'swe-2-high', mode: 'agent', workspace: '/workspace', status: 'running' }]
  } as unknown as ChatState
  state.recoverActiveTurn = vi.fn(async () => {
    recover(state)
    return true
  })
  const set: ChatStoreSet = (partial) => {
    Object.assign(state, typeof partial === 'function' ? partial(state) : partial)
  }
  const get: ChatStoreGet = () => state
  return { actions: createThreadActions({ set, get, sseAbortRef: { current: null } }), state }
}

describe('guiding a turn that refuses guidance', () => {
  beforeEach(() => {
    clearThreadSnapshotCache()
    registryMock.getProvider.mockReset()
    registryMock.getProvider.mockReturnValue({
      steerUserMessage: vi.fn(async () => {
        throw new Error('turn is no longer accepting steering: turn_active')
      })
    })
  })

  it('tells the user when the turn is still running instead of failing silently', async () => {
    const { actions, state } = buildHarness(() => undefined)
    await expect(actions.guideQueuedMessage('q-guide')).resolves.toBe(false)
    expect(state.recoverActiveTurn).toHaveBeenCalled()
    expect(state.error).toBe(i18n.t('common:guideQueuedMessageNotAccepting'))
    expect(state.queuedMessages.map((message) => message.id)).toEqual(['q-guide'])
    expect(state.queuedMessages[0]?.steeringRequest).toBeUndefined()
  })

  it('stays quiet when the turn had just ended; the queue sends the message next', async () => {
    const { actions, state } = buildHarness((current) => {
      current.busy = false
      current.currentTurnId = null
    })
    await expect(actions.guideQueuedMessage('q-guide')).resolves.toBe(false)
    expect(state.error).toBeNull()
    expect(state.queuedMessages.map((message) => message.id)).toEqual(['q-guide'])
  })
})
