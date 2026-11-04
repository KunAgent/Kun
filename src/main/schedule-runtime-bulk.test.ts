import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultScheduleSettings, type AppSettingsV1, type ScheduleRunResult, type ScheduledTaskV1 } from '../shared/app-settings'
import { scheduleTasksBulkInputSchema } from '../shared/schedule-task-bulk'
import { ScheduleRuntime } from './schedule-runtime'
import { ScheduleExecutionQueue } from './schedule-runtime-queue'

function task(id: string, patch: Partial<ScheduledTaskV1> = {}): ScheduledTaskV1 {
  return {
    id, title: id, enabled: true, prompt: 'Check', workspaceRoot: '/repo', clawChannelId: '',
    model: 'model', reasoningEffort: 'medium', mode: 'agent', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    schedule: { kind: 'interval', everyMinutes: 60, timeOfDay: '09:00', atTime: '' },
    lastRunAt: '2026-01-02T00:00:00Z', nextRunAt: '2026-01-03T00:00:00Z',
    lastStatus: 'success', lastMessage: 'Fresh result', lastThreadId: `thread-${id}`, ...patch
  }
}
function setup(tasks: ScheduledTaskV1[]) {
  let snapshot = { schedule: { ...defaultScheduleSettings(), enabled: false, tasks }, workspaceRoot: '/keep', unrelated: 'preserve' } as unknown as AppSettingsV1
  const store = {
    load: vi.fn(async () => snapshot),
    update: vi.fn(async (mutation: (current: AppSettingsV1) => AppSettingsV1) => { snapshot = mutation(snapshot); return snapshot })
  }
  const runtime = new ScheduleRuntime({ store: store as never, runtimeRequest: vi.fn(), logError: vi.fn() })
  vi.spyOn(runtime, 'sync').mockImplementation(() => undefined)
  return { runtime, store, read: () => snapshot }
}

beforeEach(() => vi.restoreAllMocks())
describe('atomic scheduled task bulk actions', () => {
  it('updates all selected tasks once against the latest snapshot and preserves live results', async () => {
    const running = task('running', { lastStatus: 'running', lastMessage: 'Live progress' })
    const untouched = task('untouched')
    const { runtime, store, read } = setup([running, task('other'), untouched])
    const result = await runtime.bulkMutateTasksById({ action: 'disable', taskIds: ['running', 'other', 'running'] })
    expect(store.update).toHaveBeenCalledTimes(1)
    expect(result[0]).toMatchObject({ enabled: false, nextRunAt: '', lastStatus: 'running', lastMessage: 'Live progress', lastThreadId: 'thread-running' })
    expect(result[1].enabled).toBe(false)
    expect(result[2]).toBe(untouched)
    expect(read().workspaceRoot).toBe('/keep')
    expect(runtime.sync).toHaveBeenCalledOnce()
  })
  it('enables the global scheduler and recomputes dates without replaying old intervals', async () => {
    const { runtime, read } = setup([task('a', { enabled: false }), task('b', { enabled: false })])
    const from = Date.now()
    await runtime.bulkMutateTasksById({ action: 'enable', taskIds: ['a', 'b'] })
    expect(read().schedule.enabled).toBe(true)
    for (const item of read().schedule.tasks) {
      expect(item.enabled).toBe(true)
      expect(Date.parse(item.nextRunAt)).toBeGreaterThanOrEqual(from + 60 * 60_000)
      expect(item.lastMessage).toBe('Fresh result')
    }
  })
  it('deletes only selected definitions and leaves unrelated tasks and session links unchanged', async () => {
    const keep = task('keep')
    const { runtime, store } = setup([task('delete'), keep])
    expect(await runtime.bulkMutateTasksById({ action: 'delete', taskIds: ['delete', 'already-gone'] })).toEqual([keep])
    expect(store.update).toHaveBeenCalledTimes(1)
    expect((await store.load()).schedule.tasks[0]).toBe(keep)
  })
  it('rejects expired one-time enable atomically and propagates persistence failures', async () => {
    const expired = task('expired', { enabled: false, schedule: { kind: 'at', atTime: '2000-01-01T00:00:00Z', everyMinutes: 60, timeOfDay: '09:00' } })
    const { runtime, store, read } = setup([expired, task('valid', { enabled: false })])
    await expect(runtime.bulkMutateTasksById({ action: 'enable', taskIds: ['expired', 'valid'] })).rejects.toThrow('expired')
    expect(read().schedule.tasks.every((item) => !item.enabled)).toBe(true)
    expect(runtime.sync).not.toHaveBeenCalled()
    store.update.mockRejectedValueOnce(new Error('disk offline'))
    await expect(runtime.bulkMutateTasksById({ action: 'delete', taskIds: ['valid'] })).rejects.toThrow('disk offline')
    expect(read().schedule.tasks).toHaveLength(2)
  })
  it('validates the IPC action and bounds the selection', () => {
    for (const input of [ { action: 'delete', taskIds: [] }, { action: 'run', taskIds: ['a'] }, { action: 'delete', taskIds: [' '] }, { action: 'delete', taskIds: Array(513).fill('a') }, { action: 'delete', taskIds: ['a'], tasks: [] } ]) {
      expect(scheduleTasksBulkInputSchema.safeParse(input).success).toBe(false)
    }
    expect(scheduleTasksBulkInputSchema.parse({ action: 'disable', taskIds: [' a '] }).taskIds).toEqual(['a'])
  })
  it('does not start a deleted candidate when a drain resumes from an awaited write', async () => {
    let release: () => void = () => undefined
    let reachedWrite: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const parked = new Promise<void>((resolve) => { reachedWrite = resolve })
    const snapshot = { schedule: { ...defaultScheduleSettings(), tasks: [task('paused', { enabled: false, priority: 10 }), task('deleted')] } } as AppSettingsV1
    const queue = new ScheduleExecutionQueue({
      store: {
        load: vi.fn(async () => snapshot),
        update: vi.fn(async (mutation: (value: AppSettingsV1) => AppSettingsV1) => {
          reachedWrite()
          await gate
          return mutation(snapshot)
        })
      }, logError: vi.fn(), runtimeRequest: vi.fn()
    } as never, vi.fn())
    const internals = queue as unknown as { queuedTaskIds: Set<string> }
    internals.queuedTaskIds.add('paused')
    internals.queuedTaskIds.add('deleted')
    const run = vi.spyOn(queue, 'runTaskInternal').mockResolvedValue({ ok: true, threadId: 'must-not-start' })
    const drain = queue.drainQueue()
    await parked
    queue.discardQueued(new Set(['deleted']))
    release()
    await drain
    expect(run).not.toHaveBeenCalled()
    expect(queue.queuedIds()).toEqual([])
  })

  it('settles deleted queued requests without aborting running work', async () => {
    const queue = new ScheduleExecutionQueue({} as never, vi.fn())
    const internals = queue as unknown as {
      queuedTaskIds: Set<string>; queuedTaskModes: Map<string, boolean>; runningTaskIds: Set<string>
      taskCompletions: Map<string, { resolve: (result: ScheduleRunResult) => void; reject: (cause: unknown) => void }>
    }
    const queuedDone = vi.fn(), runningDone = vi.fn()
    internals.queuedTaskIds.add('queued'); internals.queuedTaskModes.set('queued', true)
    internals.runningTaskIds.add('running')
    internals.taskCompletions.set('queued', { resolve: queuedDone, reject: vi.fn() })
    internals.taskCompletions.set('running', { resolve: runningDone, reject: vi.fn() })
    queue.discardQueued(new Set(['queued', 'running']))
    expect(queue.queuedIds()).toEqual([])
    expect(internals.queuedTaskModes.has('queued')).toBe(false)
    expect(queuedDone).toHaveBeenCalledWith({ ok: false, message: expect.stringContaining('deleted') })
    expect(runningDone).not.toHaveBeenCalled()
    expect(queue.runningIds()).toEqual(['running'])
  })
})
