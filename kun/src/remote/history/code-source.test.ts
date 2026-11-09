import { expect, it } from 'vitest'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { RuntimeEvent } from '../../contracts/events.js'
import { codeSourceReplay } from './code-source.js'

const checkpoint = { kind: 'cursor_checkpoint', seq: 3, threadId: 'thread', transientKind: 'item_updated' } as RuntimeEvent
function runtime() {
  return { sessionStore: { highestSeq: async () => 3, eventReplayFloorSeq: async () => 0,
    iterateEventsSince: async function* () { yield checkpoint } }, eventBus: { snapshotSince: () => [] } } as unknown as ServerRuntime
}
it('refuses an unrecoverable transient checkpoint, and accepts its buffered complete live payload', async () => {
  await expect(codeSourceReplay(runtime(), 'thread', 4, [])).rejects.toThrow('HISTORY_SOURCE_GAP')
  await expect(codeSourceReplay(runtime(), 'thread', 0, [])).rejects.toThrow('HISTORY_SOURCE_GAP')
  const live = { kind: 'item_updated', seq: 3, threadId: 'thread', item: { text: 'complete' } } as RuntimeEvent
  expect(await codeSourceReplay(runtime(), 'thread', 0, [live])).toEqual({ events: [live], through: 3 })
})
