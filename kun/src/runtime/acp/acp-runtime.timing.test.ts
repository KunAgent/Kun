import { describe, expect, test } from 'vitest'
import { makeHarness } from '../../../tests/helpers/acp-runtime-test-support.js'

describe('AcpRuntime stream timing', () => {
  test('stamps the prompt usage with the TTFT and streaming speed seen on the wire', async () => {
    // The scripted Agent waits 200 ms, then streams 12 chunks of ~21 estimated
    // tokens 40 ms apart, and reports 400 output tokens.
    const h = await makeHarness('streaming-timing.json')
    expect(await h.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal)).toBe('completed')

    const usage = h.recorded.find((event) => event.kind === 'usage')
    expect(usage?.kind === 'usage' && usage.usage).toBeTruthy()
    const snapshot = usage!.kind === 'usage' ? usage!.usage : undefined
    // Real timers: bounds are lower limits of the script plus generous scheduling slack.
    expect(snapshot!.requestTtftMs).toBeGreaterThanOrEqual(180)
    expect(snapshot!.requestTtftMs).toBeLessThan(5_000)
    expect(snapshot!.requestGenerationMs).toBeGreaterThanOrEqual(11 * 40 - 40)
    expect(snapshot!.requestGenerationMs).toBeLessThan(5_000)
    // 11 chunks after the first one (the first only marks the start of the stream)
    expect(snapshot!.requestGenerationTokens).toBeGreaterThan(200)
    expect(snapshot!.requestGenerationTokens).toBeLessThanOrEqual(240)
  })
})
