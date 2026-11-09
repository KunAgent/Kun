import { isDeepStrictEqual } from 'node:util'
import type { ThreadRecord } from '../contracts/threads.js'
import {
  NativeFollowUpRequestsSchema, type NativeFollowUpAdmission, type NativeFollowUpRequest
} from '../contracts/native-followup-requests.js'

export class NativeFollowUpRequestConflictError extends Error {
  readonly code = 'native_followup_request_conflict'
}

export function nativeFollowUpRequest(thread: ThreadRecord, requestId: string): NativeFollowUpRequest | undefined {
  return thread.nativeFollowUpRequests?.find((row) => row.admission.requestId === requestId)
}

export function assertNativeFollowUpRequest(
  row: NativeFollowUpRequest, requestFingerprint: string | undefined, admission?: NativeFollowUpAdmission
): void {
  if (row.requestFingerprint !== requestFingerprint || admission && !isDeepStrictEqual(row.admission, admission)) {
    throw new NativeFollowUpRequestConflictError('clientRequestId is already associated with a different native follow-up request')
  }
}

export function withNativeFollowUpRequest(thread: ThreadRecord, row: NativeFollowUpRequest): ThreadRecord {
  const rows = thread.nativeFollowUpRequests ?? []
  const found = rows.some((item) => item.admission.requestId === row.admission.requestId)
  return { ...thread, nativeFollowUpRequests: NativeFollowUpRequestsSchema.parse(found
    ? rows.map((item) => item.admission.requestId === row.admission.requestId ? row : item)
    : [...rows, row]) }
}

/** Store-level retention prevents history rewind/restore from erasing admission authority. */
export function retainNativeFollowUpRequests(previous: ThreadRecord | null | undefined, next: ThreadRecord): ThreadRecord {
  if (!previous?.nativeFollowUpRequests?.length && !next.nativeFollowUpRequests?.length) return next
  const rows = new Map((previous?.nativeFollowUpRequests ?? []).map((row) => [row.admission.requestId, row]))
  for (const row of next.nativeFollowUpRequests ?? []) {
    const prior = rows.get(row.admission.requestId)
    if (row.threadId !== next.id) throw new NativeFollowUpRequestConflictError('native receipt belongs to another thread')
    if (prior) {
      assertNativeFollowUpRequest(prior, row.requestFingerprint, row.admission)
      if (prior.turnId !== row.turnId || prior.userMessageItemId !== row.userMessageItemId || prior.createdAt !== row.createdAt) {
        throw new NativeFollowUpRequestConflictError('native receipt target identity cannot change')
      }
      // A snapshot or unrelated stale writer may restore an earlier admission
      // marker, but can never turn accepted work back into a retryable request.
      if (row.preparationRevision < prior.preparationRevision || prior.phase === 'admitted' && row.phase !== 'admitted') continue
      if (row.preparationRevision > prior.preparationRevision &&
        (prior.phase !== 'known_not_admitted' || row.phase !== 'preparing' || row.preparationRevision !== prior.preparationRevision + 1)) {
        throw new NativeFollowUpRequestConflictError('native preparation revision cannot skip or reopen admitted work')
      }
      if (row.preparationRevision === prior.preparationRevision && prior.phase === 'known_not_admitted') {
        if (row.phase === 'preparing') continue
        if (row.phase === 'admitted') throw new NativeFollowUpRequestConflictError('rolled-back native preparation cannot commit')
      }
      if (prior.terminalStatus && row.terminalStatus && prior.terminalStatus !== row.terminalStatus) {
        throw new NativeFollowUpRequestConflictError('native receipt terminal outcome cannot change')
      }
      if (prior.executionStartedAt && row.executionStartedAt && prior.executionStartedAt !== row.executionStartedAt) {
        throw new NativeFollowUpRequestConflictError('native execution start boundary cannot change')
      }
      rows.set(row.admission.requestId, { ...row,
        updatedAt: Date.parse(prior.updatedAt) > Date.parse(row.updatedAt) ? prior.updatedAt : row.updatedAt,
        ...(prior.executionStartedAt ? { executionStartedAt: prior.executionStartedAt } : {}),
        ...(prior.terminalStatus ? { terminalStatus: prior.terminalStatus } : {}) })
    } else rows.set(row.admission.requestId, row)
  }
  const turns = new Map(next.turns.map((turn) => [turn.id, turn]))
  for (const [key, row] of rows) {
    const turn = turns.get(row.turnId)
    if (!turn) continue
    if (turn.clientRequestId !== row.admission.requestId || turn.clientRequestFingerprint !== row.requestFingerprint) {
      throw new NativeFollowUpRequestConflictError('native receipt and turn request identities disagree')
    }
    const updatedAt = Date.parse(row.updatedAt) > Date.parse(next.updatedAt) ? row.updatedAt : next.updatedAt
    if (!turn.admissionCompletedAt || turn.admissionPending) continue
    if (row.phase === 'known_not_admitted') {
      throw new NativeFollowUpRequestConflictError('rolled-back native preparation cannot have an admitted turn')
    }
    const terminalStatus = turn.status === 'completed' ? 'completed' as const
      : turn.status === 'failed' ? 'failed' as const : turn.status === 'aborted' ? 'cancelled' as const : undefined
    const executionStartedAt = row.executionStartedAt ?? (turn.status === 'running' ? turn.startedAt : undefined)
    rows.set(key, { ...row, phase: 'admitted', updatedAt,
      ...(executionStartedAt ? { executionStartedAt } : {}),
      ...(row.terminalStatus || terminalStatus ? { terminalStatus: row.terminalStatus ?? terminalStatus } : {}) })
  }
  return { ...next, nativeFollowUpRequests: NativeFollowUpRequestsSchema.parse([...rows.values()]) }
}
