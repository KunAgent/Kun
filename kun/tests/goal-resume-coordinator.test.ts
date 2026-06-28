import { describe, expect, it } from 'vitest'
import { GoalResumeCoordinator } from '../src/loop/goal-resume-coordinator.js'

type Scheduled = { fn: () => void; delayMs: number; cancelled: boolean }

function makeManualTimer() {
  const scheduled: Scheduled[] = []
  const setTimer = (fn: () => void, delayMs: number) => {
    const entry: Scheduled = { fn, delayMs, cancelled: false }
    scheduled.push(entry)
    return {
      cancel: () => {
        entry.cancelled = true
      }
    }
  }
  const pending = () => scheduled.filter((entry) => !entry.cancelled)
  const fireLatest = async () => {
    const entry = [...scheduled].reverse().find((e) => !e.cancelled)
    if (!entry) throw new Error('no pending timer to fire')
    entry.cancelled = true
    entry.fn()
    // Let the async fire() body run.
    await Promise.resolve()
    await Promise.resolve()
  }
  return { scheduled, setTimer, pending, fireLatest }
}

function makeCoordinator(
  overrides: {
    activeGoalKey?: () => string | null
    busy?: () => boolean
    maxNoProgressAttempts?: number
    baseDelayMs?: number
    maxDelayMs?: number
  } = {}
) {
  const timer = makeManualTimer()
  const launches: string[] = []
  let activeGoalKey = overrides.activeGoalKey ?? (() => 'thr::t0::obj')
  let busy = overrides.busy ?? (() => false)
  const coordinator = new GoalResumeCoordinator({
    launch: async (threadId) => {
      launches.push(threadId)
    },
    getActiveGoalKey: async () => activeGoalKey(),
    isThreadBusy: async () => busy(),
    setTimer: timer.setTimer,
    log: () => undefined,
    maxNoProgressAttempts: overrides.maxNoProgressAttempts ?? 3,
    baseDelayMs: overrides.baseDelayMs ?? 1000,
    maxDelayMs: overrides.maxDelayMs ?? 30_000
  })
  return {
    coordinator,
    timer,
    launches,
    setActiveGoalKey: (value: string | null) => {
      activeGoalKey = () => value
    },
    setBusy: (value: boolean) => {
      busy = () => value
    }
  }
}

describe('GoalResumeCoordinator', () => {
  it('schedules a backoff resume that launches a continuation turn', async () => {
    const ctx = makeCoordinator()
    const outcome = ctx.coordinator.noteGoalTurnSettled({
      threadId: 'thr',
      goalKey: 'thr::t0::obj',
      madeProgress: false
    })
    expect(outcome).toBe('scheduled')
    expect(ctx.timer.pending()).toHaveLength(1)
    expect(ctx.timer.pending()[0]?.delayMs).toBe(1000)

    await ctx.timer.fireLatest()
    expect(ctx.launches).toEqual(['thr'])
  })

  it('backs off exponentially across consecutive no-progress failures', () => {
    const ctx = makeCoordinator({ baseDelayMs: 1000, maxDelayMs: 30_000 })
    const delays: number[] = []
    for (let i = 0; i < 3; i += 1) {
      ctx.coordinator.noteGoalTurnSettled({ threadId: 'thr', goalKey: 'k', madeProgress: false })
      const latest = [...ctx.timer.scheduled].reverse().find((e) => !e.cancelled)
      delays.push(latest!.delayMs)
    }
    expect(delays).toEqual([1000, 2000, 4000])
  })

  it('caps the backoff delay at maxDelayMs', () => {
    const ctx = makeCoordinator({ baseDelayMs: 1000, maxDelayMs: 2500, maxNoProgressAttempts: 10 })
    let last = 0
    for (let i = 0; i < 6; i += 1) {
      ctx.coordinator.noteGoalTurnSettled({ threadId: 'thr', goalKey: 'k', madeProgress: false })
      last = [...ctx.timer.scheduled].reverse().find((e) => !e.cancelled)!.delayMs
    }
    expect(last).toBe(2500)
  })

  it('exhausts the budget after consecutive no-progress failures', () => {
    const ctx = makeCoordinator({ maxNoProgressAttempts: 3 })
    const outcomes = [1, 2, 3, 4].map(() =>
      ctx.coordinator.noteGoalTurnSettled({ threadId: 'thr', goalKey: 'k', madeProgress: false })
    )
    expect(outcomes).toEqual(['scheduled', 'scheduled', 'scheduled', 'exhausted'])
  })

  it('never exhausts while each failure still makes progress', () => {
    const ctx = makeCoordinator({ maxNoProgressAttempts: 2 })
    const outcomes = [1, 2, 3, 4, 5].map(() =>
      ctx.coordinator.noteGoalTurnSettled({ threadId: 'thr', goalKey: 'k', madeProgress: true })
    )
    expect(outcomes).toEqual(['scheduled', 'scheduled', 'scheduled', 'scheduled', 'scheduled'])
  })

  it('resets the no-progress budget when a failure makes progress', () => {
    const ctx = makeCoordinator({ maxNoProgressAttempts: 2 })
    const fail = (madeProgress: boolean) =>
      ctx.coordinator.noteGoalTurnSettled({ threadId: 'thr', goalKey: 'k', madeProgress })
    // Two no-progress failures bring the streak to the cap...
    expect(fail(false)).toBe('scheduled') // streak 1
    expect(fail(false)).toBe('scheduled') // streak 2 (== cap)
    // ...a failure that made progress resets the streak to 0...
    expect(fail(true)).toBe('scheduled') // streak 0
    // ...so it now takes a fresh run of no-progress failures to exhaust.
    expect(fail(false)).toBe('scheduled') // streak 1
    expect(fail(false)).toBe('scheduled') // streak 2 (== cap)
    expect(fail(false)).toBe('exhausted') // streak 3 (> cap)
  })

  it('resets the budget when the goal identity changes', () => {
    const ctx = makeCoordinator({ maxNoProgressAttempts: 2 })
    ctx.coordinator.noteGoalTurnSettled({ threadId: 'thr', goalKey: 'old', madeProgress: false })
    ctx.coordinator.noteGoalTurnSettled({ threadId: 'thr', goalKey: 'old', madeProgress: false })
    // New goal key restarts the counter rather than immediately exhausting.
    expect(ctx.coordinator.noteGoalTurnSettled({ threadId: 'thr', goalKey: 'new', madeProgress: false })).toBe('scheduled')
  })

  it('does not launch when the goal is no longer active at fire time', async () => {
    const ctx = makeCoordinator()
    ctx.coordinator.noteGoalTurnSettled({ threadId: 'thr', goalKey: 'thr::t0::obj', madeProgress: false })
    ctx.setActiveGoalKey(null) // goal completed/cleared while waiting
    await ctx.timer.fireLatest()
    expect(ctx.launches).toEqual([])
  })

  it('does not launch when the goal was replaced while waiting', async () => {
    const ctx = makeCoordinator()
    ctx.coordinator.noteGoalTurnSettled({ threadId: 'thr', goalKey: 'thr::t0::obj', madeProgress: false })
    ctx.setActiveGoalKey('thr::t1::different')
    await ctx.timer.fireLatest()
    expect(ctx.launches).toEqual([])
  })

  it('skips launching when a turn is already running at fire time', async () => {
    const ctx = makeCoordinator()
    ctx.coordinator.noteGoalTurnSettled({ threadId: 'thr', goalKey: 'thr::t0::obj', madeProgress: false })
    ctx.setBusy(true)
    await ctx.timer.fireLatest()
    expect(ctx.launches).toEqual([])
  })

  it('clear() cancels a pending resume', async () => {
    const ctx = makeCoordinator()
    ctx.coordinator.noteGoalTurnSettled({ threadId: 'thr', goalKey: 'k', madeProgress: false })
    ctx.coordinator.clear('thr')
    expect(ctx.timer.pending()).toHaveLength(0)
  })

  it('shutdown() cancels pending resumes and stops scheduling', () => {
    const ctx = makeCoordinator()
    ctx.coordinator.noteGoalTurnSettled({ threadId: 'thr', goalKey: 'k', madeProgress: false })
    ctx.coordinator.shutdown()
    expect(ctx.timer.pending()).toHaveLength(0)
    expect(ctx.coordinator.noteGoalTurnSettled({ threadId: 'thr', goalKey: 'k', madeProgress: false })).toBe('skipped')
  })

  it('resumeInterrupted launches an active, idle goal', async () => {
    const ctx = makeCoordinator()
    await expect(ctx.coordinator.resumeInterrupted('thr')).resolves.toBe(true)
    expect(ctx.launches).toEqual(['thr'])
  })

  it('resumeInterrupted skips when there is no active goal or a turn is running', async () => {
    const noGoal = makeCoordinator({ activeGoalKey: () => null })
    await expect(noGoal.coordinator.resumeInterrupted('thr')).resolves.toBe(false)
    expect(noGoal.launches).toEqual([])

    const busy = makeCoordinator({ busy: () => true })
    await expect(busy.coordinator.resumeInterrupted('thr')).resolves.toBe(false)
    expect(busy.launches).toEqual([])
  })
})
