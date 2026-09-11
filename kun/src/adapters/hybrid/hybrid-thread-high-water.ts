import type { Database as BetterSqliteDatabase, Statement } from 'better-sqlite3'

/**
 * Buffers `threads.event_seq_high_water` bumps so the per-event hot path does
 * not pay one SQLite commit per recorded event. The column is only a fast
 * hint for `highestSeq` — the JSONL event log stays canonical (the hybrid
 * session store takes max(index, file)), so a crash that drops pending marks
 * merely makes the next startup re-scan a slightly older floor.
 */
export const DEFAULT_HIGH_WATER_FLUSH_MS = 250

const HIGH_WATER_UPDATE_SQL = `
  UPDATE threads
  SET event_seq_high_water = CASE
    WHEN event_seq_high_water > @seq THEN event_seq_high_water
    ELSE @seq
  END
  WHERE id = @id
`

/** One transaction per flush window for all buffered thread marks. */
export function createEventHighWaterApply(
  getDb: () => BetterSqliteDatabase | null,
  statementFor: (sql: string) => Statement
): (entries: ReadonlyMap<string, number>) => void {
  return (entries) => {
    const db = getDb()
    if (!db || entries.size === 0) return
    const statement = statementFor(HIGH_WATER_UPDATE_SQL)
    db.transaction((rows: ReadonlyMap<string, number>) => {
      for (const [id, seq] of rows) statement.run({ id, seq })
    })(entries)
  }
}

export class EventHighWaterBuffer {
  private readonly pending = new Map<string, number>()
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly flushDelayMs: number = DEFAULT_HIGH_WATER_FLUSH_MS,
    private readonly apply: (entries: ReadonlyMap<string, number>) => void,
    private readonly onError: (error: unknown) => void
  ) {}

  note(threadId: string, seq: number): void {
    const current = this.pending.get(threadId) ?? 0
    if (seq > current) this.pending.set(threadId, seq)
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = undefined
        this.flush()
      }, this.flushDelayMs)
      this.timer.unref?.()
    }
  }

  /** Highest seq still waiting to be committed; 0 when nothing is pending. */
  pendingFor(threadId: string): number {
    return this.pending.get(threadId) ?? 0
  }

  get pendingCount(): number {
    return this.pending.size
  }

  clearThread(threadId: string): void {
    this.pending.delete(threadId)
  }

  /** Commits every buffered mark in one caller-provided batch/transaction. */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (this.pending.size === 0) return
    const entries = new Map(this.pending)
    this.pending.clear()
    try {
      this.apply(entries)
    } catch (error) {
      // The marks are hint-only; a degraded index must not fail the stream.
      this.onError(error)
    }
  }
}
