import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { RoomRuntimeDeps, RoomRequestState } from '../rooms/room-runtime-types.js'
import type { RoomRunTextSegment } from '../rooms/room-run-segments.js'
import type { RoomService } from '../rooms/room-service.js'
import { agentStableId } from './agent-identity-service.js'

/** Draft projections are visible only; only a final response may feed memory or collaborators. */
export async function publishDirectResponse(deps: RoomRuntimeDeps, service: RoomService, request: RoomRequestState,
  segments: RoomRunTextSegment[], status: 'streaming' | 'final' | 'failed') {
  if (!request.privateRunId || (!segments.length && status === 'streaming')) return
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
  const displayThreadRootId = source?.value.replyToMessageId ? source.value.displayThreadRootId : undefined
  const current = await deps.store.get<RoomRequestState>('request', request.id)
  if (!current || current.value.cancellationRequested && status !== 'failed') return
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!
    await service.publishSegment(request.roomId, {
      messageId: segment.messageId, runId: request.privateRunId, itemId: segment.itemId, body: segment.text,
      memberId: member.id, createdAt: segment.createdAt, status,
      references: status === 'final' && index === segments.length - 1 && references.length ? references : undefined,
      displayThreadRootId
    })
  }
}
