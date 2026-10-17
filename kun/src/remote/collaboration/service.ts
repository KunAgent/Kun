import { CollaborationListParams } from './contracts.js'
export { CollaborationListParams } from './contracts.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { roomRunList } from '../../rooms/room-run-query.js'
import type { RoomTaskExecution } from '../../rooms/room-runtime-types.js'
import { requireRemoteScope, type RemoteAuthority } from '../authorization/scopes.js'
import { RemoteGroups } from '../groups/service.js'
export class RemoteCollaboration {
  private groups: RemoteGroups
  constructor(private runtime: ServerRuntime) { this.groups = new RemoteGroups(runtime) }
  async runs(scope: RemoteAuthority, raw: unknown) {
    requireRemoteScope(scope, 'collaboration.read')
    const p = CollaborationListParams.parse(raw)
    await this.groups.requireGroup(scope, p.roomId)
    const page = await roomRunList(this.runtime.rooms!.deps, p.roomId, { limit: p.limit,
      beforeSeq: p.cursor === undefined ? undefined : Number(p.cursor) })
    return { runs: page.runs.map((r) => ({ id: r.id, roomId: r.roomId, memberId: r.memberId, taskId: r.taskId,
      phase: r.phase, status: r.status, startedAt: r.startedAt, endedAt: r.endedAt, elapsedMs: r.elapsedMs,
      threadId: r.threadId, turnId: r.turnId })), nextCursor: page.nextCursor, hasMore: Boolean(page.nextCursor) }
  }
  async tasks(scope: RemoteAuthority, raw: unknown) {
    requireRemoteScope(scope, 'collaboration.read')
    const p = CollaborationListParams.parse(raw)
    await this.groups.requireGroup(scope, p.roomId)
    const rows = await this.runtime.rooms!.deps.store.list<RoomTaskExecution>('task', { roomId: p.roomId,
      beforeSeq: p.cursor === undefined ? undefined : Number(p.cursor), limit: p.limit + 1 })
    const tasks = rows.slice(0, p.limit).map((r) => ({ id: r.value.task.id, roomId: p.roomId,
      revision: r.revision, title: r.value.task.title, status: r.value.task.status,
      ownerMemberId: r.value.task.ownerMemberId, updatedAt: r.value.task.updatedAt }))
    const hasMore = rows.length > p.limit
    return { tasks, hasMore, nextCursor: hasMore ? String(rows[p.limit - 1].seq) : undefined }
  }
}
