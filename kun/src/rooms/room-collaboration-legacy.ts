import { isDeepStrictEqual } from 'node:util'
import type { DatabaseSync } from 'node:sqlite'
import { AgentCommitmentSchema } from '../contracts/agent-commitments.js'
import { CommitmentAttentionSchema } from '../contracts/collaboration-attention.js'
import { CommitmentControlSchema, CommitmentLinkSchema } from '../contracts/collaboration-followup.js'
import { RoomStoreConflictError, type RoomStoreCommit } from './room-store.js'
type RoomStorePut = NonNullable<RoomStoreCommit['puts']>[number]
export type FollowUpNativeStart = { threadId: string; taskId: string; roomId: unknown; participantAgentId: unknown }

const read = (db: DatabaseSync, kind: string, id: string) => {
  const row = db.prepare('SELECT document,revision FROM room_documents WHERE kind=? AND id=?').get(kind, id)
  return row ? { value: JSON.parse(String(row.document)) as Record<string, unknown>, revision: Number(row.revision) } : null
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}

function ownedExecution(db: DatabaseSync, threadId: string, taskId: string) {
  const rows = db.prepare(`SELECT l.document FROM room_documents l LEFT JOIN room_documents t
    ON t.kind='task' AND t.id=json_extract(l.document,'$.target.taskId')
    WHERE l.kind='commitment_link' AND json_extract(l.document,'$.active')=1
    AND json_extract(l.document,'$.ownership')='owned'
    AND ((?<>'' AND json_extract(l.document,'$.target.threadId')=?) OR
      (?<>'' AND json_extract(l.document,'$.target.kind')='room_task' AND json_extract(l.document,'$.target.taskId')=?) OR
      (?<>'' AND json_extract(t.document,'$.task.executionThreadId')=?)) LIMIT 2`)
    .all(threadId, threadId, taskId, taskId, threadId, threadId)
  if (rows.length > 1) throw new RoomStoreConflictError('execution thread already has more than one active owner')
  return rows[0] ? CommitmentLinkSchema.parse(JSON.parse(String(rows[0].document))) : null
}

/** Runs under the Manager's SQLite write transaction, including writes from an older native API. */
function validateNativeStart(db: DatabaseSync, put: RoomStorePut): FollowUpNativeStart | null {
  if (put.kind !== 'workbench_link' && put.kind !== 'task') return null
  const old = read(db, put.kind, put.id)?.value, next = object(put.value)
  const before = put.kind === 'task' ? object(old?.task) : old ?? {}
  const after = put.kind === 'task' ? object(next.task) : next
  const key = put.kind === 'task' ? 'executionThreadId' : 'threadId'
  const previousThread = typeof before[key] === 'string' ? before[key] : ''
  const threadId = typeof after[key] === 'string' ? after[key] : ''
  const rebound = Boolean(previousThread && previousThread !== threadId)
  const starts = ['queued', 'running'].includes(String(after.status)) && before.status !== after.status ||
    put.kind === 'workbench_link' && after.admissionAttempted === true && before.admissionAttempted !== true ||
    put.kind === 'task' && next.attempt !== old?.attempt
  if (!starts && !rebound) return null
  const taskId = put.kind === 'task' ? put.id : ''
  if (rebound && ownedExecution(db, previousThread, taskId)) {
    throw new RoomStoreConflictError('release the owned commitment target before replacing its execution thread')
  }
  const target = { threadId, taskId, roomId: after.roomId,
    participantAgentId: put.kind === 'task' ? object(after.memberSnapshot).participantAgentId : after.participantAgentId }
  validateOwnedStart(db, target)
  return target
}

function validateOwnedStart(db: DatabaseSync, target: FollowUpNativeStart): void {
  const owner = ownedExecution(db, target.threadId, target.taskId)
  if (!owner) return
  const controlRow = read(db, 'commitment_control', owner.commitmentId)
  const commitmentRow = read(db, 'agent_commitment', owner.commitmentId)
  const control = controlRow && CommitmentControlSchema.parse(controlRow.value)
  const commitment = commitmentRow && AgentCommitmentSchema.parse(commitmentRow.value)
  if (target.roomId !== owner.sourceRoomId || target.participantAgentId !== owner.participantAgentId ||
    !control || !commitment || control.sourceRoomId !== owner.sourceRoomId ||
    control.participantAgentId !== owner.participantAgentId || commitment.sourceRoomId !== owner.sourceRoomId ||
    commitment.participantAgentId !== owner.participantAgentId || owner.stopRequestedAt ||
    control.stoppedAt || control.paused || !control.trackingEnabled || ['completed', 'cancelled'].includes(commitment.status)) {
    throw new RoomStoreConflictError('owned commitment tracking prevents this legacy start; use the current follow-up controls', controlRow?.revision)
  }
}

/**
 * A tracked completion must carry, in the same transaction, the transition of an
 * open acceptance item for this commitment into a user-resolved answer. Re-reading
 * the external head happens in the attention service; the store proves here that
 * this is a real transition rather than a freshly written "resolved" row.
 */
function versionedAcceptance(db: DatabaseSync, input: RoomStoreCommit,
  commitment: ReturnType<typeof AgentCommitmentSchema.parse>): boolean {
  return (input.puts ?? []).some((row) => {
    if (row.kind !== 'commitment_attention') return false
    const beforeRow = read(db, 'commitment_attention', row.id)
    if (!beforeRow) return false
    const before = CommitmentAttentionSchema.safeParse(beforeRow.value)
    const after = CommitmentAttentionSchema.safeParse(row.value)
    if (!before.success || !after.success) return false
    const prior = before.data, next = after.data
    return prior.kind === 'acceptance' && prior.status === 'open' && prior.commitmentId === commitment.id &&
      next.kind === 'acceptance' && next.status === 'resolved' && Boolean(next.resolution) &&
      next.commitmentId === commitment.id && next.participantAgentId === commitment.participantAgentId &&
      next.sourceRoomId === commitment.sourceRoomId &&
      isDeepStrictEqual(prior.artifactVersion, next.artifactVersion) &&
      (next.resolution!.surface === 'gui' || next.resolution!.surface === 'remote')
  })
}

function validateCommitmentChange(db: DatabaseSync, input: RoomStoreCommit, put: RoomStorePut): void {
  if (put.kind !== 'agent_commitment') return
  const beforeRow = read(db, put.kind, put.id), controlRow = read(db, 'commitment_control', put.id)
  if (!beforeRow || !controlRow) return
  const before = AgentCommitmentSchema.parse(beforeRow.value), after = AgentCommitmentSchema.parse(put.value)
  const control = CommitmentControlSchema.parse(controlRow.value)
  const fail = (message: string): never => { throw new RoomStoreConflictError(message, beforeRow.revision) }
  const controlCheck = input.checks?.find((check) => check.kind === 'commitment_control' && check.id === put.id)
  if (controlCheck?.expectedRevision !== controlRow.revision) fail('tracked commitment write requires the current control revision')
  if (before.sourceRoomId !== after.sourceRoomId || before.participantAgentId !== after.participantAgentId) {
    fail('tracked commitment scope cannot change')
  }
  const scopeChanged = ['objective', 'acceptance', 'deadline', 'links'].some((field) =>
    !isDeepStrictEqual(before[field as keyof typeof before], after[field as keyof typeof after]))
  const completionChanged = after.status === 'completed' && (before.status !== 'completed' || scopeChanged ||
    !isDeepStrictEqual(before.results, after.results) || !isDeepStrictEqual(before.acceptanceEvidence, after.acceptanceEvidence))
  if (completionChanged && !versionedAcceptance(db, input, before)) {
    fail('tracked completion requires current versioned acceptance')
  }
  const reopening = ['completed', 'cancelled'].includes(before.status) && after.status !== before.status
  const stopping = after.status === 'cancelled' && !control.stoppedAt
  if (!scopeChanged && !reopening && !stopping) return
  const replacement = input.puts?.find((row) => row.kind === 'commitment_control' && row.id === put.id)
  if (!replacement) fail('tracked authorization change must update control atomically')
  const next = CommitmentControlSchema.parse(replacement!.value)
  if (next.generation <= control.generation || next.authorizationEpoch <= control.authorizationEpoch) {
    fail('tracked authorization changes require a new generation and epoch')
  }
  if (stopping && (!next.stoppedAt || next.trackingEnabled || !next.paused)) fail('tracked cancellation requires persistent stop intent')
  if (scopeChanged && !next.paused) fail('changed commitment scope must pause pending fresh authorization')
  if (reopening && (next.stoppedAt || !next.trackingEnabled)) fail('reopen must explicitly authorize tracking')
}

export function validateFollowUpLegacyWrites(db: DatabaseSync, input: RoomStoreCommit): FollowUpNativeStart[] {
  const starts: FollowUpNativeStart[] = []
  for (const put of input.puts ?? []) {
    validateCommitmentChange(db, input, put)
    const start = validateNativeStart(db, put)
    if (start) starts.push(start)
  }
  return starts
}

/** Recheck the destination against all final control/link writes, not an order-dependent preimage. */
export function validateFollowUpNativeStarts(db: DatabaseSync, starts: FollowUpNativeStart[]): void {
  for (const start of starts) validateOwnedStart(db, start)
}
