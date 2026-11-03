import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentDispatchIntentView } from '@shared/agent-dispatch'

const client = vi.hoisted(() => ({ get: vi.fn(), act: vi.fn() }))
vi.mock('../../agent/agent-dispatch-client', () => {
  let cached: AgentDispatchIntentView | undefined
  const listeners = new Set<() => void>()
  return {
    agentDispatchClient: client,
    agentDispatchCache: {
      subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
      get: () => cached
    },
    publishAgentDispatchIntent: (intent: AgentDispatchIntentView) => { cached = intent; listeners.forEach((listener) => listener()) }
  }
})

import { useAgentDispatchIntent } from './use-agent-dispatch-intent'

const intent = { intentId: 'intent', state: 'paused', revision: 3 } as unknown as AgentDispatchIntentView
let hook: ReturnType<typeof useAgentDispatchIntent> | undefined
let renderer: ReactTestRenderer | undefined
function Probe() { hook = useAgentDispatchIntent('intent', intent); return null }

afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount())
  renderer = undefined
})

describe('useAgentDispatchIntent', () => {
  it('keeps a refused action\'s reason after the refresh that follows it', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    client.get.mockResolvedValue(intent)
    client.act.mockRejectedValue(new Error('Codex is signed out'))
    await act(async () => { renderer = create(createElement(Probe)) })
    await act(async () => { await hook!.act('update', { recommendation: { assignments: [] } }) })
    expect(client.get).toHaveBeenCalledTimes(2)
    expect(hook!.error).toBe('Codex is signed out')
    client.act.mockResolvedValue(intent)
    await act(async () => { await hook!.act('resume') })
    expect(hook!.error).toBe('')
  })
})
