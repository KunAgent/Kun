import { ScheduleListParams, ScheduleRunsParams } from './contracts.js'
export { ScheduleListParams, ScheduleRunsParams } from './contracts.js'
import type { WorkbenchLink } from '../../contracts/workbench-links.js'
import type { Room } from '../../contracts/rooms.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { cursorScope, readCursor, writeCursor } from '../cursor-codec.js'
import { requireRemoteScope, hasRemoteScope, type RemoteAuthority } from '../authorization/scopes.js'
function scheduleSummary(link: WorkbenchLink, revision: number) {
  return { id: link.id, roomId: link.roomId, agentId: link.participantAgentId, title: link.request.title,
    revision, status: link.status, surface: link.surface, schedule: link.request.schedule,
    scheduledFor: link.scheduledFor, runCount: link.runCount ?? 0, createdAt: link.createdAt, updatedAt: link.updatedAt }
}
function runSummary(link: WorkbenchLink, revision: number) {
  return { id: link.id, scheduleId: link.seriesId ?? link.id, roomId: link.roomId, revision,
    title: link.request.title, status: link.status, occurrence: link.occurrence,
    threadId: link.threadId, turnId: link.turnId, createdAt: link.createdAt, finishedAt: link.finishedAt,
    result: link.result ? { summary: link.result.summary, finalExcerpt: link.result.finalExcerpt, finishedAt: link.result.finishedAt } : undefined }
}
/** Views only the existing runtime workbench ledger; it never starts or repairs a schedule. */
export class RemoteSchedules {
  constructor(private runtime: ServerRuntime) {}
  private async visible(scope: RemoteAuthority, roomId: string) {
    const row = await this.runtime.rooms!.deps.store.get<Room>('room', roomId)
    if (!row || row.value.deletedAt) return false
    return row.value.conversationKind === 'user_agent' ||
      (!row.value.conversationKind || row.value.conversationKind === 'group') && hasRemoteScope(scope, 'groups.read')
  }
  private async scan(scope: RemoteAuthority, cursor: string | undefined, limit: number, scheduleId?: string) {
    const token = cursorScope([scope.accountId, scope.deviceId, scope.authorizationId, [...(scope.scopes ?? [])].sort(), scheduleId ?? null])
    const position = readCursor<{ beforeSeq?: number }>(cursor, token, {})
    if (position.beforeSeq !== undefined && (!Number.isSafeInteger(position.beforeSeq) || position.beforeSeq < 0)) throw new Error('INVALID_CURSOR')
    const store = this.runtime.rooms!.deps.store
    const items = [], deadline = Date.now() + 1000
    let beforeSeq = position.beforeSeq, hasMore = false, scanned = 0, bytes = 0
    outer: while (scanned < 1000 && Date.now() < deadline) {
      const rows = await store.list<WorkbenchLink>('workbench_link', { beforeSeq, limit: 100 })
      if (!rows.length) { hasMore = false; break }
      for (const row of rows) {
        const previous = beforeSeq
        if (previous !== undefined && row.seq >= previous) throw new Error('SCHEDULE_HISTORY_UNAVAILABLE')
        const link = row.value
        const eligible = scheduleId ? link.seriesId === scheduleId || link.id === scheduleId &&
          (Boolean(link.threadId) || ['completed', 'failed', 'cancelled', 'missed'].includes(link.status))
          : link.kind === 'schedule_series' || Boolean(link.request.schedule)
        let item
        if (eligible && await this.visible(scope, link.roomId)) item = scheduleId ? runSummary(link, row.revision) : scheduleSummary(link, row.revision)
        const size = item ? Buffer.byteLength(JSON.stringify(item)) : 0
        if (bytes + size > 512 * 1024) { hasMore = true; break outer }
        beforeSeq = row.seq; scanned++
        if (item) { items.push(item); bytes += size }
        if (items.length >= limit || scanned >= 1000 || Date.now() >= deadline) { hasMore = true; break outer }
      }
      if (rows.length < 100) { hasMore = false; break }
      hasMore = true
    }
    return { source: 'runtime_workbench' as const, items, hasMore, complete: !hasMore,
      nextCursor: hasMore ? writeCursor(token, { beforeSeq }) : undefined, scanned }
  }
  async list(scope: RemoteAuthority, raw: unknown) {
    requireRemoteScope(scope, 'schedules.read')
    const p = ScheduleListParams.parse(raw), page = await this.scan(scope, p.cursor, p.limit)
    const { items, ...meta } = page
    return { ...meta, schedules: items }
  }
  async runs(scope: RemoteAuthority, raw: unknown) {
    requireRemoteScope(scope, 'schedules.read')
    const p = ScheduleRunsParams.parse(raw)
    const source = await this.runtime.rooms!.deps.store.get<WorkbenchLink>('workbench_link', p.scheduleId)
    if (!source || !await this.visible(scope, source.roomId ?? source.value.roomId) ||
      source.value.kind !== 'schedule_series' && !source.value.request.schedule) throw new Error('NOT_FOUND')
    const { items, ...meta } = await this.scan(scope, p.cursor, p.limit, p.scheduleId)
    return { ...meta, runs: items }
  }
}
