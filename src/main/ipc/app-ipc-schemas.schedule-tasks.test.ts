import {
  describe,
  expect,
  it
} from 'vitest'
import { normalizeScheduledTask } from '../../shared/app-settings'
import { settingsPatchSchema } from './app-ipc-schemas'

describe('scheduled task settings patches', () => {
  const now = '2026-09-24T00:00:00.000Z'

  function normalizedTask(): ReturnType<typeof normalizeScheduledTask> {
    return normalizeScheduledTask({
      id: 'task-1',
      title: 'Plan build',
      enabled: true,
      prompt: 'Build it',
      workspaceRoot: '/tmp/project',
      sourcePlanId: 'plan-1',
      sourceThreadId: 'thread-1',
      providerId: 'deepseek',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'medium',
      mode: 'agent',
      orchestration: 'graph',
      priority: 5,
      dependsOn: ['task-0'],
      useWorktree: true,
      schedule: {
        kind: 'at',
        everyMinutes: 60,
        timeOfDay: '',
        atTime: '2099-01-01T10:00:00.000Z',
        timeZone: 'Asia/Shanghai'
      }
    }, 0, now)
  }

  // #1342: the read path fills sourcePlanId/sourceThreadId/orchestration (and
  // schedule.timeZone) onto every task, so the strict write schema must accept
  // them or every Scheduled Tasks panel mutation is rejected.
  it('accepts normalized tasks written back through schedule.tasks', () => {
    const parsed = settingsPatchSchema.parse({ schedule: { tasks: [normalizedTask()] } })

    expect(parsed.schedule?.tasks).toHaveLength(1)
    expect(parsed.schedule?.tasks?.[0]).toMatchObject({
      sourcePlanId: 'plan-1',
      sourceThreadId: 'thread-1',
      orchestration: 'graph'
    })
  })

  it('accepts normalized tasks written back through claw.tasks', () => {
    const parsed = settingsPatchSchema.parse({ claw: { tasks: [normalizedTask()] } })

    expect(parsed.claw?.tasks).toHaveLength(1)
  })

  it('accepts normalized tasks without plan binding or schedule time zone', () => {
    const task = normalizeScheduledTask({
      title: 'Daily',
      prompt: 'Run',
      schedule: { kind: 'daily', everyMinutes: 60, timeOfDay: '08:00', atTime: '' }
    }, 0, now)

    const parsed = settingsPatchSchema.parse({ schedule: { tasks: [task] } })
    expect(parsed.schedule?.tasks?.[0]?.sourcePlanId).toBe('')
    expect(parsed.schedule?.tasks?.[0]?.orchestration).toBe('direct')
  })

  it('still rejects unknown keys on scheduled task patches', () => {
    expect(() => settingsPatchSchema.parse({
      schedule: { tasks: [{ ...normalizedTask(), unexpectedKey: true }] }
    })).toThrow(/[Uu]nrecognized key/)
  })
})
