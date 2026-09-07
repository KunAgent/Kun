import type { SteeringEntry } from '../contracts/turns.js'

/**
 * Mid-turn steering queue. The renderer posts steering text while a
 * turn is running; the queue collects those messages and injects them
 * as user inputs at the next safe loop boundary. The queue is cleared
 * on turn completion or interruption.
 */
export type { SteeringEntry } from '../contracts/turns.js'

type SteeringBuffer = {
  entries: SteeringEntry[]
  bytes: number
}

/** Bound one active turn's queued user steering before the next model boundary. */
export const DEFAULT_MAX_STEERING_ENTRIES_PER_TURN = 32
export const DEFAULT_MAX_STEERING_BYTES_PER_TURN = 64 * 1024

export class SteeringQueue {
  private readonly buffers = new Map<string, SteeringBuffer>()
  private readonly admissions = new Map<string, Set<Promise<void>>>()
  private readonly durablePending = new Set<string>()

  markDurablePending(turnId: string): void { this.durablePending.add(turnId) }
  clearDurablePending(turnId: string): void { this.durablePending.delete(turnId) }

  /** Prevent final sealing while a durable admission crosses its commit boundary. */
  holdAdmission(turnId: string): () => void {
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    const holds = this.admissions.get(turnId) ?? new Set<Promise<void>>()
    holds.add(pending)
    this.admissions.set(turnId, holds)
    return () => {
      holds.delete(pending)
      if (holds.size === 0) this.admissions.delete(turnId)
      release()
    }
  }

  async waitForAdmissions(turnId: string): Promise<void> {
    while (this.admissions.get(turnId)?.size) {
      await Promise.all([...this.admissions.get(turnId)!])
    }
  }

  /** Attachment ids already drained but retained for cumulative turn admission checks. */
  private readonly drainedAttachments = new Map<string, Set<string>>()
  private readonly sealedTurns = new Set<string>()
  private readonly maxEntriesPerTurn: number
  private readonly maxBytesPerTurn: number

  constructor(options: {
    maxEntriesPerTurn?: number
    maxBytesPerTurn?: number
  } = {}) {
    this.maxEntriesPerTurn = normalizeLimit(
      options.maxEntriesPerTurn,
      DEFAULT_MAX_STEERING_ENTRIES_PER_TURN
    )
    this.maxBytesPerTurn = normalizeLimit(
      options.maxBytesPerTurn,
      DEFAULT_MAX_STEERING_BYTES_PER_TURN
    )
  }

  /** Returns false when accepting this entry would exceed the per-turn bound. */
  enqueue(turnId: string, entry: SteeringEntry): boolean {
    if (this.sealedTurns.has(turnId)) return false
    const text = entry.text.trim()
    if (!text) return true
    const normalized: SteeringEntry = {
      text,
      ...(entry.displayText?.trim() ? { displayText: entry.displayText.trim() } : {}),
      ...(entry.messageSource ? { messageSource: entry.messageSource } : {}),
      ...(entry.attachmentIds?.length ? { attachmentIds: [...entry.attachmentIds] } : {})
    }
    const bytes = steeringEntryBytes(normalized)
    const buffer = this.buffers.get(turnId)
    const currentEntries = buffer?.entries.length ?? 0
    const currentBytes = buffer?.bytes ?? 0
    if (
      bytes > this.maxBytesPerTurn ||
      currentEntries >= this.maxEntriesPerTurn ||
      currentBytes + bytes > this.maxBytesPerTurn
    ) {
      return false
    }
    const next: SteeringBuffer = buffer ?? { entries: [], bytes: 0 }
    next.entries.push(normalized)
    next.bytes += bytes
    this.buffers.set(turnId, next)
    return true
  }

  /**
   * Drain queued steering messages and return them. The loop calls
   * this at safe boundaries (after a model response, before the next
   * model request). Returns an empty array when nothing is pending.
   */
  drain(turnId: string): SteeringEntry[] {
    const buffer = this.buffers.get(turnId)
    if (!buffer?.entries.length) return []
    const drained = this.drainedAttachments.get(turnId) ?? new Set<string>()
    for (const entry of buffer.entries) {
      for (const attachmentId of entry.attachmentIds ?? []) drained.add(attachmentId)
    }
    if (drained.size > 0) this.drainedAttachments.set(turnId, drained)
    const out = buffer.entries.map(copySteeringEntry)
    this.buffers.delete(turnId)
    return out
  }

  /**
   * Peek at the queued text without removing it. Used by the UI to
   * show pending steering in a "pending injection" indicator.
   */
  peek(turnId: string): SteeringEntry[] {
    return (this.buffers.get(turnId)?.entries ?? []).map(copySteeringEntry)
  }

  /** Attachment ids drained earlier in this turn and not yet cleared at settlement. */
  drainedAttachmentIds(turnId: string): string[] {
    return [...(this.drainedAttachments.get(turnId) ?? [])]
  }

  /** Atomically replace the pending queue after validating the same bounds as enqueue. */
  replace(turnId: string, entries: readonly SteeringEntry[]): boolean {
    if (this.sealedTurns.has(turnId)) return false
    const normalized = entries.flatMap((entry) => {
      const text = entry.text.trim()
      if (!text) return []
      return [{
        text,
        ...(entry.displayText?.trim() ? { displayText: entry.displayText.trim() } : {}),
        ...(entry.messageSource ? { messageSource: entry.messageSource } : {}),
        ...(entry.attachmentIds?.length ? { attachmentIds: [...entry.attachmentIds] } : {})
      }]
    })
    const bytes = normalized.reduce((total, entry) => total + steeringEntryBytes(entry), 0)
    if (normalized.length > this.maxEntriesPerTurn || bytes > this.maxBytesPerTurn) return false
    if (normalized.length === 0) this.buffers.delete(turnId)
    else this.buffers.set(turnId, { entries: normalized, bytes })
    return true
  }

  /**
   * Atomically close an empty turn buffer before the loop commits a terminal
   * result. If an entry already won the race, leave the queue open so the loop
   * can drain it and perform another model step.
   */
  sealIfEmpty(turnId: string): boolean {
    if (this.admissions.get(turnId)?.size || this.durablePending.has(turnId)) return false
    if ((this.buffers.get(turnId)?.entries.length ?? 0) > 0) return false
    this.sealedTurns.add(turnId)
    return true
  }

  closeAdmission(turnId: string): void { this.sealedTurns.add(turnId) }

  isSealed(turnId: string): boolean {
    return this.sealedTurns.has(turnId)
  }

  /** Reopen admission for a durable turn that is resuming a suspended execution slice. */
  reopen(turnId: string): void {
    this.sealedTurns.delete(turnId)
  }

  clear(turnId: string): void {
    this.buffers.delete(turnId)
    this.durablePending.delete(turnId)
    this.drainedAttachments.delete(turnId)
    this.sealedTurns.delete(turnId)
  }
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  return Math.max(1, Math.floor(value))
}

function steeringEntryBytes(entry: SteeringEntry): number {
  return Buffer.byteLength(entry.text, 'utf8') +
    Buffer.byteLength(entry.displayText ?? '', 'utf8') +
    (entry.attachmentIds ?? []).reduce(
      (bytes, id) => bytes + Buffer.byteLength(id, 'utf8'),
      0
    )
}

function copySteeringEntry(entry: SteeringEntry): SteeringEntry {
  return {
    ...entry,
    ...(entry.attachmentIds ? { attachmentIds: [...entry.attachmentIds] } : {})
  }
}
