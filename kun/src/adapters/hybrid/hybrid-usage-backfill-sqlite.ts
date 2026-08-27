import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import { usageRowFromEvent, type UsageRow, type UsageRuntimeEvent } from './hybrid-thread-support.js'

const USAGE_BACKFILL_CHUNK_SIZE = 200

/** Persist usage backfill chunks with their resumable progress in one transaction. */
export async function insertUsageEventsChunked(
  db: BetterSqliteDatabase,
  threadId: string,
  events: UsageRuntimeEvent[],
  resumeAfterSeq: number,
  yieldToEventLoop: () => Promise<void>
): Promise<void> {
  const pending = events
    .filter((event) => event.seq > resumeAfterSeq)
    .sort((left, right) => left.seq - right.seq)
  if (pending.length === 0) return

  const insert = db.prepare(`
    INSERT OR REPLACE INTO usage_events (
      thread_id, seq, timestamp, turn_id, model, provider_id, usage_json
    )
    VALUES (
      @thread_id, @seq, @timestamp, @turn_id, @model, @provider_id, @usage_json
    )
  `)
  const updateHighWater = db.prepare(`
    UPDATE threads
    SET usage_backfill_high_water = MAX(usage_backfill_high_water, @highWater)
    WHERE id = @threadId
  `)
  const insertChunk = db.transaction((chunk: UsageRow[]) => {
    for (const row of chunk) insert.run(row)
    const highWater = chunk.at(-1)?.seq
    if (highWater === undefined) return
    if (updateHighWater.run({ threadId, highWater }).changes !== 1) {
      throw new Error(`missing thread index row for usage backfill: ${threadId}`)
    }
  })

  for (let start = 0; start < pending.length; start += USAGE_BACKFILL_CHUNK_SIZE) {
    insertChunk(pending.slice(start, start + USAGE_BACKFILL_CHUNK_SIZE).map(usageRowFromEvent))
    await yieldToEventLoop()
  }
}

/** Mark completion only after every pending usage chunk has committed. */
export function markUsageBackfilled(db: BetterSqliteDatabase, threadId: string): void {
  if (db.prepare('UPDATE threads SET usage_backfilled = 1 WHERE id = ?').run(threadId).changes !== 1) {
    throw new Error(`missing thread index row for usage backfill completion: ${threadId}`)
  }
}
