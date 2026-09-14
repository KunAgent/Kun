import type { EventBus } from '../ports/event-bus.js'
import type { RuntimeEvent } from '../contracts/events.js'

/**
 * Retained events per thread for `snapshotSince`. SSE replay reads the
 * persisted session store, not the bus, so the bus only needs a recent
 * tail — retaining every event leaked the full delta stream of every
 * long-running thread into memory.
 */
const MAX_RETAINED_EVENTS_PER_THREAD = 256
const DEFAULT_MAX_RETAINED_EVENT_BYTES = 4 * 1024 * 1024

type RetainedEvent = {
  threadId: string
  event: RuntimeEvent
  bytes: number
}

/**
 * In-memory implementation of the event bus used by tests and the
 * default runtime. Subscribers receive only events for their thread.
 * Live fan-out is the bus's job; durable replay belongs to the
 * session store.
 */
export class InMemoryEventBus implements EventBus {
  private readonly events = new Map<string, RetainedEvent[]>()
  private readonly retainedOrder: RetainedEvent[] = []
  private retainedBytes = 0
  private readonly subscribers = new Map<string, Set<(event: RuntimeEvent) => void>>()
  private nextSeq = new Map<string, number>()
  private highestSeqByThread = new Map<string, number>()

  constructor(private readonly options: {
    maxRetainedBytes?: number
    maxRetainedEventsPerThread?: number
    /**
     * Retain a per-thread tail so `snapshotSince` can answer. Disable when no
     * consumer replays from the bus (production SSE replays the durable
     * session store) — retention costs one JSON.stringify per published
     * event just to account its bytes.
     */
    retainTail?: boolean
  } = {}) {}

  private get retainsTail(): boolean {
    return this.options.retainTail !== false
  }

  publish(event: RuntimeEvent): void {
    const highest = this.highestSeqByThread.get(event.threadId) ?? 0
    if (event.seq > highest) this.highestSeqByThread.set(event.threadId, event.seq)

    if (this.retainsTail) {
      const maxRetainedBytes = Math.max(
        1,
        Math.floor(this.options.maxRetainedBytes ?? DEFAULT_MAX_RETAINED_EVENT_BYTES)
      )
      const bytes = Buffer.byteLength(JSON.stringify(event), 'utf-8')
      if (bytes <= maxRetainedBytes / 2 && bytes <= maxRetainedBytes) {
        const list = this.events.get(event.threadId) ?? []
        const retained = { threadId: event.threadId, event, bytes }
        list.push(retained)
        this.retainedOrder.push(retained)
        this.retainedBytes += bytes
        this.events.set(event.threadId, list)
        const maxPerThread = Math.max(
          1,
          Math.floor(this.options.maxRetainedEventsPerThread ?? MAX_RETAINED_EVENTS_PER_THREAD)
        )
        while (list.length > maxPerThread) this.evict(list[0]!)
        while (this.retainedBytes > maxRetainedBytes) {
          const oldest = this.retainedOrder[0]
          if (!oldest) break
          this.evict(oldest)
        }
      }
    }

    const subscribers = this.subscribers.get(event.threadId)
    if (!subscribers) return
    for (const handler of subscribers) {
      try {
        handler(event)
      } catch {
        // Subscribers should not throw; isolate failures so publishing continues.
      }
    }
  }

  subscribe(threadId: string, handler: (event: RuntimeEvent) => void): () => void {
    const set = this.subscribers.get(threadId) ?? new Set()
    set.add(handler)
    this.subscribers.set(threadId, set)
    return () => {
      set.delete(handler)
      if (set.size === 0 && this.subscribers.get(threadId) === set) {
        this.subscribers.delete(threadId)
      }
    }
  }

  snapshotSince(threadId: string, sinceSeq: number): RuntimeEvent[] {
    if (!this.retainsTail) return []
    const list = this.events.get(threadId) ?? []
    return list.map(({ event }) => event).filter((event) => event.seq > sinceSeq)
  }

  highestSeq(threadId: string): number {
    return this.highestSeqByThread.get(threadId) ?? 0
  }

  /** Returns the next per-thread `seq` value, allocating one if needed. */
  allocateSeq(threadId: string): number {
    const next = (this.nextSeq.get(threadId) ?? this.highestSeq(threadId)) + 1
    this.nextSeq.set(threadId, next)
    return next
  }

  reset(): void {
    this.events.clear()
    this.retainedOrder.splice(0)
    this.retainedBytes = 0
    this.subscribers.clear()
    this.nextSeq.clear()
    this.highestSeqByThread.clear()
  }

  clearThread(threadId: string): void {
    for (const retained of this.events.get(threadId) ?? []) {
      this.retainedBytes = Math.max(0, this.retainedBytes - retained.bytes)
    }
    this.events.delete(threadId)
    for (let index = this.retainedOrder.length - 1; index >= 0; index -= 1) {
      if (this.retainedOrder[index]?.threadId === threadId) {
        this.retainedOrder.splice(index, 1)
      }
    }
    this.subscribers.delete(threadId)
    this.nextSeq.delete(threadId)
    this.highestSeqByThread.delete(threadId)
  }

  private evict(retained: RetainedEvent): void {
    const list = this.events.get(retained.threadId)
    if (!list) return
    const index = list.indexOf(retained)
    if (index < 0) return
    list.splice(index, 1)
    const orderIndex = this.retainedOrder.indexOf(retained)
    if (orderIndex >= 0) this.retainedOrder.splice(orderIndex, 1)
    this.retainedBytes = Math.max(0, this.retainedBytes - retained.bytes)
    if (list.length === 0) this.events.delete(retained.threadId)
  }
}
