import { createHash } from 'node:crypto'
import { validateOperationParams } from '@kun/remote-protocol'
import type { MobileLinkScope } from '../../shared/mobile-link-scopes'
import type { RegisterAppIpcHandlersOptions, ProtectedRuntimeRequestLease } from '../ipc/app-ipc-handler-options'
import { desktopScheduleId } from '../schedule-run-audit'
type Scope = { accountId: string; deviceId: string; authorizationId: string; scopes: MobileLinkScope[] }
const METHODS = ['desktop.schedule.list', 'desktop.schedule.runs.list']
function signature(scope: Scope, method: string, id?: string) {
  return createHash('sha256').update(JSON.stringify([scope.accountId, scope.deviceId, scope.authorizationId, method, id])).digest('hex')
}
function position(cursor: string | undefined, key: string): number | undefined {
  if (!cursor) return undefined
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString())
    if (value.key !== key || !Number.isSafeInteger(value.offset) || value.offset < 0) throw new Error()
    return value.offset
  } catch { throw new Error('INVALID_CURSOR') }
}
const cursorFor = (key: string, offset: number) => Buffer.from(JSON.stringify({ key, offset })).toString('base64url')
export function desktopScheduleDescriptors(scopes: MobileLinkScope[]) {
  return scopes.includes('schedules.read') ? METHODS.map((operation) => ({ operation, schemaVersion: 1,
    resourceKind: 'schedule', allowedActions: ['read'], supported: true, enabled: true, authorized: true, online: true, limits: { pageSize: 50 } })) : []
}
/** Narrow projections of the real Main scheduler; raw settings/credentials/IPC channels never cross the relay. */
export class MobileDesktopSchedules {
  constructor(private options: Pick<RegisterAppIpcHandlersOptions, 'store' | 'getScheduleRuntime'>) {}
  async invoke(method: string, raw: unknown, scope: Scope, lease: ProtectedRuntimeRequestLease): Promise<unknown> {
    if (!METHODS.includes(method)) throw new Error('UNSUPPORTED_OPERATION')
    if (!scope.scopes.includes('schedules.read')) throw new Error('REMOTE_SCOPE_REQUIRED')
    const p = validateOperationParams(method as 'desktop.schedule.list' | 'desktop.schedule.runs.list', raw) as { cursor?: string; limit?: number; scheduleId?: string }
    const limit = p.limit ?? 20, settings = await this.options.store.load(), runtime = this.options.getScheduleRuntime()
    const key = signature(scope, method, p.scheduleId), offset = position(p.cursor, key)
    if (method === 'desktop.schedule.list') {
      const status = await runtime?.status(), tasks = [...settings.schedule.tasks].sort((a, b) => desktopScheduleId(a.id).localeCompare(desktopScheduleId(b.id)))
      const start = offset ?? 0, hasMore = tasks.length > start + limit
      return { source: 'desktop_scheduler', schedules: tasks.slice(start, start + limit).map((task) => ({
        id: desktopScheduleId(task.id), title: task.title, enabled: task.enabled,
        status: status?.runningTaskIds.includes(task.id) ? 'running' : status?.queuedTaskIds.includes(task.id) ? 'queued' : task.lastStatus,
        nextRunAt: task.nextRunAt || undefined, lastRunAt: task.lastRunAt || undefined,
        schedule: { kind: task.schedule.kind, everyMinutes: task.schedule.everyMinutes, timeOfDay: task.schedule.timeOfDay,
          atTime: task.schedule.atTime, timeZone: task.schedule.timeZone }, historyCoverage: 'recorded_and_latest_snapshot' })),
        hasMore, nextCursor: hasMore ? cursorFor(key, start + limit) : undefined }
    }
    const task = settings.schedule.tasks.find((candidate) => desktopScheduleId(candidate.id) === p.scheduleId)
    if (!task) throw new Error('NOT_FOUND')
    const response = await lease.request('/v1/remote/desktop-schedule-audit/list', 'POST', JSON.stringify({
      scheduleId: p.scheduleId, limit, ...(offset === undefined ? {} : { beforeSeq: offset }) }))
    if (!response.ok) throw new Error('SCHEDULE_AUDIT_UNAVAILABLE')
    const value = JSON.parse(response.body)
    const runs = Array.isArray(value.runs) ? value.runs : []
    if (!p.cursor && !runs.length && task.lastRunAt) runs.push({
      id: 'legacy_' + createHash('sha256').update(task.id + ':' + task.lastRunAt).digest('hex'), scheduleId: p.scheduleId,
      status: task.lastStatus, threadId: task.lastThreadId || undefined, startedAt: task.lastRunAt,
      coverage: 'legacy_latest_snapshot' })
    return { source: 'desktop_scheduler', runs, hasMore: Boolean(value.hasMore),
      nextCursor: value.hasMore && Number.isSafeInteger(value.nextBeforeSeq) ? cursorFor(key, value.nextBeforeSeq) : undefined }
  }
}
