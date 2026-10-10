import { describe, expect, test, vi } from 'vitest'
import { makeHarness } from '../../../tests/helpers/acp-runtime-test-support.js'
import type { SteeringEntry } from '../../contracts/turns.js'
import type { DelegatedSteering } from '../../services/delegated-steering.js'
import { OPENCODE_DEFINITION } from '../../harness/providers/opencode.js'

// Give the scripted agent OpenCode's behavior: a prompt sent mid-run joins it.
const hook = vi.hoisted(() => ({ live: true }))
vi.mock('../../harness/providers/registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../harness/providers/registry.js')>()
  return {
    ...actual,
    providerModule: (id: string) => id === 'fake-acp'
      ? { ...actual.providerModule(id), acp: { ...actual.providerModule(id)?.acp, liveSteering: hook.live } }
      : actual.providerModule(id)
  }
})

function guidance() {
  const pending: SteeringEntry[] = []
  const listeners = new Set<() => void>()
  const opened: string[] = []
  const state = { sealed: false }
  return {
    opened,
    state,
    admit(text: string) {
      pending.push({ text })
      for (const listener of listeners) listener()
    },
    turns: {
      openDelegatedSteering: (threadId: string, turnId: string): DelegatedSteering => {
        opened.push(`${threadId}/${turnId}`)
        return {
          subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
          take: async () => pending.splice(0),
          sealIfEmpty: () => (state.sealed = pending.length === 0)
        }
      }
    }
  }
}

describe('AcpRuntime live guidance', () => {
  test('sends guidance as a concurrent session/prompt and books the shared usage once', async () => {
    hook.live = true
    const steer = guidance()
    let admitted = false
    const h = await makeHarness('live-steering.json', {
      turns: steer.turns,
      // OpenCode declares it; the session report must agree.
      definition: { capabilities: OPENCODE_DEFINITION.capabilities },
      onDelta: () => {
        if (admitted) return
        admitted = true
        steer.admit('also allow 5-1 and above')
      }
    })
    expect(await h.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal)).toBe('completed')
    expect(steer.opened).toEqual(['thread_1/turn_1'])
    expect(steer.state.sealed).toBe(true)

    const prompts = h.requests('session/prompt')
    expect(prompts).toHaveLength(2)
    expect(JSON.stringify(prompts[1]?.params?.prompt)).toContain('also allow 5-1 and above')
    expect(JSON.stringify(prompts[1]?.params?.prompt)).not.toContain('hello agent')

    // OpenCode's input excludes cache reads; both results carry the same last call.
    const usage = h.recorded.filter((event) => event.kind === 'usage')
    expect(usage).toHaveLength(1)
    expect(usage[0]?.kind === 'usage' && usage[0].usage).toMatchObject({
      promptTokens: 59_486, cacheHitTokens: 59_200, cacheMissTokens: 286
    })
    expect(h.recorded.find((event) => event.kind === 'delegated_runtime')).toMatchObject({
      capabilities: { liveSteering: true },
      capabilitiesV2: { statuses: { sameTurnSteer: { supported: true } } }
    })
  })

  test('an engine without the hook keeps steering closed', async () => {
    hook.live = false
    const steer = guidance()
    const h = await makeHarness('live-steering.json', {
      turns: steer.turns, definition: { capabilities: OPENCODE_DEFINITION.capabilities }
    })
    expect(await h.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal)).toBe('completed')
    expect(steer.opened).toEqual([])
    expect(h.requests('session/prompt')).toHaveLength(1)
    expect(h.recorded.find((event) => event.kind === 'delegated_runtime')).toMatchObject({
      capabilities: { liveSteering: false },
      capabilitiesV2: { statuses: { sameTurnSteer: { supported: false } } }
    })
  })
})
