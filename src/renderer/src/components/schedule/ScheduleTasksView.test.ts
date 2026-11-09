import { describe, expect, it } from 'vitest'
import type { ClawImChannelV1, ScheduledTaskV1 } from '@shared/app-settings'
import {
  filterScheduledTasks,
  newScheduledTask,
  preferredScheduleImChannel,
  scheduleImChannelOptionLabel,
  scheduleImProviderLabel,
  scheduleTaskSummary,
  scheduledTaskClawLabel,
  scheduledTaskLastThreadId,
  scheduledTaskResultIsExpandable,
  validateScheduledTaskDraft
} from './ScheduleTasksView'

const t = (key: string, values?: Record<string, unknown>): string =>
  values ? `${key}:${JSON.stringify(values)}` : key

const displayT = (key: string, values?: Record<string, unknown>): string => {
  if (key === 'scheduleImProviderFeishu') return 'Feishu'
  if (key === 'scheduleImProviderLark') return 'Lark'
  if (key === 'scheduleImProviderWeixin') return 'WeChat'
  return t(key, values)
}

function task(id: string, patch: Partial<ScheduledTaskV1> = {}): ScheduledTaskV1 {
  return {
    ...newScheduledTask('/tmp/workspace'),
    id,
    title: `Task ${id}`,
    prompt: 'Run',
    updatedAt: '2026-06-02T00:00:00.000Z',
    ...patch,
    schedule: {
      ...newScheduledTask('/tmp/workspace').schedule,
      ...patch.schedule
    }
  }
}

function channel(patch: Partial<ClawImChannelV1> = {}): ClawImChannelV1 {
  return {
    id: 'channel-1',
    provider: 'feishu',
    label: 'Feishu',
    enabled: true,
    model: 'auto',
    threadId: '',
    workspaceRoot: '/tmp/claw',
    agentProfile: {
      name: 'Ops Claw',
      description: '',
      identity: '',
      personality: '',
      userContext: '',
      replyRules: ''
    },
    conversations: [],
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
    ...patch
  }
}

describe('ScheduleTasksView helpers', () => {
  it('validates task form drafts', () => {
    const now = new Date('2026-06-02T00:00:00.000Z')

    expect(validateScheduledTaskDraft(task('missing-title', { title: '' }), t, now))
      .toBe('scheduleTaskNameRequired')
    expect(validateScheduledTaskDraft(task('missing-prompt', { prompt: '' }), t, now))
      .toBe('scheduleTaskPromptRequired')
    expect(validateScheduledTaskDraft(task('bad-interval', {
      schedule: { kind: 'interval', everyMinutes: 0, timeOfDay: '09:00', atTime: '' }
    }), t, now)).toBe('scheduleIntervalInvalid')
    expect(validateScheduledTaskDraft(task('bad-daily', {
      schedule: { kind: 'daily', everyMinutes: 60, timeOfDay: '24:00', atTime: '' }
    }), t, now)).toBe('scheduleDailyTimeInvalid')
    expect(validateScheduledTaskDraft(task('past-once', {
      schedule: {
        kind: 'at',
        everyMinutes: 60,
        timeOfDay: '09:00',
        atTime: '2026-06-01T00:00:00.000Z'
      }
    }), t, now)).toBe('scheduleAtTimePast')
    expect(validateScheduledTaskDraft(task('ok', {
      schedule: {
        kind: 'at',
        everyMinutes: 60,
        timeOfDay: '09:00',
        atTime: '2026-06-03T00:00:00.000Z'
      }
    }), t, now)).toBeNull()
  })

  it('filters and sorts tasks by next run before updated time', () => {
    const tasks = [
      task('older', { updatedAt: '2026-06-01T00:00:00.000Z' }),
      task('next-2', { nextRunAt: '2026-06-03T00:00:00.000Z' }),
      task('next-1', { nextRunAt: '2026-06-02T12:00:00.000Z' }),
      task('newer', { updatedAt: '2026-06-04T00:00:00.000Z' })
    ]

    expect(filterScheduledTasks(tasks, 'all').map((item) => item.id))
      .toEqual(['next-1', 'next-2', 'newer', 'older'])
    expect(filterScheduledTasks([
      task('enabled', { enabled: true }),
      task('disabled', { enabled: false })
    ], 'enabled').map((item) => item.id)).toEqual(['enabled'])
    expect(filterScheduledTasks([
      task('running', { lastStatus: 'running' }),
      task('idle', { lastStatus: 'idle' })
    ], 'running').map((item) => item.id)).toEqual(['running'])
    expect(filterScheduledTasks([
      task('success', { lastStatus: 'success' }),
      task('error', { lastStatus: 'error' }),
      task('idle', { lastStatus: 'idle' })
    ], 'done').map((item) => item.id)).toEqual(['success', 'error'])
  })

  it('combines search, failed filters and live runtime status without changing done semantics', () => {
    const tasks = [
      task('name', { title: 'Ops summary', lastStatus: 'success' }),
      task('prompt', { prompt: 'Check OPS', lastStatus: 'error' }),
      task('workspace', { workspaceRoot: '/repo/ops', lastStatus: 'error' }),
      task('other', { title: 'Unrelated', lastStatus: 'idle' })
    ]
    expect(filterScheduledTasks(tasks, 'all', '  oPs ').map((item) => item.id)).toEqual(['name', 'prompt', 'workspace'])
    expect(filterScheduledTasks(tasks, 'failed', 'ops').map((item) => item.id)).toEqual(['prompt', 'workspace'])
    expect(filterScheduledTasks(tasks, 'done').map((item) => item.id)).toEqual(['name', 'prompt', 'workspace'])
    const runtime = { runningTaskIds: ['prompt'], queuedTaskIds: ['other'] }
    expect(filterScheduledTasks(tasks, 'running', '', runtime).map((item) => item.id)).toEqual(['prompt', 'other'])
    expect(filterScheduledTasks(tasks, 'failed', '', runtime).map((item) => item.id)).toEqual(['workspace'])
  })

  it('summarizes schedule timing for the list UI', () => {
    expect(scheduleTaskSummary(task('daily', {
      schedule: { kind: 'daily', everyMinutes: 60, timeOfDay: '08:30', atTime: '' }
    }), t)).toBe('scheduleDailyAt:{"time":"08:30"}')
    expect(scheduleTaskSummary(task('interval', {
      schedule: { kind: 'interval', everyMinutes: 45, timeOfDay: '09:00', atTime: '' }
    }), t)).toBe('scheduleEvery:{"minutes":45}')
    expect(scheduleTaskSummary(task('manual', {
      schedule: { kind: 'manual', everyMinutes: 60, timeOfDay: '09:00', atTime: '' }
    }), t)).toBe('scheduleManual')
  })

  it('normalizes the task thread link shown in the list UI', () => {
    expect(scheduledTaskLastThreadId(task('never-ran'))).toBe('')
    expect(scheduledTaskLastThreadId(task('ran', { lastThreadId: '  thr_123  ' }))).toBe('thr_123')
  })

  it('shows selected Claw channel labels for scheduled tasks', () => {
    const channels = [channel()]

    expect(scheduledTaskClawLabel(task('plain'), channels, displayT)).toBe('')
    expect(scheduledTaskClawLabel(task('claw', { clawChannelId: 'channel-1' }), channels, displayT))
      .toBe('scheduleClawAgentLabel:{"name":"Ops Claw (Feishu)"}')
    expect(scheduledTaskClawLabel(task('missing', { clawChannelId: 'missing' }), channels, displayT))
      .toBe('scheduleClawAgentMissing')
  })

  it('shows the IM provider in scheduled IM channel options', () => {
    expect(scheduleImProviderLabel(channel(), displayT)).toBe('Feishu')
    expect(scheduleImProviderLabel(channel({
      platformCredential: {
        kind: 'feishu',
        appId: 'cli_lark',
        appSecret: 'secret',
        domain: 'lark',
        createdAt: '2026-06-02T00:00:00.000Z'
      }
    }), displayT)).toBe('Lark')
    expect(scheduleImProviderLabel(channel({
      provider: 'weixin',
      agentProfile: { ...channel().agentProfile, name: 'Weixin Agent' }
    }), displayT)).toBe('WeChat')
    expect(scheduleImChannelOptionLabel(channel(), displayT)).toBe('Ops Claw (Feishu)')
  })

  it('prefers enabled WeChat IM channels for scheduled IM mode', () => {
    const disabledWeixin = channel({
      id: 'weixin-disabled',
      provider: 'weixin',
      enabled: false,
      agentProfile: { ...channel().agentProfile, name: 'Disabled Weixin' }
    })
    const feishu = channel({
      id: 'feishu-1',
      provider: 'feishu',
      agentProfile: { ...channel().agentProfile, name: 'Feishu Agent' }
    })
    const weixin = channel({
      id: 'weixin-1',
      provider: 'weixin',
      agentProfile: { ...channel().agentProfile, name: 'Weixin Agent' }
    })

    expect(preferredScheduleImChannel([disabledWeixin, feishu, weixin])?.id).toBe('weixin-1')
    expect(preferredScheduleImChannel([disabledWeixin, feishu])?.id).toBe('feishu-1')
    expect(preferredScheduleImChannel([disabledWeixin])).toBeNull()
  })

  it('detects when a task result needs expansion', () => {
    expect(scheduledTaskResultIsExpandable('')).toBe(false)
    expect(scheduledTaskResultIsExpandable('short result')).toBe(false)
    expect(scheduledTaskResultIsExpandable('line 1\nline 2\nline 3\nline 4\nline 5\nline 6')).toBe(true)
    expect(scheduledTaskResultIsExpandable('x'.repeat(361))).toBe(true)
  })
})
