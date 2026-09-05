export const ATTACHMENT_PRUNE_DELAY_MS = 30_000
export const ATTACHMENT_PRUNE_INTERVAL_MS = 60 * 60 * 1_000
export const THREAD_GUARDIAN_DELAY_MS = 45_000
export const THREAD_GUARDIAN_INTERVAL_MS = 6 * 60 * 60 * 1_000
export const EVENT_INDEX_REBUILD_DELAY_MS = 120_000
export const EVENT_INDEX_REBUILD_INTERVAL_MS = 12 * 60 * 60 * 1_000
export const MAINTENANCE_SLICE_RETRY_MS = 250

type MaintenanceTask = () => Promise<boolean | void>
type TaskName = 'attachment pruning' | 'thread guardian' | 'event index rebuild'

type TaskEntry = {
  name: TaskName
  run: MaintenanceTask
  delayMs: number
  intervalMs: number
  dueAt: number
}

export type RuntimeBackgroundMaintenance = {
  start(): void
  stop(): void
  wake(): void
}

export function createRuntimeBackgroundMaintenance(input: {
  pruneAttachments: MaintenanceTask
  inspectThreads: MaintenanceTask
  rebuildEventIndex?: MaintenanceTask
  onError: (task: TaskName, error: unknown) => void
  attachmentDelayMs?: number
  attachmentIntervalMs?: number
  guardianDelayMs?: number
  guardianIntervalMs?: number
  eventIndexRebuildDelayMs?: number
  eventIndexRebuildIntervalMs?: number
  sliceRetryMs?: number
}): RuntimeBackgroundMaintenance {
  let started = false
  let stopped = false
  let running = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const tasks: TaskEntry[] = [
    {
      name: 'attachment pruning',
      run: input.pruneAttachments,
      delayMs: input.attachmentDelayMs ?? ATTACHMENT_PRUNE_DELAY_MS,
      intervalMs: input.attachmentIntervalMs ?? ATTACHMENT_PRUNE_INTERVAL_MS,
      dueAt: Number.POSITIVE_INFINITY
    },
    {
      name: 'thread guardian',
      run: input.inspectThreads,
      delayMs: input.guardianDelayMs ?? THREAD_GUARDIAN_DELAY_MS,
      intervalMs: input.guardianIntervalMs ?? THREAD_GUARDIAN_INTERVAL_MS,
      dueAt: Number.POSITIVE_INFINITY
    }
  ]
  if (input.rebuildEventIndex) {
    tasks.push({
      name: 'event index rebuild',
      run: input.rebuildEventIndex,
      delayMs: input.eventIndexRebuildDelayMs ?? EVENT_INDEX_REBUILD_DELAY_MS,
      intervalMs: input.eventIndexRebuildIntervalMs ?? EVENT_INDEX_REBUILD_INTERVAL_MS,
      dueAt: Number.POSITIVE_INFINITY
    })
  }

  const schedule = (): void => {
    if (stopped || !started || running) return
    if (timer) clearTimeout(timer)
    const next = tasks.reduce((min, task) => (task.dueAt < min.dueAt ? task : min))
    const delay = Math.max(0, next.dueAt - Date.now())
    if (delay === 0) {
      queueMicrotask(runNext)
      return
    }
    timer = setTimeout(runNext, delay)
    timer.unref?.()
  }

  const runNext = (): void => {
    timer = undefined
    if (stopped || running) return
    const task = tasks.reduce((min, entry) => (entry.dueAt < min.dueAt ? entry : min))
    running = true
    void task.run().then((complete) => {
      const retry = complete === false
      task.dueAt = Date.now() + (retry
        ? input.sliceRetryMs ?? MAINTENANCE_SLICE_RETRY_MS
        : task.intervalMs)
    }).catch((error) => {
      input.onError(task.name, error)
      task.dueAt = Date.now() + task.intervalMs
    }).finally(() => {
      running = false
      schedule()
    })
  }

  const start = (): void => {
    if (started || stopped) return
    started = true
    for (const task of tasks) task.dueAt = Date.now() + task.delayMs
    schedule()
  }

  const stop = (): void => {
    stopped = true
    if (timer) clearTimeout(timer)
    timer = undefined
  }

  const wake = (): void => {
    if (stopped || !started) return
    const rebuild = tasks.find((task) => task.name === 'event index rebuild')
    if (rebuild) rebuild.dueAt = Date.now()
    schedule()
  }

  return { start, stop, wake }
}
