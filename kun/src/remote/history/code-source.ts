import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { RuntimeEvent } from '../../contracts/events.js'

/** Checkpoints without their live payload cannot prove a complete public replay. */
export async function codeSourceReplay(runtime: ServerRuntime, threadId: string, floor: number, buffered: RuntimeEvent[]) {
  const through = await runtime.sessionStore.highestSeq(threadId)
  if (through < floor) throw new Error('HISTORY_SOURCE_GAP')
  const events = new Map<number, RuntimeEvent>()
  let bytes = 0
  const retain = (event: RuntimeEvent) => {
    if (event.seq <= floor || event.seq > through) return
    const previous = events.get(event.seq)
    bytes += Buffer.byteLength(JSON.stringify(event)) - (previous ? Buffer.byteLength(JSON.stringify(previous)) : 0)
    if ((!previous && events.size >= 1024) || bytes > 2 * 1024 * 1024) throw new Error('HISTORY_REPLAY_LIMIT')
    events.set(event.seq, event)
  }
  if (!runtime.sessionStore.iterateEventsSince) throw new Error('UNSUPPORTED_HISTORY_SOURCE')
  for await (const event of runtime.sessionStore.iterateEventsSince(threadId, floor)) {
    if (event.seq > through) break
    retain(event)
  }
  for (const event of runtime.eventBus.snapshotSince(threadId, floor)) retain(event)
  for (const event of buffered) retain(event)
  const ordered = [...events.values()].sort((a, b) => a.seq - b.seq)
  if (ordered.some(event => event.kind === 'cursor_checkpoint')) throw new Error('HISTORY_SOURCE_GAP')
  const replayFloor = await runtime.sessionStore.eventReplayFloorSeq?.(threadId) ?? 0
  if (replayFloor > floor + 1) throw new Error('HISTORY_SOURCE_GAP')
  return { events: ordered, through }
}
