import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GUI_UPDATE_BUSY_STATE_DELAY_MS,
  GUI_UPDATE_MIN_BACKGROUND_DELAY_MS,
  type GuiUpdateScheduleState
} from '../shared/gui-update-schedule'
import { createGuiUpdateScheduler } from './gui-updater-scheduler'

describe('GUI update scheduler', () => {
  let busy = false
  let suspended = false
  let state: GuiUpdateScheduleState
  let reads = vi.fn<() => Promise<GuiUpdateScheduleState>>()
  let runCheck = vi.fn<() => Promise<boolean>>()

  beforeEach(() => {
    vi.useFakeTimers()
    busy = false
    suspended = false
    state = {}
    reads = vi.fn<() => Promise<GuiUpdateScheduleState>>().mockImplementation(async () => state)
    runCheck = vi.fn<() => Promise<boolean>>().mockResolvedValue(true)
  })

  afterEach(() => vi.useRealTimers())

  function scheduler() {
    return createGuiUpdateScheduler({
      isBusyState: () => busy,
      isSuspendedState: () => suspended,
      readState: reads,
      writeState: vi.fn(async (next: GuiUpdateScheduleState) => { state = next }),
      runCheck,
      random: () => 0.5
    })
  }

  it('does not schedule or read while an update remains downloaded for 48 hours', async () => {
    suspended = true
    const subject = scheduler()
    await subject.scheduleNext()
    await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000)
    expect(reads).not.toHaveBeenCalled()
    expect(runCheck).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses a bounded fixed delay while downloading for 48 hours', async () => {
    busy = true
    const subject = scheduler()
    await subject.scheduleNext()
    for (let elapsed = 0; elapsed < 48 * 60 * 60 * 1000; elapsed += GUI_UPDATE_BUSY_STATE_DELAY_MS) {
      await vi.advanceTimersByTimeAsync(GUI_UPDATE_BUSY_STATE_DELAY_MS)
    }
    expect(runCheck).not.toHaveBeenCalled()
    expect(reads).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1)
  })

  it('arms overdue success records with a non-zero minimum delay', async () => {
    state = { lastSuccessAt: Date.now() - 48 * 60 * 60 * 1000 }
    const subject = scheduler()
    await subject.scheduleNext()
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(GUI_UPDATE_MIN_BACKGROUND_DELAY_MS - 1)
    expect(runCheck).not.toHaveBeenCalled()
  })

  it('rearms after a downloaded update leaves its suspended state', async () => {
    suspended = true
    const subject = scheduler()
    await subject.scheduleNext()
    suspended = false
    await subject.notifyStateChanged()
    expect(reads).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)
  })
})
