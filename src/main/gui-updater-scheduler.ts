import {
  GUI_UPDATE_BUSY_STATE_DELAY_MS,
  nextGuiUpdateCheckDelay,
  scheduleStateAfterFailure,
  scheduleStateAfterSuccess,
  type GuiUpdateScheduleState
} from '../shared/gui-update-schedule'

export type GuiUpdateSchedulerDeps = {
  isBusyState: () => boolean
  isSuspendedState: () => boolean
  readState: () => Promise<GuiUpdateScheduleState>
  writeState: (state: GuiUpdateScheduleState) => Promise<void>
  runCheck: () => Promise<boolean>
  now?: () => number
  random?: () => number
}

export type GuiUpdateScheduler = {
  clear: () => void
  notifyStateChanged: () => Promise<void>
  scheduleNext: () => Promise<void>
}

export function createGuiUpdateScheduler(deps: GuiUpdateSchedulerDeps): GuiUpdateScheduler {
  let timer: NodeJS.Timeout | null = null
  let checkPromise: Promise<void> | null = null
  const now = deps.now ?? Date.now

  function clear(): void {
    if (!timer) return
    clearTimeout(timer)
    timer = null
  }

  function arm(delay: number): void {
    clear()
    timer = setTimeout(async () => {
      timer = null
      await runScheduledCheck()
    }, delay)
  }

  async function scheduleNext(): Promise<void> {
    clear()
    if (deps.isSuspendedState()) return
    if (deps.isBusyState()) {
      arm(GUI_UPDATE_BUSY_STATE_DELAY_MS)
      return
    }
    arm(nextGuiUpdateCheckDelay(await deps.readState(), now()))
  }

  async function runScheduledCheck(): Promise<void> {
    if (checkPromise) return checkPromise
    checkPromise = (async () => {
      if (deps.isSuspendedState() || deps.isBusyState()) {
        await scheduleNext()
        return
      }
      const state = await deps.readState()
      const attemptedAt = now()
      await deps.writeState({ ...state, lastAttemptAt: attemptedAt, nextRetryAt: null })
      try {
        if (!await deps.runCheck()) throw new Error('GUI update check returned a failure result.')
        await deps.writeState(scheduleStateAfterSuccess(state, now()))
      } catch (error) {
        console.warn('[kun-gui updater] scheduled GUI update check failed:', error)
        await deps.writeState(scheduleStateAfterFailure(state, now(), deps.random))
      } finally {
        checkPromise = null
        await scheduleNext()
      }
    })()
    return checkPromise
  }

  return { clear, notifyStateChanged: scheduleNext, scheduleNext }
}
