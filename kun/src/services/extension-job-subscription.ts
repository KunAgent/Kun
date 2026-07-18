import { randomUUID } from 'node:crypto'
import {
  isExtensionJobTerminal,
  parseExtensionJobCursor,
  type ExtensionJobEvent,
  type ExtensionJobSnapshot
} from './extension-job-types.js'
import type { ExtensionJobStoreReplay } from './extension-job-store.js'

export type ExtensionJobSubscriptionItem =
  | { type: 'event'; event: ExtensionJobEvent }
  | {
      type: 'overflow'
      gap: true
      snapshot: ExtensionJobSnapshot
      cursor: string
    }

export type ExtensionJobSubscriptionOptions = {
  jobId: string
  ownerExtensionId: string
  workspaceId: string
  maxQueueEvents: number
  maxQueueBytes: number
  onClose(subscriptionId: string): void
}

type Waiting = {
  resolve(result: IteratorResult<ExtensionJobSubscriptionItem>): void
  reject(error: unknown): void
}

/** Replay metadata plus a bounded async stream of later live events. */
export class ExtensionJobSubscription implements AsyncIterable<ExtensionJobSubscriptionItem> {
  readonly subscriptionId = `jobsub_${randomUUID()}`
  readonly jobId: string
  readonly ownerExtensionId: string
  readonly workspaceId: string
  snapshot!: ExtensionJobSnapshot
  replay: ExtensionJobEvent[] = []
  cursor = ''
  gap = false
  complete = false

  private readonly queue: ExtensionJobSubscriptionItem[] = []
  private readonly pendingDuringReplay: Array<{
    snapshot: ExtensionJobSnapshot
    event: ExtensionJobEvent
  }> = []
  private queuedBytes = 0
  private pendingBytes = 0
  private waiter?: Waiting
  private initialized = false
  private terminalAfterDrain = false
  private closed = false
  private lastSequence = 0
  private pendingOverflow?: ExtensionJobSnapshot

  constructor(private readonly options: ExtensionJobSubscriptionOptions) {
    this.jobId = options.jobId
    this.ownerExtensionId = options.ownerExtensionId
    this.workspaceId = options.workspaceId
  }

  initialize(replay: ExtensionJobStoreReplay): void {
    if (this.closed || this.initialized) return
    this.initialized = true
    this.snapshot = structuredClone(replay.snapshot)
    this.replay = replay.events.map((event) => structuredClone(event))
    this.cursor = replay.cursor
    this.gap = replay.gap
    this.complete = replay.complete
    const parsedCursor = parseExtensionJobCursor(
      replay.events.at(-1)?.cursor ?? replay.snapshot.latestCursor
    )
    this.lastSequence = replay.gap
      ? parsedCursor?.sequence ?? 0
      : replay.events.at(-1)?.sequence ?? parseExtensionJobCursor(replay.cursor)?.sequence ?? 0

    if (this.pendingOverflow !== undefined) {
      this.gap = true
      this.snapshot = structuredClone(this.pendingOverflow)
      this.cursor = this.pendingOverflow.latestCursor
      this.replay = []
      this.complete = isExtensionJobTerminal(this.pendingOverflow.state)
      this.enqueueOverflow(this.pendingOverflow)
      this.pendingDuringReplay.length = 0
      this.pendingBytes = 0
      return
    }

    this.pendingDuringReplay.sort((left, right) => left.event.sequence - right.event.sequence)
    for (const pending of this.pendingDuringReplay) {
      if (pending.event.sequence > this.lastSequence) this.enqueueLive(pending.snapshot, pending.event)
    }
    this.pendingDuringReplay.length = 0
    this.pendingBytes = 0
    if (replay.complete && this.queue.length === 0) this.finish()
  }

  offer(snapshot: ExtensionJobSnapshot, event: ExtensionJobEvent): void {
    if (this.closed || this.terminalAfterDrain || event.jobId !== this.jobId) return
    if (!this.initialized) {
      const bytes = jsonBytes(event)
      if (
        this.pendingDuringReplay.length >= this.options.maxQueueEvents ||
        this.pendingBytes + bytes > this.options.maxQueueBytes
      ) {
        this.pendingDuringReplay.length = 0
        this.pendingBytes = 0
        this.pendingOverflow = structuredClone(snapshot)
        return
      }
      this.pendingDuringReplay.push({
        snapshot: structuredClone(snapshot),
        event: structuredClone(event)
      })
      this.pendingBytes += bytes
      return
    }
    if (event.sequence <= this.lastSequence) return
    this.enqueueLive(snapshot, event)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.queue.length = 0
    this.queuedBytes = 0
    this.pendingDuringReplay.length = 0
    this.pendingBytes = 0
    this.pendingOverflow = undefined
    const waiter = this.waiter
    this.waiter = undefined
    waiter?.resolve({ value: undefined, done: true })
    this.options.onClose(this.subscriptionId)
  }

  [Symbol.asyncIterator](): AsyncIterator<ExtensionJobSubscriptionItem> {
    return {
      next: () => this.next(),
      return: async () => {
        this.close()
        return { value: undefined, done: true }
      },
      throw: async (error?: unknown) => {
        this.close()
        throw error
      }
    }
  }

  private next(): Promise<IteratorResult<ExtensionJobSubscriptionItem>> {
    const value = this.queue.shift()
    if (value !== undefined) {
      this.queuedBytes = Math.max(0, this.queuedBytes - jsonBytes(value))
      if (this.queue.length === 0 && this.terminalAfterDrain) queueMicrotask(() => this.finish())
      return Promise.resolve({ value, done: false })
    }
    if (this.closed || this.terminalAfterDrain) {
      this.finish()
      return Promise.resolve({ value: undefined, done: true })
    }
    if (this.waiter !== undefined) {
      return Promise.reject(new Error('Extension job subscription already has a pending read'))
    }
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject }
    })
  }

  private enqueueLive(snapshot: ExtensionJobSnapshot, event: ExtensionJobEvent): void {
    const item: ExtensionJobSubscriptionItem = { type: 'event', event: structuredClone(event) }
    const bytes = jsonBytes(item)
    if (
      bytes > this.options.maxQueueBytes ||
      this.queue.length >= this.options.maxQueueEvents ||
      this.queuedBytes + bytes > this.options.maxQueueBytes
    ) {
      this.enqueueOverflow(snapshot)
      return
    }
    this.lastSequence = event.sequence
    this.snapshot = structuredClone(snapshot)
    this.cursor = event.cursor
    this.complete = isExtensionJobTerminal(snapshot.state)
    if (this.waiter !== undefined) {
      const waiter = this.waiter
      this.waiter = undefined
      waiter.resolve({ value: item, done: false })
    } else {
      this.queue.push(item)
      this.queuedBytes += bytes
    }
    if (this.complete) this.terminalAfterDrain = true
  }

  private enqueueOverflow(snapshot: ExtensionJobSnapshot): void {
    this.queue.length = 0
    this.queuedBytes = 0
    this.snapshot = structuredClone(snapshot)
    this.cursor = snapshot.latestCursor
    this.gap = true
    this.complete = isExtensionJobTerminal(snapshot.state)
    const item: ExtensionJobSubscriptionItem = {
      type: 'overflow',
      gap: true,
      snapshot: structuredClone(snapshot),
      cursor: snapshot.latestCursor
    }
    this.terminalAfterDrain = true
    if (this.waiter !== undefined) {
      const waiter = this.waiter
      this.waiter = undefined
      waiter.resolve({ value: item, done: false })
    } else {
      this.queue.push(item)
      this.queuedBytes = jsonBytes(item)
    }
  }

  private finish(): void {
    if (this.closed) return
    this.closed = true
    this.complete = true
    const waiter = this.waiter
    this.waiter = undefined
    waiter?.resolve({ value: undefined, done: true })
    this.options.onClose(this.subscriptionId)
  }
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}
