import { resolve, relative, isAbsolute } from 'node:path'
import { isPublicRuntimeEvent, type RuntimeEvent } from '../contracts/events.js'
import type {
  ExtensionAgentProfileSnapshot,
  ExtensionRunBudget,
  ExtensionThreadVisibility,
  ExtensionToolCatalogEpoch,
  ThreadRecord,
  ThreadSummary
} from '../contracts/threads.js'
import type { UsageSnapshot } from '../contracts/usage.js'
import type { ExtensionProviderBinding } from '../contracts/extension-providers.js'
import type { EventBus } from '../ports/event-bus.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadService } from './thread-service.js'
import { TurnConflictError, type TurnService } from './turn-service.js'
import type {
  ExtensionAgentProfileRegistry
} from './extension-agent-profile-registry.js'
import { type BufferedAgentEvent, type ExtensionAgentEvent, type ExtensionAgentSubscription, MAX_EVENT_BYTES, MAX_SUBSCRIPTION_QUEUE, MAX_SUBSCRIPTION_QUEUE_BYTES } from './extension-agent-service-contracts.js'
import { compareBufferedEvents, serializedEventBytes } from './extension-agent-service-event-usage.js'

export class ManagedSubscription implements ExtensionAgentSubscription {
  private queue: BufferedAgentEvent[] = []
  private queueBytes = 0
  private pendingOverflow?: { source: ExtensionAgentEvent; message: string }
  private overflowRequested = false
  private currentDrain?: Promise<void>
  private unsubscribe?: () => void
  closed = false
  lastDeliveredSeq: number

  constructor(
    private readonly listener: (event: ExtensionAgentEvent) => Promise<void> | void,
    initialSeq: number,
    private readonly cursorMetadata: Pick<ExtensionAgentEvent, 'runId' | 'threadId' | 'ownerExtensionId'>
  ) {
    this.lastDeliveredSeq = initialSeq
  }

  get overflowed(): boolean {
    return this.overflowRequested
  }

  setUnsubscribe(unsubscribe: () => void): void {
    this.unsubscribe = unsubscribe
    if (this.closed) unsubscribe()
  }

  enqueue(event: ExtensionAgentEvent, knownBytes?: number): void {
    const bytes = knownBytes ?? serializedEventBytes(event)
    this.enqueueBuffered({ seq: event.seq, timestamp: event.timestamp, event, bytes })
  }

  /** Consume a private persisted event without forwarding its payload. */
  advance(entry: BufferedAgentEvent): void {
    this.enqueueBuffered(entry)
  }

  overflowBuffered(entry: BufferedAgentEvent, message: string): void {
    this.overflow(entry.event ?? this.cursorEvent(entry), message)
  }

  overflow(source: ExtensionAgentEvent, message: string): void {
    if (this.closed || this.overflowRequested) return
    this.queue = []
    this.queueBytes = 0
    this.overflowRequested = true
    this.pendingOverflow = { source, message }
    void this.startDrain()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.queue = []
    this.queueBytes = 0
    this.pendingOverflow = undefined
    this.unsubscribe?.()
  }

  async flush(): Promise<void> {
    while (this.currentDrain || this.queue.length > 0 || this.pendingOverflow) {
      await this.startDrain()
    }
  }

  private startDrain(): Promise<void> {
    if (this.closed) return Promise.resolve()
    if (this.currentDrain) return this.currentDrain
    const drain = this.drain().finally(() => {
      if (this.currentDrain === drain) this.currentDrain = undefined
      if (!this.closed && (this.queue.length > 0 || this.pendingOverflow)) void this.startDrain()
    })
    this.currentDrain = drain
    return drain
  }

  private async drain(): Promise<void> {
    try {
      while (!this.closed) {
        const overflow = this.pendingOverflow
        if (overflow) {
          this.pendingOverflow = undefined
          await this.listener({
            ...overflow.source,
            type: 'subscription_overflow',
            payload: { message: overflow.message, resumeAfterSeq: this.lastDeliveredSeq }
          })
          this.close()
          break
        }
        const entry = this.queue.shift()
        if (!entry) break
        this.queueBytes -= entry.bytes
        if (entry.seq <= this.lastDeliveredSeq) continue
        if (entry.event) await this.listener(entry.event)
        this.lastDeliveredSeq = entry.seq
      }
    } catch {
      this.close()
    }
  }

  private enqueueBuffered(entry: BufferedAgentEvent): void {
    if (this.closed || entry.seq <= this.lastDeliveredSeq) return
    if (this.pendingOverflow || this.queue.some((queued) => queued.seq === entry.seq)) return
    if (entry.bytes > MAX_EVENT_BYTES) {
      this.overflowBuffered(entry, 'event exceeds the extension subscription message limit')
      return
    }
    if (
      this.queue.length >= MAX_SUBSCRIPTION_QUEUE ||
      this.queueBytes + entry.bytes > MAX_SUBSCRIPTION_QUEUE_BYTES
    ) {
      this.overflowBuffered(entry, 'extension subscription queue overflowed')
      return
    }
    this.queue.push(entry)
    this.queueBytes += entry.bytes
    this.queue.sort(compareBufferedEvents)
    void this.startDrain()
  }

  private cursorEvent(entry: BufferedAgentEvent): ExtensionAgentEvent {
    return {
      seq: entry.seq,
      timestamp: entry.timestamp,
      type: 'heartbeat',
      ...this.cursorMetadata,
      payload: {}
    }
  }
}
