import { expect, it } from 'vitest'
import { makeHarness } from '../../../tests/helpers/acp-runtime-test-support.js'

it('fails and cancels promptly on an invalid streamed update instead of waiting for a stalled prompt', async () => {
  const h = await makeHarness('invalid-update-stalled.json')
  expect(await h.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal)).toBe('failed')
  expect(h.finished.at(-1)).toMatchObject({ status: 'failed' })
  expect(h.requests('session/prompt')).toHaveLength(1)
}, 5_000)

it('surfaces timeline persistence failures without poisoning the emission queue silently', async () => {
  const h = await makeHarness('basic-chat.json', { onDelta: () => { throw new Error('fixture timeline unavailable') } })
  expect(await h.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal)).toBe('failed')
  expect(h.finished.at(-1)?.error).toContain('fixture timeline unavailable')
})
