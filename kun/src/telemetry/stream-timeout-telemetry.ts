import type { StreamTimeoutEvent } from '../adapters/model/stream-timeout.js'

/**
 * Telemetry collector for stream timeout events.
 * Per-provider ring buffers with bounded memory.
 */
export class StreamTimeoutTelemetry {
  private readonly events: StreamTimeoutEvent[] = []
  private readonly maxEvents: number

  constructor(maxEvents = 200) { this.maxEvents = maxEvents }

  record(event: StreamTimeoutEvent): void {
    this.events.push(event)
    if (this.events.length > this.maxEvents) {
      this.events.shift()
    }
  }

  getEvents(): readonly StreamTimeoutEvent[] { return this.events }

  getSummary(): {
    totalTimeouts: number
    byKind: Record<string, number>
    byProvider: Record<string, number>
  } {
    const byKind: Record<string, number> = {}
    const byProvider: Record<string, number> = {}
    for (const e of this.events) {
      byKind[e.kind] = (byKind[e.kind] ?? 0) + 1
      byProvider[e.provider] = (byProvider[e.provider] ?? 0) + 1
    }
    return { totalTimeouts: this.events.length, byKind, byProvider }
  }

  reset(): void { this.events.length = 0 }
}

export const streamTimeoutTelemetry = new StreamTimeoutTelemetry()
