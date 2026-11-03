import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatState } from '../store/chat-store-types'
import type { ExternalPlanBuildDispatchResult } from '../store/chat-store-message-types'
import { handOffPlanBuild } from './plan-build-handoff'
import { usePlanBuildAgentStore } from './plan-build-agent-store'

const plan = {
  id: 'plan-a', workspaceRoot: '/repo', threadId: 'thr_a', featureName: 'Feature',
  relativePath: '.kunsdd/plan/feature.md', sourceRequest: 'Feature', createdAt: '', updatedAt: ''
}
const prepared = {
  prompt: 'Implement Feature', displayText: 'Build Feature', title: 'Feature',
  workspaceRoot: '/repo', orchestration: 'direct' as const, planId: plan.id
}
const route = { agentId: 'codex', model: 'gpt-6.1', accountId: 'account-private' }

function dispatchHarness() {
  let finish!: (value: ExternalPlanBuildDispatchResult) => void
  const dispatchExternalPlanBuild = vi.fn(() => new Promise<ExternalPlanBuildDispatchResult>((resolve) => {
    finish = resolve
  }))
  const setError = vi.fn()
  const state = { activeThreadId: 'thr_a', error: null, setError, dispatchExternalPlanBuild } as unknown as ChatState
  const sending = handOffPlanBuild({ plan, prepared, route, displayText: 'Build Feature', chatState: state, t: (key) => key })
  state.activeThreadId = 'thr_b'
  state.activeThreadId = 'thr_c'
  state.error = 'thread C error'
  return { finish, state, setError, sending }
}

describe('external plan handoff identity', () => {
  beforeEach(() => usePlanBuildAgentStore.setState({ plans: {}, handoffs: {}, failures: {} }))

  it('persists the returned build thread and workspace after A -> B -> C navigation', async () => {
    const { finish, state, sending } = dispatchHarness()
    finish({ ok: true, threadId: 'thr_b', workspaceId: 'ws_b' })
    expect(await sending).toBe(true)
    expect(state.activeThreadId).toBe('thr_c')
    expect(usePlanBuildAgentStore.getState().handoffs[plan.id]).toMatchObject({
      threadId: 'thr_b', workspaceId: 'ws_b', sourceThreadId: 'thr_a',
      route: { agentId: 'codex', model: 'gpt-6.1' }
    })
    expect(usePlanBuildAgentStore.getState().handoffs[plan.id]?.route).not.toHaveProperty('accountId')
  })

  it('reports only this dispatch failure without clearing another thread error', async () => {
    const { finish, state, setError, sending } = dispatchHarness()
    finish({ ok: false, error: 'worktree failed' })
    expect(await sending).toBe(false)
    expect(usePlanBuildAgentStore.getState().handoffs[plan.id]).toBeUndefined()
    expect(usePlanBuildAgentStore.getState().failures[plan.id]).toEqual({ agentId: 'codex', message: 'worktree failed' })
    expect(state.error).toBe('thread C error')
    expect(setError).not.toHaveBeenCalled()
  })
})
