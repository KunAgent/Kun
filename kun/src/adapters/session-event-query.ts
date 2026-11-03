import type { RuntimeEvent } from '../contracts/events.js'
import type { SessionStore } from '../ports/session-store.js'

/** The event reads a lookup needs; any SessionStore satisfies it. */
export type SessionEventSource = Pick<SessionStore, 'loadEventsSince'> &
  Partial<Pick<SessionStore, 'iterateEventsSince'>>

/**
 * Stream-aware event lookups. Prefer `iterateEventsSince` so callers never
 * materialize a whole events.jsonl just to answer a boolean or find one row.
 */
export async function findSessionEvent(
  store: SessionEventSource,
  threadId: string,
  match: (event: RuntimeEvent) => boolean,
  sinceSeq = 0
): Promise<RuntimeEvent | null> {
  if (store.iterateEventsSince) {
    for await (const event of store.iterateEventsSince(threadId, sinceSeq)) {
      if (match(event)) return event
    }
    return null
  }
  return (await store.loadEventsSince(threadId, sinceSeq)).find(match) ?? null
}

export async function sessionEventExists(
  store: SessionStore,
  threadId: string,
  match: (event: RuntimeEvent) => boolean,
  sinceSeq = 0
): Promise<boolean> {
  return (await findSessionEvent(store, threadId, match, sinceSeq)) !== null
}

export async function collectSessionEvents(
  store: SessionStore,
  threadId: string,
  match: (event: RuntimeEvent) => boolean,
  sinceSeq = 0
): Promise<RuntimeEvent[]> {
  const matched: RuntimeEvent[] = []
  if (store.iterateEventsSince) {
    for await (const event of store.iterateEventsSince(threadId, sinceSeq)) {
      if (match(event)) matched.push(event)
    }
    return matched
  }
  return (await store.loadEventsSince(threadId, sinceSeq)).filter(match)
}

export async function collectSessionEventsOfKind<Kind extends RuntimeEvent['kind']>(
  store: SessionStore,
  threadId: string,
  kind: Kind,
  sinceSeq = 0
): Promise<Array<Extract<RuntimeEvent, { kind: Kind }>>> {
  const matched: Array<Extract<RuntimeEvent, { kind: Kind }>> = []
  if (store.iterateEventsSince) {
    for await (const event of store.iterateEventsSince(threadId, sinceSeq)) {
      if (event.kind === kind) matched.push(event as Extract<RuntimeEvent, { kind: Kind }>)
    }
    return matched
  }
  for (const event of await store.loadEventsSince(threadId, sinceSeq)) {
    if (event.kind === kind) matched.push(event as Extract<RuntimeEvent, { kind: Kind }>)
  }
  return matched
}

export async function findLatestUsageEvent(
  store: SessionStore,
  threadId: string
): Promise<Extract<RuntimeEvent, { kind: 'usage' }> | null> {
  let latest: Extract<RuntimeEvent, { kind: 'usage' }> | null = null
  if (store.iterateEventsSince) {
    for await (const event of store.iterateEventsSince(threadId, 0)) {
      if (event.kind !== 'usage') continue
      if (!latest || event.seq > latest.seq) latest = event
    }
    return latest
  }
  for (const event of await store.loadEventsSince(threadId, 0)) {
    if (event.kind !== 'usage') continue
    if (!latest || event.seq > latest.seq) latest = event
  }
  return latest
}

/** Codes the loop records (as warnings) when a turn stops at a hard budget. */
const TURN_LIMIT_CODES: ReadonlySet<string> = new Set([
  'turn_step_limit',
  'turn_wall_time_limit',
  'tool_call_limit_exceeded',
  'extension_budget_exhausted'
])

/**
 * The step/time/tool budget a failed turn stopped at, if any. The loop logs
 * these as warning-severity errors, so fatal-error scans never see them and a
 * child that hit its step cap would otherwise report only its last sentence.
 */
export async function findTurnLimitStop(
  store: SessionEventSource,
  threadId: string,
  turnId: string
): Promise<{ code: string; message: string } | null> {
  const event = await findSessionEvent(store, threadId, (entry) =>
    entry.kind === 'error' && entry.turnId === turnId && TURN_LIMIT_CODES.has(entry.code ?? ''))
  return event?.kind === 'error' && event.code ? { code: event.code, message: event.message } : null
}

/** Why a turn failed: its budget stop, else its first fatal error or turn_failed message. */
export async function findTurnFailureCause(
  store: SessionEventSource,
  threadId: string,
  turnId: string
): Promise<string | null> {
  const event = await findSessionEvent(store, threadId, (entry) =>
    (entry.kind === 'error' || entry.kind === 'turn_failed') &&
    entry.turnId === turnId &&
    Boolean(entry.message?.trim()) &&
    (TURN_LIMIT_CODES.has(entry.code ?? '') || (entry.severity !== 'warning' && entry.severity !== 'info')))
  return event?.kind === 'error' || event?.kind === 'turn_failed' ? event.message?.trim() || null : null
}
