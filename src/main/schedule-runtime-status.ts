import type {
  ScheduleRuntimeStatus,
  ScheduledTaskV1
} from '../shared/app-settings'

export function boundThreadTasksForStatus(
  tasks: readonly ScheduledTaskV1[],
  runningTaskIds: readonly string[],
  queuedTaskIds: readonly string[]
): ScheduleRuntimeStatus['boundThreadTasks'] {
  const running = new Set(runningTaskIds)
  const queued = new Set(queuedTaskIds)
  return tasks.flatMap((task) => {
    const threadId = task.sourceThreadId?.trim() ?? ''
    if (!threadId) return []
    return [{
      taskId: task.id,
      threadId,
      enabled: task.enabled,
      status: running.has(task.id) ? 'running' as const : queued.has(task.id) ? 'queued' as const : task.lastStatus,
      nextRunAt: task.nextRunAt || (task.schedule.kind === 'at' ? task.schedule.atTime : ''),
      lastRunAt: task.lastRunAt,
      updatedAt: task.updatedAt
    }]
  })
}
