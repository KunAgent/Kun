import { describe, expect, it } from 'vitest'
import type { ScheduledTaskV1 } from '../shared/app-settings'
import { boundThreadTasksForStatus } from './schedule-runtime-status'

function task(patch: Partial<ScheduledTaskV1>): ScheduledTaskV1 {
  return {
    id: 'task', title: 'Task', enabled: true, prompt: 'Run', workspaceRoot: '/tmp',
    sourceThreadId: '', clawChannelId: '', model: 'auto', reasoningEffort: 'medium', mode: 'agent',
    schedule: { kind: 'at', everyMinutes: 60, timeOfDay: '09:00', atTime: '2099-08-20T01:00:00.000Z' },
    createdAt: '', updatedAt: '', lastRunAt: '', nextRunAt: '', lastStatus: 'idle',
    lastMessage: '', lastThreadId: '', ...patch
  }
}

describe('schedule runtime sidebar status', () => {
  it('projects only bound tasks and lets runtime queue state override persisted status', () => {
    const bound = task({ id: 'bound', sourceThreadId: 'thread-plan' })
    const result = boundThreadTasksForStatus([bound, task({ id: 'unbound' })], [], ['bound'])

    expect(result).toEqual([expect.objectContaining({
      taskId: 'bound', threadId: 'thread-plan', status: 'queued',
      nextRunAt: '2099-08-20T01:00:00.000Z'
    })])
  })
})
