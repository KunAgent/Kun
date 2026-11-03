import { describe, expect, test, vi } from 'vitest'
import { makeHarness } from '../../../tests/helpers/acp-runtime-test-support.js'
import { grokPromptResultUsage } from '../../harness/grok-usage.js'

// Give the scripted agent what Grok Build has: usage in the prompt result's `_meta`.
const withHook = vi.hoisted(() => ({ on: true }))
vi.mock('../../harness/providers/registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../harness/providers/registry.js')>()
  const { grokPromptResultUsage: parse } = await import('../../harness/grok-usage.js')
  return {
    ...actual,
    providerModule: (id: string) => id === 'fake-acp' && withHook.on
      ? { ...actual.providerModule(id), acp: { ...actual.providerModule(id)?.acp, promptResultUsage: parse } }
      : actual.providerModule(id)
  }
})

describe('AcpRuntime usage carried in the prompt result _meta', () => {
  test('records it as the turn usage, with the cache split and reasoning, and no cost', async () => {
    withHook.on = true
    const h = await makeHarness('grok-meta-usage.json')
    expect(await h.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal)).toBe('completed')
    const usage = h.recorded.filter((event) => event.kind === 'usage')
    expect(usage).toHaveLength(1)
    expect(usage[0]).toMatchObject({ source: 'harness-reported', harnessId: 'fake-acp', threadId: 'thread_1', turnId: 'turn_1' })
    expect(usage[0]?.kind === 'usage' && usage[0].usage).toMatchObject({
      promptTokens: 16643, completionTokens: 28, totalTokens: 16671, reasoningTokens: 27,
      cachedTokens: 1664, cacheHitTokens: 1664, cacheMissTokens: 14979
    })
    expect(usage[0]?.kind === 'usage' && usage[0].usage.costUsd).toBeUndefined()
    expect(grokPromptResultUsage).toBeTypeOf('function')
  })

  test('an engine without the hook still records nothing for the same result', async () => {
    withHook.on = false
    const h = await makeHarness('grok-meta-usage.json')
    expect(await h.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal)).toBe('completed')
    expect(h.recorded.filter((event) => event.kind === 'usage')).toEqual([])
  })
})
