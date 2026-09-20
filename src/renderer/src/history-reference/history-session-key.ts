import type { HistorySession } from './history-reference-api'

/** A database path can own many sessions; path alone is not a selection identity. */
export function historySessionKey(session: HistorySession): string {
  return session.sourceKind ? JSON.stringify([session.path, session.sessionId, session.sourceKind]) : session.path
}
export function historySessionSource(key: string): { path: string; sessionId?: string; sourceKind?: HistorySession['sourceKind'] } {
  if (!key.startsWith('[')) return { path: key }
  const [path, sessionId, sourceKind] = JSON.parse(key)
  return { path, sessionId, sourceKind }
}
