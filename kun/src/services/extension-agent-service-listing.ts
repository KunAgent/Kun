import type { ThreadRecord, ThreadSummary } from '../contracts/threads.js'
import type { SessionStore } from '../ports/session-store.js'
import type {
  ExtensionAgentEvent,
  ExtensionAgentEventPage,
  ExtensionAgentRunStatus,
  ExtensionOwnedThread,
  ExtensionPrincipal
} from './extension-agent-service-contracts.js'
import {
  ExtensionBrokerError,
  iterateSessionEventsSince,
  serializedEventBytes,
  summarizeRunEvents
} from './extension-agent-service-event-usage.js'
import { encodeCursor, projectEvent, runStatus } from './extension-agent-service-projection.js'

export const DEFAULT_HISTORY_LIMIT = 100
export const MAX_HISTORY_LIMIT = 200
export const MAX_HISTORY_BYTES = 512 * 1024

type RunSummary = Awaited<ReturnType<typeof summarizeRunEvents>>
type ThreadStateFilter = ExtensionAgentRunStatus | 'queued' | 'waiting-approval' | 'waiting-user-input'

export async function listExtensionRunEvents(input: {
  sessions: SessionStore
  principal: ExtensionPrincipal
  threadId: string
  runId: string
  afterSequence?: number
  limit?: number
}): Promise<ExtensionAgentEventPage> {
  const afterSequence = input.afterSequence ?? 0
  if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
    throw new ExtensionBrokerError('validation_error', 'afterSequence must be a non-negative safe integer')
  }
  const limit = Math.floor(input.limit ?? DEFAULT_HISTORY_LIMIT)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_HISTORY_LIMIT) {
    throw new ExtensionBrokerError('validation_error', `limit must be between 1 and ${MAX_HISTORY_LIMIT}`)
  }

  const afterSeq = afterSequence - 1
  const replayFloor = await input.sessions.eventReplayFloorSeq?.(input.threadId) ?? 0
  // Durable session sequences begin at one. A replay floor of one is the
  // intact beginning of a new thread, not evidence that sequence zero was
  // pruned. Only a floor above that baseline can prove retained history moved.
  const historyIncomplete = replayFloor > 1 && afterSeq < replayFloor - 1
  const items: ExtensionAgentEvent[] = []
  let cursor = afterSequence
  let bytes = 0
  let hasMore = false
  for await (const event of iterateSessionEventsSince(input.sessions, input.threadId, afterSeq)) {
    if (event.seq + 1 <= afterSequence) continue
    if (event.turnId !== input.runId) {
      cursor = Math.max(cursor, event.seq + 1)
      continue
    }
    const projected = projectEvent(input.principal, input.runId, event)
    if (!projected) {
      cursor = Math.max(cursor, event.seq + 1)
      continue
    }
    const eventBytes = serializedEventBytes(projected)
    if (items.length >= limit || bytes + eventBytes > MAX_HISTORY_BYTES) {
      hasMore = true
      break
    }
    items.push(projected)
    bytes += eventBytes
    cursor = Math.max(cursor, event.seq + 1)
  }
  return { items, cursor, hasMore, historyIncomplete }
}

export async function pageExtensionOwnedThreads(input: {
  candidates: readonly ThreadSummary[]
  sessions: SessionStore
  offset: number
  limit: number
  state?: ThreadStateFilter
  loadThread: (threadId: string) => Promise<ThreadRecord | null>
  projectThread: (thread: ThreadRecord, latestSummary?: RunSummary) => Promise<ExtensionOwnedThread>
}): Promise<{ items: ExtensionOwnedThread[]; nextCursor?: string }> {
  if (!input.state) {
    const page = input.candidates.slice(input.offset, input.offset + input.limit)
    const threads = (await Promise.all(page.map((summary) => input.loadThread(summary.id))))
      .filter((thread): thread is ThreadRecord => Boolean(thread))
    const items = await Promise.all(threads.map((thread) => input.projectThread(thread)))
    return {
      items,
      ...(input.offset + page.length < input.candidates.length
        ? { nextCursor: encodeCursor(input.offset + page.length) }
        : {})
    }
  }

  const selected: ThreadRecord[] = []
  const summaries = new Map<string, RunSummary>()
  let matched = 0
  let hasMore = false
  for (const candidate of input.candidates) {
    const thread = await input.loadThread(candidate.id)
    if (!thread) continue
    const latestTurn = thread.turns.at(-1)
    if (!latestTurn) continue
    const summary = await summarizeRunEvents(input.sessions, thread.id, latestTurn.id)
    summaries.set(thread.id, summary)
    const status = summary.budgetExhausted
      ? 'budget-exhausted'
      : summary.waitingState ?? runStatus(latestTurn.status)
    if (status !== input.state) continue
    if (matched < input.offset) {
      matched += 1
      continue
    }
    if (selected.length >= input.limit) {
      hasMore = true
      break
    }
    selected.push(thread)
    matched += 1
  }
  const items = await Promise.all(selected.map((thread) => {
    return input.projectThread(thread, summaries.get(thread.id))
  }))
  return {
    items,
    ...(hasMore ? { nextCursor: encodeCursor(input.offset + items.length) } : {})
  }
}
