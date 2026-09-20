import type { RoomMessage } from '../contracts/rooms.js'
import type { RoomStore, RoomStoreCommit, RoomStoredDocument } from './room-store.js'
import { RoomStoreConflictError } from './room-store.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'

export const MAX_ROOM_REPLY_DEPTH = 64
export type RoomReplyContext = {
  replyToMessageId?: string
  displayThreadRootId?: string
  rootRequestId?: string
  checks: NonNullable<RoomStoreCommit['checks']>
}

/** Display ancestry never changes topic authorization, admission or discussion budgets. */
export async function prepareRoomReplyContext(store: RoomStore, roomId: string,
  replyToMessageId?: string): Promise<RoomReplyContext> {
  if (!replyToMessageId) return { checks: [] }
  const visited = new Set<string>()
  const checks: RoomReplyContext['checks'] = []
  let next = replyToMessageId
  let target: RoomStoredDocument<RoomMessage> | null = null
  for (let depth = 0; depth <= MAX_ROOM_REPLY_DEPTH; depth += 1) {
    if (visited.has(next)) throw new RoomStoreConflictError('Reply chain contains a cycle')
    visited.add(next)
    const row = await store.get<RoomMessage>('message', next)
    if (!row || row.roomId !== roomId) throw new RoomStoreConflictError('Reply message is unavailable in this room')
    target ??= row
    checks.push({ kind: 'message', id: row.id, expectedRevision: row.revision })
    if (!row.value.replyToMessageId) {
      if (row.value.displayThreadRootId && row.value.displayThreadRootId !== row.id)
        throw new RoomStoreConflictError('Reply root does not match its saved display thread')
      return { replyToMessageId, displayThreadRootId: row.id,
        rootRequestId: target.value.rootRequestId, checks }
    }
    // New records carry the host-proven root. Follow it directly so legitimate
    // nested replies do not accumulate a traversal cost as the conversation grows.
    if (row.value.displayThreadRootId) {
      if (row.value.displayThreadRootId === row.id) throw new RoomStoreConflictError('Reply chain contains a cycle')
      next = row.value.displayThreadRootId
    } else next = row.value.replyToMessageId
  }
  throw new RoomStoreConflictError('Reply chain exceeds the supported history depth')
}

export function appendRoomReplyChecks(commit: RoomStoreCommit, checks: RoomReplyContext['checks']): void {
  commit.checks ??= []
  for (const check of checks) {
    const existing = commit.checks.find((value) => value.kind === check.kind && value.id === check.id)
    if (existing && existing.expectedRevision !== check.expectedRevision)
      throw new RoomStoreConflictError('Reply source changed concurrently')
    if (!existing) commit.checks.push(check)
  }
}

/** Only explicitly delivered message sources can prove a default display branch. */
export async function uniqueRoomReplyTrigger(store: RoomStore, roomId: string,
  messageIds: string[]): Promise<RoomReplyContext> {
  const candidates: RoomReplyContext[] = []
  for (const id of [...new Set(messageIds)]) {
    try { candidates.push(await prepareRoomReplyContext(store, roomId, id)) }
    catch (error) { if (error instanceof RoomStoreConflictError) return { checks: [] }; throw error }
  }
  if (!candidates.length || new Set(candidates.map((value) => value.displayThreadRootId)).size !== 1)
    return { checks: [] }
  const chosen = candidates.at(-1)!
  const merged: RoomStoreCommit = { requestId: 'reply-checks' }
  for (const candidate of candidates) appendRoomReplyChecks(merged, candidate.checks)
  return { ...chosen, checks: merged.checks! }
}

/** Legacy coordination/execution has one saved triggering request; notices have no run. */
export async function attachRoomPublicationReply(store: RoomStore, commit: RoomStoreCommit,
  message: RoomMessage, originRunId?: string): Promise<void> {
  if (originRunId && (await store.get<import('../contracts/room-runs.js').RoomRunRecord>('room_run', originRunId))?.value.phase === 'conversation') return
  if (!originRunId || message.replyToMessageId || message.displayThreadRootId) return
  const run = await store.get<RoomRunRecord>('room_run', originRunId)
  if (!run || run.roomId !== message.roomId || !run.value.triggerMessageId) return
  const reply = await uniqueRoomReplyTrigger(store, message.roomId, [run.value.triggerMessageId])
  if (!reply.displayThreadRootId) return
  message.replyToMessageId = reply.replyToMessageId
  message.displayThreadRootId = reply.displayThreadRootId
  appendRoomReplyChecks(commit, reply.checks)
}
