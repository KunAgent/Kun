import { describe, expect, it } from 'vitest'
import { makeHarness } from '../../../tests/helpers/acp-runtime-test-support.js'

describe('ACP last prompt admission', () => {
  it.each(['disable', 'abort'] as const)('does not send a prompt after %s during asynchronous setup', async (change) => {
    let enabled = true
    const controller = new AbortController()
    const h = await makeHarness('basic-chat.json', { deps: {
      readiness: {
        commandForTurn: () => undefined,
        validateTurn: async () => { if (!enabled) throw new Error('profile disabled'); return 'proof' }
      },
      events: { record: async (event: { kind: string }) => {
        if (event.kind !== 'delegated_runtime') return
        if (change === 'disable') enabled = false
        else controller.abort(new Error('cancelled'))
      } } as never
    } })
    expect(await h.runtime.runTurn('thread_1', 'turn_1', controller.signal)).toBe(change === 'abort' ? 'aborted' : 'failed')
    expect(h.requests('session/new')).toHaveLength(1)
    expect(h.requests('session/prompt')).toHaveLength(0)
  })
})
