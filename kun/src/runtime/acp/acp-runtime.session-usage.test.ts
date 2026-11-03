import { beforeEach, describe, expect, test, vi } from 'vitest'
import { makeHarness } from '../../../tests/helpers/acp-runtime-test-support.js'
import type { AcpSessionUsageSample } from '../../harness/providers/provider-module.js'

const hook = vi.hoisted(() => ({
  begin: vi.fn(),
  collect: vi.fn()
}))

// Give the scripted agent what DeepSeek Harness has: the session-log hook, and a native API
// key that reaches the turn as credential env (a native login, not a kun-gateway route).
vi.mock('../../harness/providers/registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../harness/providers/registry.js')>()
  return {
    ...actual,
    providerModule: (id: string) => id === 'fake-acp'
      ? {
          ...actual.providerModule(id),
          credentials: { env: () => ({ FAKE_NATIVE_API_KEY: 'native-key' }) },
          acp: { ...actual.providerModule(id)?.acp, sessionUsage: hook }
        }
      : actual.providerModule(id)
  }
})

const sample = (completion: number, ttft: number): AcpSessionUsageSample => ({
  model: 'deepseek-v4-flash',
  usage: {
    promptTokens: 5800, completionTokens: completion, totalTokens: 5800 + completion,
    cacheHitRate: 0.9, turns: 0, cachedTokens: 5200, cacheHitTokens: 5200, cacheMissTokens: 600,
    requestTtftMs: ttft, requestGenerationMs: 700
  }
})

describe('AcpRuntime usage from the engine session log', () => {
  beforeEach(() => {
    hook.begin.mockReset().mockResolvedValue({ size: 386 })
    hook.collect.mockReset().mockResolvedValue([])
  })

  test('records one usage event per logged model call when the agent reports none', async () => {
    hook.collect.mockResolvedValue([sample(82, 1817), sample(12, 1591)])
    const h = await makeHarness('basic-chat.json')
    expect(await h.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal)).toBe('completed')

    expect(hook.begin).toHaveBeenCalledOnce()
    expect(hook.begin.mock.calls[0]![0]).toMatchObject({ sessionId: 'sess-basic', workspace: h.workspace })
    expect(hook.collect).toHaveBeenCalledWith({ size: 386 }, expect.objectContaining({ sessionId: 'sess-basic' }))
    const usage = h.recorded.filter((event) => event.kind === 'usage')
    expect(usage.map((event) => event.kind === 'usage' && [event.usage.completionTokens, event.usage.requestTtftMs])).toEqual([[82, 1817], [12, 1591]])
    expect(usage[0]).toMatchObject({ source: 'harness-reported', harnessId: 'fake-acp', model: 'deepseek-v4-flash', threadId: 'thread_1', turnId: 'turn_1' })
    expect(h.finished).toHaveLength(1)
  })

  test('records the usage of a native login even when its API key is in the environment', async () => {
    // Only a kun-gateway route is metered by the gateway; a non-empty credential env is not that.
    const h = await makeHarness('streaming-timing.json')
    expect(await h.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal)).toBe('completed')
    expect(h.recorded.filter((event) => event.kind === 'usage')).toHaveLength(1)
  })

  test('keeps the usage an agent reports itself and does not read its log', async () => {
    hook.collect.mockResolvedValue([sample(999, 1)])
    const h = await makeHarness('streaming-timing.json')
    expect(await h.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal)).toBe('completed')

    expect(hook.collect).not.toHaveBeenCalled()
    const usage = h.recorded.filter((event) => event.kind === 'usage')
    expect(usage).toHaveLength(1)
    expect(usage[0]?.kind === 'usage' && usage[0].usage.completionTokens).toBe(400)
  })

  test('a log that cannot be read leaves the turn untouched', async () => {
    hook.begin.mockRejectedValue(new Error('no home'))
    const failing = await makeHarness('basic-chat.json')
    expect(await failing.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal)).toBe('completed')
    expect(failing.recorded.filter((event) => event.kind === 'usage')).toEqual([])

    hook.begin.mockResolvedValue({ size: 0 })
    hook.collect.mockRejectedValue(new Error('bad frame'))
    const broken = await makeHarness('basic-chat.json')
    expect(await broken.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal)).toBe('completed')
    expect(broken.recorded.filter((event) => event.kind === 'usage')).toEqual([])
  })
})
