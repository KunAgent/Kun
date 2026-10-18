import type { TranscriptEntry } from './transcript-model.js'

export type ScrollbackCommit =
  | { kind: 'thread-header'; threadId: string; title: string; omitted: number }
  | { kind: 'entry'; entry: TranscriptEntry; first: boolean }

export type ScrollbackPlan = {
  commits: ScrollbackCommit[]
  live: TranscriptEntry[]
}

export const MAX_REPLAY_ENTRIES = 400

/**
 * Decides which transcript entries are final enough for the terminal's
 * append-only scrollback. Entries are written strictly in order: once an
 * unsettled entry is reached, it and everything after it stay in the live
 * window, so text already printed never has to be rewritten.
 */
export class ScrollbackPlanner {
  private threadId?: string
  private committed = new Set<string>()
  private wroteEntry = false

  constructor(private readonly maxReplayEntries = MAX_REPLAY_ENTRIES) {}

  get activeThreadId(): string | undefined {
    return this.threadId
  }

  /** Forget the current thread so the next plan replays it from scratch. */
  reset(): void {
    this.threadId = undefined
    this.committed.clear()
    this.wroteEntry = false
  }

  plan(threadId: string | undefined, title: string, entries: readonly TranscriptEntry[]): ScrollbackPlan {
    const commits: ScrollbackCommit[] = []
    if (threadId !== this.threadId) {
      this.threadId = threadId
      this.committed.clear()
      this.wroteEntry = false
      if (threadId) {
        let omitted = 0
        const settledPrefix = entries.findIndex((entry) => !entry.settled)
        const replayable = settledPrefix < 0 ? entries.length : settledPrefix
        if (replayable > this.maxReplayEntries) {
          // Very long threads replay only their recent tail; /timeline and
          // Ctrl+O still browse the whole history.
          let start = replayable - this.maxReplayEntries
          while (start > 0 && entries[start]!.kind !== 'reply-header' && !isUserEntry(entries[start]!)) start -= 1
          for (const entry of entries.slice(0, start)) this.committed.add(entry.key)
          omitted = countTurns(entries.slice(0, start))
        }
        commits.push({ kind: 'thread-header', threadId, title, omitted })
      }
    }
    if (!threadId) return { commits, live: [] }
    let blocked = false
    const live: TranscriptEntry[] = []
    for (const entry of entries) {
      if (this.committed.has(entry.key)) continue
      if (!blocked && entry.settled) {
        this.committed.add(entry.key)
        commits.push({ kind: 'entry', entry, first: !this.wroteEntry })
        this.wroteEntry = true
        continue
      }
      blocked = true
      live.push(entry)
    }
    return { commits, live }
  }
}

function isUserEntry(entry: TranscriptEntry): boolean {
  return entry.kind === 'item' && entry.item.kind === 'user_message'
}

function countTurns(entries: readonly TranscriptEntry[]): number {
  return new Set(entries.flatMap((entry) =>
    entry.kind === 'item' ? [entry.item.turnId] : entry.kind === 'reply-header' ? [entry.turnId] : []
  )).size
}
