import { afterEach, describe, expect, it } from 'vitest'
import { resolvePlanBuildRoute, usePlanBuildAgentStore } from './plan-build-agent-store'

const composer = { harnessId: 'kun', model: 'deepseek-v4', providerId: 'deepseek', credentialMode: '' }

describe('plan build agent store', () => {
  afterEach(() => usePlanBuildAgentStore.setState({ plans: {}, handoffs: {} }))

  it('falls back to the composer Agent until the plan has a pick', () => {
    expect(resolvePlanBuildRoute(undefined, composer))
      .toEqual({ agentId: 'kun', model: 'deepseek-v4', providerId: 'deepseek' })
    expect(resolvePlanBuildRoute(undefined, { harnessId: 'claude-code', model: 'opus', providerId: '', credentialMode: 'native-login' }))
      .toEqual({ agentId: 'claude-code', model: 'opus', credentialMode: 'native-login' })
  })

  it('remembers one pick per plan and lets it win over the composer', () => {
    const store = usePlanBuildAgentStore.getState()
    store.setRoute('plan-a', { agentId: 'codex', model: 'gpt-6.1-codex', credentialMode: 'native-login' })
    const picked = usePlanBuildAgentStore.getState().plans['plan-a']
    expect(resolvePlanBuildRoute(picked, composer).agentId).toBe('codex')
    expect(usePlanBuildAgentStore.getState().plans['plan-b']).toBeUndefined()
    store.clearRoute('plan-a')
    expect(usePlanBuildAgentStore.getState().plans['plan-a']).toBeUndefined()
  })

  it('keeps a handoff per plan until the card rebuilds', () => {
    const store = usePlanBuildAgentStore.getState()
    store.setHandoff('plan-a', { threadId: 'thread-1', route: { agentId: 'codex' } })
    expect(usePlanBuildAgentStore.getState().handoffs['plan-a']?.threadId).toBe('thread-1')
    store.clearHandoff('plan-a')
    expect(usePlanBuildAgentStore.getState().handoffs['plan-a']).toBeUndefined()
  })
})
