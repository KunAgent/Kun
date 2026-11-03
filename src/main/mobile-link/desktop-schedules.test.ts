import { describe, expect, it, vi } from 'vitest'
import { MobileDesktopSchedules, desktopScheduleDescriptors } from './desktop-schedules'
import { desktopScheduleId, runAuditedSchedule } from '../schedule-run-audit'
import type { RegisterAppIpcHandlersOptions } from '../ipc/app-ipc-handler-options'
import type { ScheduleRuntimeDeps } from '../schedule-runtime-helpers'
const scope = { accountId: 'owner', deviceId: 'phone', authorizationId: 'authority', scopes: ['personal', 'schedules.read'] as const }
const task = { id: 'task-with-local:/path', title: 'Daily task', enabled: true, prompt: 'private prompt', workspaceRoot: '/private/project',
  model: 'private-route', lastStatus: 'success', lastMessage: 'private result', lastThreadId: 'thread', lastRunAt: '2026-10-15T08:00:00.000Z',
  nextRunAt: '2026-10-16T08:00:00.000Z', schedule: { kind: 'daily', timeOfDay: '16:00', timeZone: 'Asia/Shanghai' } }
function fixture() {
  const settings = { schedule: { tasks: [task] } }, load = vi.fn(async () => settings)
  const adapter = new MobileDesktopSchedules({ store: { load }, getScheduleRuntime: () => ({ status: async () => ({ runningTaskIds: [], queuedTaskIds: [] }) }) } as unknown as RegisterAppIpcHandlersOptions)
  const request = vi.fn(async (_path: string, _method?: string, _body?: string) => ({ ok: true, status: 200, body: JSON.stringify({ runs: [], hasMore: false }) }))
  return { adapter, request, load, settings, authority: { ...scope, scopes: [...scope.scopes] } }
}
describe('actual Desktop scheduler mobile projection', () => {
  it('is unavailable without explicit read scope and strips prompts, paths, model routes and summaries', async () => {
    const f = fixture(), lease = { request: f.request, runtimeToken: 'local' }
    await expect(f.adapter.invoke('desktop.schedule.list', {}, { ...f.authority, scopes: ['personal'] }, lease)).rejects.toThrow('REMOTE_SCOPE_REQUIRED')
    expect(f.load).not.toHaveBeenCalled(); expect(desktopScheduleDescriptors(['personal'])).toEqual([])
    const result: any = await f.adapter.invoke('desktop.schedule.list', {}, f.authority, lease)
    expect(result).toMatchObject({ source: 'desktop_scheduler', schedules: [{ id: desktopScheduleId(task.id), title: 'Daily task', historyCoverage: 'recorded_and_latest_snapshot' }] })
    for (const hidden of ['private', 'lastMessage', 'workspaceRoot', 'model', 'local:/']) expect(JSON.stringify(result)).not.toContain(hidden)
    const history: any = await f.adapter.invoke('desktop.schedule.runs.list', { scheduleId: desktopScheduleId(task.id) }, f.authority, lease)
    expect(history.runs[0]).toMatchObject({ coverage: 'legacy_latest_snapshot', threadId: 'thread', status: 'success' })
  })
  it('fences pagination to exact authority and marks recorded history separately from the legacy snapshot', async () => {
    const f = fixture(), lease = { request: f.request, runtimeToken: 'local' }
    f.settings.schedule.tasks.push({ ...task, id: 'second' })
    const page: any = await f.adapter.invoke('desktop.schedule.list', { limit: 1 }, f.authority, lease)
    expect(page.hasMore).toBe(true)
    await expect(f.adapter.invoke('desktop.schedule.list', { limit: 1, cursor: page.nextCursor }, { ...f.authority, authorizationId: 'changed' }, lease)).rejects.toThrow('INVALID_CURSOR')
    f.request.mockResolvedValue({ ok: true, status: 200, body: JSON.stringify({ runs: [{ id: 'run1', coverage: 'recorded' }], hasMore: true, nextBeforeSeq: 40 }) })
    const history: any = await f.adapter.invoke('desktop.schedule.runs.list', { scheduleId: desktopScheduleId(task.id) }, f.authority, lease)
    expect(history.runs).toEqual([{ id: 'run1', coverage: 'recorded' }]); expect(history.nextCursor).toBeTruthy()
    await f.adapter.invoke('desktop.schedule.runs.list', { scheduleId: desktopScheduleId(task.id), cursor: history.nextCursor }, f.authority, lease)
    expect(JSON.parse(f.request.mock.calls.at(-1)![2]!)).toMatchObject({ beforeSeq: 40 })
  })
  it('audit outage never repeats the model request and keeps its original result', async () => {
    const request = vi.fn(async (_settings: any, _path: string, _init: { body?: string }) => ({ ok: false, status: 503, body: '' })), logError = vi.fn()
    const run = vi.fn(async (id: string) => ({ ok: true as const, threadId: 'thread', turnId: 'turn', message: id }))
    const result = await runAuditedSchedule({ runtimeRequest: request, logError } as unknown as ScheduleRuntimeDeps, {} as any, task.id, run)
    expect(result.ok).toBe(true); expect(run).toHaveBeenCalledOnce(); expect(request).toHaveBeenCalledTimes(2)
    expect(logError).toHaveBeenCalledTimes(2)
    const first = JSON.parse(request.mock.calls[0]![2]!.body!)
    expect(first).toMatchObject({ scheduleId: desktopScheduleId(task.id), clientRequestId: result.message })
    expect(JSON.stringify(first)).not.toContain('prompt')
  })
})
