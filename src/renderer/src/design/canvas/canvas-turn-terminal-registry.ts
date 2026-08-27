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

export function recordCanvasTurnTerminal(
  turnId: string | null | undefined,
  outcome: CanvasTurnTerminalStatus,
  threadId?: string
): void {
  const normalized = turnId?.trim()
  if (!normalized) return
  // Refresh insertion order so eviction is FIFO over recent records.
  terminalOutcomes.delete(normalized)
  terminalOutcomes.set(normalized, {
    outcome,
    ...(threadId ? { threadId } : {}),
    at: Date.now()
  })
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
