import type { RuntimeEvent } from '../contracts/events.js'
import { emptyUsageSnapshot, type UsageSnapshot } from '../contracts/usage.js'
import { addUsage, diffUsage } from '../domain/usage.js'
import type { RoomRuntimeDeps } from './room-runtime-types.js'
import type { RoomPeerActivation } from './room-peer-types.js'

const MAX_EVENTS = 4096
const MAX_BYTES = 4 * 1024 * 1024

async function* boundedEvents(deps: RoomRuntimeDeps, threadId: string, sinceSeq: number): AsyncIterable<RuntimeEvent> {
  const sessions = deps.sessions
  if (sessions.iterateEventsSince) {
    yield* sessions.iterateEventsSince(threadId, sinceSeq, { maxRecordBytes: 256 * 1024 })
    return
  }
  if (!sessions.loadEventPage) throw new Error('bounded peer usage history is unavailable')
  let cursor: string | undefined
  do {
    const page = await sessions.loadEventPage(threadId, { sinceSeq, cursor, maxEvents: 128,
      maxBytes: 256 * 1024, maxRecordBytes: 256 * 1024 })
    yield* page.events
    if (!page.hasMore) return
    if (!page.nextCursor || page.nextCursor === cursor) throw new Error('peer usage cursor did not advance')
    cursor = page.nextCursor
  } while (cursor)
}

/** Capture before enqueue; cumulative usage from an earlier member turn is never billed again. */
export async function captureRoomTurnUsageBaseline(deps: RoomRuntimeDeps, threadId: string): Promise<{
  usageSinceSeq: number; usageBaseline?: UsageSnapshot
}> {
  const usageSinceSeq = await deps.sessions.highestSeq(threadId)
  if (usageSinceSeq === 0) return { usageSinceSeq, usageBaseline: emptyUsageSnapshot() }
  try {
    const indexed = (await deps.sessions.loadLatestUsageSnapshots?.({ threadIds: [threadId] }))?.[0]
    if (indexed && indexed.seq <= usageSinceSeq) return { usageSinceSeq, usageBaseline: indexed.usage }
    const since = Math.max(0, usageSinceSeq - 256)
    let baseline: UsageSnapshot | undefined = since === 0 ? emptyUsageSnapshot() : undefined
    let count = 0, bytes = 0
    for await (const event of boundedEvents(deps, threadId, since)) {
      if (++count > 256 || (bytes += Buffer.byteLength(JSON.stringify(event))) > MAX_BYTES || event.seq > usageSinceSeq) break
      if (event.kind === 'usage') baseline = event.usage
    }
    return { usageSinceSeq, usageBaseline: baseline }
  } catch { return { usageSinceSeq } }
}

export async function readRoomTurnUsage(deps: RoomRuntimeDeps, activation: Pick<RoomPeerActivation, 'threadId' | 'turnId' | 'usageSinceSeq' | 'usageBaseline'>): Promise<{
  usage?: UsageSnapshot; usageStatus: 'complete' | 'partial' | 'unavailable'; model?: string
}> {
  if (!activation.turnId || activation.usageSinceSeq === undefined || !activation.usageBaseline) return { usageStatus: 'unavailable' }
  let previous = activation.usageBaseline, usage = emptyUsageSnapshot()
  let count = 0, bytes = 0, matched = false, partial = false, model: string | undefined
  try {
    for await (const event of boundedEvents(deps, activation.threadId, activation.usageSinceSeq)) {
      if (++count > MAX_EVENTS || (bytes += Buffer.byteLength(JSON.stringify(event))) > MAX_BYTES) { partial = true; break }
      if (event.kind !== 'usage' || event.threadId !== activation.threadId) continue
      const delta = diffUsage(event.usage, previous)
      previous = event.usage
      if (event.turnId !== activation.turnId) continue
      usage = addUsage(usage, delta)
      model = event.model ?? model
      matched = true
    }
  } catch { partial = true }
  return { usage: matched ? usage : undefined, model,
    usageStatus: !matched ? 'unavailable' : partial ? 'partial' : 'complete' }
}
