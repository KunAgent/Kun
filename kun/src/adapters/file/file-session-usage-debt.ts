import type { RuntimeEvent } from '../../contracts/events.js'

type UsageEvent = Extract<RuntimeEvent, { kind: 'usage' }>
type ThreadDebt = {
  reclaimableBytes: number
  usageSinceInspection: number
  inspectionEvery: number
  latestBucketBytes: Map<string, number>
}

const INITIAL_INSPECTION_EVERY = 32
const MAX_INSPECTION_EVERY = 4_096
const MAX_TRACKED_THREADS = 512
const MAX_BUCKETS_PER_THREAD = 64

/** Tracks likely reclaimable usage rows so mixed logs do not rescan per append. */
export class UsageCompactionDebtTracker {
  private readonly threads = new Map<string, ThreadDebt>()

  constructor(
    private readonly maxFileBytes: number,
    private readonly debtThresholdBytes = Math.max(1, Math.min(256 * 1024, maxFileBytes / 4))
  ) {}

  record(threadId: string, event: UsageEvent, recordBytes: number, fileBytes: number): boolean {
    const state = this.state(threadId)
    const bucket = usageBucket(event)
    const previousBytes = state.latestBucketBytes.get(bucket)
    if (previousBytes !== undefined) state.reclaimableBytes += previousBytes
    state.latestBucketBytes.delete(bucket)
    state.latestBucketBytes.set(bucket, recordBytes)
    while (state.latestBucketBytes.size > MAX_BUCKETS_PER_THREAD) {
      const oldest = state.latestBucketBytes.keys().next().value
      if (oldest === undefined) break
      state.latestBucketBytes.delete(oldest)
    }
    state.usageSinceInspection += 1
    return state.reclaimableBytes >= this.debtThresholdBytes || (
      fileBytes > this.maxFileBytes && state.usageSinceInspection >= state.inspectionEvery
    )
  }

  inspected(threadId: string, compacted: boolean): void {
    const state = this.threads.get(threadId)
    if (!state) return
    state.reclaimableBytes = 0
    state.usageSinceInspection = 0
    state.inspectionEvery = compacted
      ? INITIAL_INSPECTION_EVERY
      : Math.min(MAX_INSPECTION_EVERY, state.inspectionEvery * 2)
  }

  clear(threadId?: string): void {
    if (threadId) this.threads.delete(threadId)
    else this.threads.clear()
  }

  private state(threadId: string): ThreadDebt {
    const existing = this.threads.get(threadId)
    if (existing) {
      this.threads.delete(threadId)
      this.threads.set(threadId, existing)
      return existing
    }
    const created: ThreadDebt = {
      reclaimableBytes: 0,
      usageSinceInspection: 0,
      inspectionEvery: INITIAL_INSPECTION_EVERY,
      latestBucketBytes: new Map()
    }
    this.threads.set(threadId, created)
    while (this.threads.size > MAX_TRACKED_THREADS) {
      const oldest = this.threads.keys().next().value
      if (oldest === undefined) break
      this.threads.delete(oldest)
    }
    return created
  }
}

function usageBucket(event: UsageEvent): string {
  const parsed = Date.parse(event.timestamp)
  const day = Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : event.timestamp
  return `${day}:${event.model ?? ''}`
}
