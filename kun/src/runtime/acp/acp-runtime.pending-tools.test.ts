import { expect, it } from 'vitest'
import { makeHarness } from '../../../tests/helpers/acp-runtime-test-support.js'

async function withDeferredGuidance(stalled = false) {
  const pending = [{ text: 'Now run the typecheck and finish the task.' }]
  return makeHarness(stalled ? 'native-background-tools-stalled.json' : 'native-background-tools.json', {
    definition: { id: 'antigravity' }, turn: { harnessId: 'antigravity', model: 'default' },
    thread: { harnessId: 'antigravity' },
    items: [{ id: 'user', threadId: 'thread_1', turnId: 'turn_1', kind: 'user_message', role: 'user',
      status: 'completed', createdAt: '2026-11-17T00:00:00.000Z', text: 'Prepare follow-up run' }],
    turns: { openDelegatedSteering: () => ({ subscribe: () => () => {}, take: async () => pending.splice(0), sealIfEmpty: () => !pending.length }) }
  })
}

it('keeps an Antigravity turn alive for native command/timer results instead of marking them interrupted', async () => {
  const h = await makeHarness('native-background-tools.json', {
    definition: { id: 'antigravity' }, turn: { harnessId: 'antigravity', model: 'default' },
    thread: { harnessId: 'antigravity' }
  })
  expect(await h.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal)).toBe('completed')
  expect(h.requests('session/prompt')).toHaveLength(2)
  expect(JSON.stringify(h.requests('session/prompt')[0]?.params)).toContain('do not end with a promise to continue automatically')
  expect(JSON.stringify(h.requests('session/prompt')[1]?.params)).toContain('Do not restart those commands')
  const results = h.applied.filter((item) => item.kind === 'tool_result')
  expect(results).toHaveLength(2)
  expect(results.every((item) => item.status === 'completed')).toBe(true)
  expect(h.finished).toMatchObject([{ status: 'completed' }])
  expect(h.recorded.filter((event) => event.kind === 'usage').map((event) => event.kind === 'usage' && event.usage.totalTokens))
    .toEqual([12, 23])
})

it('respects user cancellation instead of continuing native background work', async () => {
  const controller = new AbortController()
  const h = await makeHarness('native-background-tools.json', {
    definition: { id: 'antigravity' }, turn: { harnessId: 'antigravity', model: 'default' },
    thread: { harnessId: 'antigravity' }, onDelta: () => controller.abort()
  })
  expect(await h.runtime.runTurn('thread_1', 'turn_1', controller.signal)).toBe('aborted')
  expect(h.requests('session/prompt')).toHaveLength(1)
  expect(h.finished).toMatchObject([{ status: 'aborted' }])
  expect(h.recorded.filter((event) => event.kind === 'usage').map((event) => event.kind === 'usage' && event.usage.totalTokens))
    .toEqual([12])
})

it('reports persistent unfinished native work as incomplete and books every consumed prompt', async () => {
  const h = await makeHarness('native-background-tools-stalled.json', {
    definition: { id: 'antigravity' }, turn: { harnessId: 'antigravity', model: 'default' },
    thread: { harnessId: 'antigravity' }
  })
  expect(await h.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal)).toBe('failed')
  expect(h.requests('session/prompt')).toHaveLength(4)
  expect(h.finished).toMatchObject([{ status: 'failed', code: 'agent_error', error: expect.stringContaining('incomplete') }])
  expect(h.recorded.filter((event) => event.kind === 'usage').map((event) => event.kind === 'usage' && event.usage.totalTokens))
    .toEqual([12, 12, 12, 12])
}, 10_000)

it('also settles native async work started by deferred composer guidance', async () => {
  const h = await withDeferredGuidance()
  expect(await h.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal)).toBe('completed')
  expect(h.requests('session/prompt')).toHaveLength(3)
  expect(h.applied.filter((item) => item.kind === 'tool_result').every((item) => item.status === 'completed')).toBe(true)
  expect(h.recorded.filter((event) => event.kind === 'usage').map((event) => event.kind === 'usage' && event.usage.totalTokens))
    .toEqual([2, 12, 23])
})

it('fails the turn when deferred guidance cannot settle its native work, retaining the main prompt usage', async () => {
  const h = await withDeferredGuidance(true)
  expect(await h.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal)).toBe('failed')
  expect(h.finished).toMatchObject([{ status: 'failed', code: 'agent_error' }])
  expect(h.requests('session/prompt')).toHaveLength(5)
  expect(h.recorded.filter((event) => event.kind === 'usage').map((event) => event.kind === 'usage' && event.usage.totalTokens))
    .toEqual([2, 12, 12, 12, 12])
}, 10_000)
