import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { RoomMessageSchema } from '../contracts/rooms.js'
import type { RoomRuntimeDeps, RoomRequestState } from '../rooms/room-runtime-types.js'
import { attachRoomRunPublication } from '../rooms/room-run-recording.js'
import { agentStableId } from './agent-identity-service.js'

/** Draft projections are visible only; only a final response may feed memory or collaborators. */
export async function publishDirectResponse(deps: RoomRuntimeDeps, request: RoomRequestState, body: string, status: 'streaming' | 'final' | 'failed') {
  if (!request.privateRunId || !body && status === 'streaming') return
  const id = agentStableId('private-message', request.privateRunId)
  const old = await deps.store.get<import('../contracts/rooms.js').RoomMessage>('message', id)
  if (!body && !old) return
  if (old?.value.status === 'final') return
  const member = request.roomSnapshot.members.find((item) => item.id === request.roomSnapshot.defaultMemberId)!
  const references: import('../contracts/room-content.js').RoomContentReference[] = []
  if (status === 'final' && request.privateWorkspace && !request.roomSnapshot.privateWorkspace) {
    const run = await deps.store.get<import('../contracts/room-runs.js').RoomRunRecord>('room_run', request.privateRunId)
    const files = await readdir(request.privateWorkspace, { withFileTypes: true }).catch(() => [])
    for (const file of files.filter((file) => file.isFile() && !file.name.startsWith('.')).slice(0, 100)) {
      const info = await stat(join(request.privateWorkspace, file.name)).catch(() => null)
      if (info && info.mtimeMs >= Date.parse(run?.value.startedAt ?? run?.value.createdAt ?? '') - 1000) references.push({ kind: 'agent_file',
        workspaceId: agentStableId('private-workspace', request.roomId, request.privateWorkspace), relativePath: file.name, titleSnapshot: file.name })
      if (references.length >= 8) break
    }
  }
  const source = await deps.store.get<import('../contracts/rooms.js').RoomMessage>('message', request.sourceMessageId)
  const message = RoomMessageSchema.parse({ ...old?.value, id, roomId: request.roomId, body: body || old?.value.body || '',
    ...(source?.value.replyToMessageId ? { displayThreadRootId: source.value.displayThreadRootId } : {}),
    status, sourceRequestId: request.id, rootRequestId: request.rootRequestId,
    authorKind: 'member', authorMemberId: member.id, authorAgentId: member.participantAgentId,
    authorLabelSnapshot: member.displayName, messageSeq: old?.seq ?? 1, bodyRevision: old ? old.value.bodyRevision + 1 : 0,
    mentionMemberIds: [], attachmentIds: [], references: references.length ? references : undefined, createdAt: old?.value.createdAt ?? new Date().toISOString() })
  if (old?.value.body === message.body && old.value.status === status) return
  const current = await deps.store.get<RoomRequestState>('request', request.id)
  if (!current || current.value.cancellationRequested && status !== 'failed') return
  const commit: import('../rooms/room-store.js').RoomStoreCommit = { requestId: agentStableId('private-publish', id, status, String(message.bodyRevision), message.body),
    checks: [{ kind: 'request', id: request.id, expectedRevision: current.revision }, { kind: 'message', id, expectedRevision: old?.revision ?? null }],
    puts: [{ kind: 'message', id, roomId: request.roomId, value: message }],
    events: [{ roomId: request.roomId, kind: old ? 'message.updated' : 'message.created', payload: { id } }] }
  await attachRoomRunPublication(deps.store, commit, message, request.privateRunId)
  await deps.store.commit(commit)
}
