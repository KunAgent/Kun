import { appendPeerRunOutcome } from './room-peer-run-recording.js'
import type { RoomRuntimeDeps } from './room-runtime-types.js'
import type { RoomPeerMemberState, RoomPeerTopic } from './room-peer-types.js'
import type { RoomStoreCommit, RoomStoredDocument } from './room-store.js'
import { RoomPeerStore, retryPeerConflict } from './room-peer-state.js'
import { peerId } from './room-peer-inbox.js'

export async function setPeerMemberWait(deps: RoomRuntimeDeps, member: RoomStoredDocument<RoomPeerMemberState>,
  waitingReason?: string): Promise<void> {
  await retryPeerConflict(async () => {
    const current = await deps.store.get<RoomPeerMemberState>('peer_member', member.id)
    if (!current || current.value.activation || current.value.generation !== member.value.generation ||
      current.value.waitingReason === waitingReason) return
    await deps.store.commit({ requestId: peerId('member-wait', current.id, current.revision, waitingReason),
      checks: [{ kind: 'peer_member', id: current.id, expectedRevision: current.revision }],
      puts: [{ kind: 'peer_member', id: current.id, roomId: current.roomId, value: {
        ...current.value, waitingReason, updatedAt: new Date().toISOString()
      } }], events: [{ roomId: current.value.roomId, kind: 'peer.member.updated',
        payload: { rootRequestId: current.value.rootRequestId, memberId: current.value.memberId } }] })
  })
}

/** Failure before admission has no unknown executor, but must not retry on every scheduler tick. */
export async function failPeerPreparation(deps: RoomRuntimeDeps, member: RoomStoredDocument<RoomPeerMemberState>,
  error: string): Promise<void> {
  await retryPeerConflict(async () => {
    const current = await deps.store.get<RoomPeerMemberState>('peer_member', member.id)
    if (!current || current.value.activation || current.value.generation !== member.value.generation) return
    const failures = (current.value.retryCount ?? 0) + 1
    await deps.store.commit({ requestId: peerId('preparation-failed', current.id, current.revision),
      checks: [{ kind: 'peer_member', id: current.id, expectedRevision: current.revision }],
      puts: [{ kind: 'peer_member', id: current.id, roomId: current.roomId, value: {
        ...current.value, state: 'failed', waitingReason: 'preparation_failed', lastError: error.slice(0, 4000),
        retryCount: failures, retryAt: failures <= 2 ? new Date(Date.now() + failures * 15_000).toISOString() : undefined,
        updatedAt: new Date().toISOString()
      } }], events: [{ roomId: current.value.roomId, kind: 'peer.member.updated',
        payload: { rootRequestId: current.value.rootRequestId, memberId: current.value.memberId } }] })
  })
}

/** Release a proven-finished activation without consuming its unhandled deliveries. */
export async function releasePeerActivation(deps: RoomRuntimeDeps, member: RoomStoredDocument<RoomPeerMemberState>,
  input: { error?: string; retry?: boolean; resetFailures?: boolean } = {}): Promise<void> {
  const activation = member.value.activation
  if (!activation) return
  await retryPeerConflict(async () => {
    const current = await deps.store.get<RoomPeerMemberState>('peer_member', member.id)
    if (current?.value.activation?.clientRequestId !== activation.clientRequestId) return
    const failures = input.error ? (current.value.retryCount ?? 0) + 1 : input.resetFailures ? 0 : current.value.retryCount ?? 0
    const commit: RoomStoreCommit = { requestId: peerId('release', activation.clientRequestId, current.revision),
      checks: [{ kind: 'peer_member', id: current.id, expectedRevision: current.revision }],
      puts: [{ kind: 'peer_member', id: current.id, roomId: current.roomId, value: {
        ...current.value, activation: undefined, state: input.error ? 'failed' : 'pending',
        lastError: input.error?.slice(0, 4000), retryCount: failures, waitingReason: input.error ? 'response_failed' : undefined,
        retryAt: input.error && input.retry && failures <= 2 ? new Date(Date.now() + failures * 15_000).toISOString() : undefined,
        updatedAt: new Date().toISOString()
      } }], events: [{ roomId: member.value.roomId, kind: 'peer.member.updated',
        payload: { rootRequestId: member.value.rootRequestId, memberId: member.value.memberId } }] }
    await appendPeerRunOutcome(deps.store, commit, current.value, input.error ? { status: 'failed', outcome: 'failed', error: input.error.slice(0, 4000) } : {})
    await deps.store.commit(commit)
  })
}

export async function updatePeerTopicStatus(peer: RoomPeerStore, rootId: string,
  status: RoomPeerTopic['status'], pauseReason?: string): Promise<void> {
  await retryPeerConflict(async () => {
    const row = await peer.topic(rootId)
    if (!row || row.value.status === status && row.value.pauseReason === pauseReason) return
    // An observation may settle a stop, but it cannot reopen a stopped topic.
    if (['stopping', 'stopped'].includes(row.value.status) && status !== 'stopped') return
    await peer.store.commit({ requestId: peerId('topic-state', rootId, row.revision, status, pauseReason),
      checks: [{ kind: 'peer_topic', id: row.id, expectedRevision: row.revision }],
      puts: [{ kind: 'peer_topic', id: row.id, roomId: row.roomId, value: {
        ...row.value, status, pauseReason, updatedAt: new Date().toISOString()
      } }], events: [{ roomId: row.value.roomId, kind: 'peer.topic.updated', payload: { rootRequestId: rootId } }] })
  })
}

export async function recordPeerMetric(deps: RoomRuntimeDeps, input: {
  id: string; roomId: string; rootRequestId: string; memberId: string;
  phase: string; outcome: string; model?: string; elapsedMs?: number; usage?: unknown; firstResponseMs?: number
  generation?: number
  threadId?: string; turnId?: string; usageStatus?: string; holds?: number
}): Promise<void> {
  const id = peerId('metric', input.id, input.phase, input.outcome)
  if (await deps.store.get('peer_metric', id)) return
  await deps.store.commit({ requestId: id,
    checks: [{ kind: 'peer_metric', id, expectedRevision: null }],
    puts: [{ kind: 'peer_metric', id, roomId: input.roomId, value: { ...input, createdAt: new Date().toISOString() } }],
    events: [{ roomId: input.roomId, kind: 'peer.metric', payload: {
      rootRequestId: input.rootRequestId, memberId: input.memberId, phase: input.phase, outcome: input.outcome
    } }] })
}
