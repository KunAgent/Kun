/**
 * Authoritative per-turn terminal outcomes recorded from SSE terminal events.
 *
 * The Canvas must not derive critical continuation control from the sidebar
 * thread projection: when `currentTurnId` clears before the projection settles
 * (missing thread, stale `latestTurnId`, unsynced status), the projection can
 * only answer `unknown`. Terminal events carry the authoritative `turnId` and
 * status, so they are recorded here first and Canvas outcome resolution reads
 * this registry before falling back to the projection.
 */

export type CanvasTurnTerminalStatus = 'completed' | 'aborted' | 'failed'

export type CanvasTurnTerminalRecord = {
  outcome: CanvasTurnTerminalStatus
  threadId?: string
  at: number
}

/** Bound long-session memory: only the most recent terminals matter. */
const MAX_TERMINAL_RECORDS = 200

const terminalOutcomes = new Map<string, CanvasTurnTerminalRecord>()

type CanvasTurnTerminalListener = (turnId: string, record: CanvasTurnTerminalRecord) => void
const terminalListeners = new Set<CanvasTurnTerminalListener>()

/** Observe terminal outcomes as they are recorded; returns the unsubscribe. */
export function subscribeCanvasTurnTerminal(listener: CanvasTurnTerminalListener): () => void {
  terminalListeners.add(listener)
  return () => {
    terminalListeners.delete(listener)
  }
}

export function recordCanvasTurnTerminal(
  turnId: string | null | undefined,
  outcome: CanvasTurnTerminalStatus,
  threadId?: string
): void {
  const normalized = turnId?.trim()
  if (!normalized) return
  // Refresh insertion order so eviction is FIFO over recent records.
  terminalOutcomes.delete(normalized)
  const record: CanvasTurnTerminalRecord = {
    outcome,
    ...(threadId ? { threadId } : {}),
    at: Date.now()
  }
  terminalOutcomes.set(normalized, record)
  for (const listener of terminalListeners) listener(normalized, record)
  while (terminalOutcomes.size > MAX_TERMINAL_RECORDS) {
    const oldest = terminalOutcomes.keys().next().value
    if (!oldest) break
    terminalOutcomes.delete(oldest)
  }
}

export function canvasTerminalOutcomeFor(
  turnId: string | null | undefined
): CanvasTurnTerminalRecord | undefined {
  const normalized = turnId?.trim()
  return normalized ? terminalOutcomes.get(normalized) : undefined
}

/** Test hook: clear all recorded terminal outcomes. */
export function clearCanvasTurnTerminalRegistry(): void {
  terminalOutcomes.clear()
}
