import { describe, expect, it } from 'vitest'
import type { ScheduledTaskV1 } from '@shared/app-settings'
import {
  activePlanScheduledTask,
  formatPlanScheduleNextRun,
  planScheduleCountdown,
  scheduledTaskTime
} from './plan-scheduled-task'

function task(id: string, patch: Partial<ScheduledTaskV1> = {}): ScheduledTaskV1 {
  return {
    id, title: id, enabled: true, prompt: '', workspaceRoot: '/tmp', sourcePlanId: 'plan-1',
    sourceThreadId: '', clawChannelId: '', providerId: 'deepseek', model: 'deepseek-v4-flash',
    reasoningEffort: 'medium', mode: 'agent', orchestration: 'direct', priority: 0, dependsOn: [],
    useWorktree: false, schedule: { kind: 'at', everyMinutes: 60, timeOfDay: '09:00', atTime: '2030-01-01T10:00:00.000Z' },
    createdAt: '2029-01-01T00:00:00.000Z', updatedAt: '2029-01-01T00:00:00.000Z',
    lastRunAt: '', nextRunAt: '', lastStatus: 'idle', lastMessage: '', lastThreadId: '', ...patch
  }
}

describe('activePlanScheduledTask', () => {
  it('selects the newest enabled one-time task for the plan', () => {
    const selected = activePlanScheduledTask([
      task('old'),
      task('other', { sourcePlanId: 'plan-2' }),
      task('disabled', { enabled: false, updatedAt: '2031-01-01T00:00:00.000Z' }),
      task('new', { updatedAt: '2029-02-01T00:00:00.000Z' })
    ], 'plan-1', Date.parse('2029-01-01T00:00:00.000Z'))
    expect(selected?.id).toBe('new')
  })

  it('prefers nextRunAt and rejects invalid schedules', () => {
    expect(scheduledTaskTime(task('valid', { nextRunAt: '2030-01-02T10:00:00.000Z' }))).toBe('2030-01-02T10:00:00.000Z')
    expect(activePlanScheduledTask([task('invalid', { schedule: { kind: 'at', everyMinutes: 60, timeOfDay: '09:00', atTime: '' } })], 'plan-1')).toBeNull()
    expect(activePlanScheduledTask([task('past')], 'plan-1', Date.parse('2031-01-01T00:00:00.000Z'))).toBeNull()
  })
})

describe('formatPlanScheduleNextRun', () => {
  it('uses relative calendar days in the scheduled time zone', () => {
    const now = Date.parse('2030-01-01T15:30:00.000Z')
    expect(formatPlanScheduleNextRun('2030-01-01T15:48:00.000Z', 'Asia/Shanghai', 'zh-CN', now))
      .toBe('今天 23:48')
    expect(formatPlanScheduleNextRun('2030-01-01T17:48:00.000Z', 'Asia/Shanghai', 'zh-CN', now))
      .toBe('明天 01:48')
  })
})

describe('planScheduleCountdown', () => {
  it('formats day, hour, and minute units without negative values', () => {
    expect(planScheduleCountdown('2030-01-02T02:31:00.000Z', Date.parse('2030-01-01T00:00:00.000Z')))
      .toEqual({ kind: 'remaining', days: 1, hours: 2, minutes: 31 })
    expect(planScheduleCountdown('2030-01-01T00:00:01.000Z', Date.parse('2030-01-01T00:00:00.000Z')))
      .toEqual({ kind: 'remaining', days: 0, hours: 0, minutes: 1 })
    expect(planScheduleCountdown('2029-12-31T23:59:00.000Z', Date.parse('2030-01-01T00:00:00.000Z')))
      .toEqual({ kind: 'due' })
  })
})
