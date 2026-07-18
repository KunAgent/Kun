import type { UserMessageSource } from '../contracts/items.js'

/**
 * Mid-turn steering queue. The renderer posts steering text while a
 * turn is running; the queue collects those messages and injects them
 * as user inputs at the next safe loop boundary. The queue is cleared
 * on turn completion or interruption.
 */
export type SteeringEntry = {
  text: string
  displayText?: string
  messageSource?: UserMessageSource
}

type SteeringBuffer = {
  entries: SteeringEntry[]
  bytes: number
}

/** Bound one active turn's queued user steering before the next model boundary. */
export const DEFAULT_MAX_STEERING_ENTRIES_PER_TURN = 32
export const DEFAULT_MAX_STEERING_BYTES_PER_TURN = 64 * 1024

export class SteeringQueue {
  private readonly buffers = new Map<string, SteeringBuffer>()
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
      ...(entry.messageSource ? { messageSource: entry.messageSource } : {})
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
    const out = buffer.entries.map((entry) => ({ ...entry }))
    this.buffers.delete(turnId)
    return out
  }

  /**
   * Peek at the queued text without removing it. Used by the UI to
   * show pending steering in a "pending injection" indicator.
   */
  peek(turnId: string): SteeringEntry[] {
    return (this.buffers.get(turnId)?.entries ?? []).map((entry) => ({ ...entry }))
  }

  /**
   * Atomically close an empty turn buffer before the loop commits a terminal
   * result. If an entry already won the race, leave the queue open so the loop
   * can drain it and perform another model step.
   */
  sealIfEmpty(turnId: string): boolean {
    if ((this.buffers.get(turnId)?.entries.length ?? 0) > 0) return false
    this.sealedTurns.add(turnId)
    return true
  }

  isSealed(turnId: string): boolean {
    return this.sealedTurns.has(turnId)
  }

  clear(turnId: string): void {
    this.buffers.delete(turnId)
    this.sealedTurns.delete(turnId)
  }
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  return Math.max(1, Math.floor(value))
}

function steeringEntryBytes(entry: SteeringEntry): number {
  return Buffer.byteLength(entry.text, 'utf8') + Buffer.byteLength(entry.displayText ?? '', 'utf8')
}
