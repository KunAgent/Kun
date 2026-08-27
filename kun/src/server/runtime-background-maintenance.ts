export const USAGE_CARRYOVER_DELAY_MS = 5_000
export const ATTACHMENT_PRUNE_DELAY_MS = 30_000
export const ATTACHMENT_PRUNE_INTERVAL_MS = 60 * 60 * 1_000
export const THREAD_GUARDIAN_DELAY_MS = 45_000
export const THREAD_GUARDIAN_INTERVAL_MS = 6 * 60 * 60 * 1_000

type MaintenanceTask = () => Promise<void>

export type RuntimeBackgroundMaintenance = {
  start(): void
  stop(): void
}

export function createRuntimeBackgroundMaintenance(input: {
  seedUsage: MaintenanceTask
  pruneAttachments: MaintenanceTask
  inspectThreads: MaintenanceTask
  onError: (task: 'usage carryover' | 'attachment pruning' | 'thread guardian', error: unknown) => void
  usageDelayMs?: number
  attachmentDelayMs?: number
  attachmentIntervalMs?: number
  guardianDelayMs?: number
  guardianIntervalMs?: number
}): RuntimeBackgroundMaintenance {
  let started = false
  let stopped = false
  let usageTimer: ReturnType<typeof setTimeout> | undefined
  let attachmentTimer: ReturnType<typeof setTimeout> | undefined
  let attachmentInterval: ReturnType<typeof setInterval> | undefined
  let guardianTimer: ReturnType<typeof setTimeout> | undefined
  let guardianInterval: ReturnType<typeof setInterval> | undefined

  const run = (task: 'usage carryover' | 'attachment pruning' | 'thread guardian', action: MaintenanceTask) => {
    void action().catch((error) => input.onError(task, error))
  }
  const start = () => {
    if (started || stopped) return
    started = true
    usageTimer = setTimeout(() => {
      usageTimer = undefined
      if (!stopped) run('usage carryover', input.seedUsage)
    }, input.usageDelayMs ?? USAGE_CARRYOVER_DELAY_MS)
    usageTimer.unref?.()
    attachmentTimer = setTimeout(() => {
      attachmentTimer = undefined
      if (stopped) return
      run('attachment pruning', input.pruneAttachments)
      attachmentInterval = setInterval(() => {
        if (!stopped) run('attachment pruning', input.pruneAttachments)
      }, input.attachmentIntervalMs ?? ATTACHMENT_PRUNE_INTERVAL_MS)
      attachmentInterval.unref?.()
    }, input.attachmentDelayMs ?? ATTACHMENT_PRUNE_DELAY_MS)
    attachmentTimer.unref?.()
    guardianTimer = setTimeout(() => {
      guardianTimer = undefined
      if (stopped) return
      run('thread guardian', input.inspectThreads)
      guardianInterval = setInterval(() => {
        if (!stopped) run('thread guardian', input.inspectThreads)
      }, input.guardianIntervalMs ?? THREAD_GUARDIAN_INTERVAL_MS)
      guardianInterval.unref?.()
    }, input.guardianDelayMs ?? THREAD_GUARDIAN_DELAY_MS)
    guardianTimer.unref?.()
  }
  const stop = () => {
    stopped = true
    if (usageTimer) clearTimeout(usageTimer)
    if (attachmentTimer) clearTimeout(attachmentTimer)
    if (attachmentInterval) clearInterval(attachmentInterval)
    if (guardianTimer) clearTimeout(guardianTimer)
    if (guardianInterval) clearInterval(guardianInterval)
    usageTimer = undefined
    attachmentTimer = undefined
    attachmentInterval = undefined
    guardianTimer = undefined
    guardianInterval = undefined
  }
  return { start, stop }
}
