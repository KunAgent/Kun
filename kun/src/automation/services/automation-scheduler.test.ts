import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AutomationScheduler } from './automation-scheduler.js'
import type { AutomationRuntime } from './automation-runtime.js'
import type { AutomationSettings, ScheduledTask } from '../contracts/automation-types.js'

class FakeRuntime implements Pick<AutomationRuntime, 'runTask'> {
  readonly calls: Array<{ employeeId: string; source: string; inputText: string }> = []

  async runTask(input: { employeeId: string; source: string; inputText: string }) {
    this.calls.push(input)
    return { taskId: 'task_fake', status: 'completed' as const, decision: { kind: 'draft' as const, risk: { level: 'low' as const, reasons: [], matchedRules: [], requiresApproval: false, policyDecision: '' } } }
  }
}

function createSchedule(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  const now = '2026-07-16T10:00:00.000Z'
  return {
    id: 'sched-1',
    employeeId: 'emp-1',
    name: 'Daily Check',
    enabled: true,
    cron: '0 10 * * *',
    timezone: 'UTC',
    prompt: 'Check inbox',
    inputScope: { folders: [], labels: [], unreadOnly: true },
    failurePolicy: { maxRetries: 2, retryDelayMinutes: 5, notifyOnFailure: true },
    nextRunAt: '2026-07-16T10:00:00.000Z',
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

function settings(schedules: ScheduledTask[]): AutomationSettings {
  return {
    enabled: true,
    employees: [
      {
        id: 'emp-1',
        type: 'mail',
        name: 'Employee',
        enabled: true,
        status: 'active',
        profile: { roleDescription: '', workBoundary: '', tone: 'professional', defaultDeliverableFormat: 'draft' },
        knowledgeScope: { knowledgeBaseIds: [], minScore: 0.4, citeSources: true, conflictPolicy: 'draft_approval' },
        expertAssignment: { expertId: '', expertTeamId: '', collaborationMode: 'lead_only', escalationRules: [] },
        autoReplyPolicy: {
          enabled: false,
          actionLevel: 'draft',
          allowExternalSend: false,
          maxRepliesPerHour: 12,
          maxRepliesPerThreadPerDay: 3,
          quietHours: { enabled: false, start: '22:00', end: '08:00' },
          allowList: [],
          denyList: [],
          requireApprovalRiskAtOrAbove: 'medium',
          requireApprovalKeywords: []
        },
        approvalPolicy: { mode: 'manual', requireApprovalRiskAtOrAbove: 'medium', timeoutMinutes: 30, allowApproverEdit: true },
        createdAt: '2026-07-16T00:00:00.000Z',
        updatedAt: '2026-07-16T00:00:00.000Z'
      }
    ],
    defaults: {
      actionLevel: 'draft',
      autoReplyEnabled: false,
      maxAutoRepliesPerHour: 12,
      riskThreshold: 'medium',
      approvalPolicy: { mode: 'manual', requireApprovalRiskAtOrAbove: 'medium', timeoutMinutes: 30, allowApproverEdit: true }
    },
    schedules
  }
}

describe('AutomationScheduler', () => {
  let fakeRuntime: FakeRuntime
  let mockNow: Date
  let scheduler: AutomationScheduler

  beforeEach(() => {
    fakeRuntime = new FakeRuntime()
    mockNow = new Date('2026-07-16T10:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(mockNow)
  })

  afterEach(() => {
    vi.useRealTimers()
    if (scheduler) scheduler.stop()
  })

  it('triggers due schedule on tick', async () => {
    const schedule = createSchedule({ nextRunAt: '2026-07-16T09:59:00.000Z' })
    scheduler = new AutomationScheduler({
      runtime: fakeRuntime as unknown as AutomationRuntime,
      cronNext: () => new Date('2026-07-17T10:00:00.000Z'),
      now: () => mockNow
    })
    scheduler.sync(settings([schedule]))
    scheduler.start()

    // Advance time to trigger first tick, then stop
    await vi.advanceTimersByTimeAsync(1)
    scheduler.stop()

    expect(fakeRuntime.calls).toHaveLength(1)
    expect(fakeRuntime.calls[0].source).toBe('schedule')
    expect(fakeRuntime.calls[0].inputText).toBe('Check inbox')
  })

  it('skips disabled schedules', async () => {
    const schedule = createSchedule({ enabled: false, nextRunAt: '2026-07-16T09:59:00.000Z' })
    scheduler = new AutomationScheduler({
      runtime: fakeRuntime as unknown as AutomationRuntime,
      cronNext: () => new Date('2026-07-17T10:00:00.000Z'),
      now: () => mockNow
    })
    scheduler.sync(settings([schedule]))
    scheduler.start()

    await vi.advanceTimersByTimeAsync(1)
    scheduler.stop()

    expect(fakeRuntime.calls).toHaveLength(0)
  })

  it('calculates next run time after execution', async () => {
    const schedule = createSchedule({ nextRunAt: '2026-07-16T09:59:00.000Z' })
    const nextRun = new Date('2026-07-17T10:00:00.000Z')
    scheduler = new AutomationScheduler({
      runtime: fakeRuntime as unknown as AutomationRuntime,
      cronNext: () => nextRun,
      now: () => mockNow
    })
    scheduler.sync(settings([schedule]))
    scheduler.start()

    await vi.advanceTimersByTimeAsync(1)
    scheduler.stop()

    expect(schedule.nextRunAt).toBe(nextRun.toISOString())
    expect(schedule.lastRunAt).toBe(mockNow.toISOString())
  })
})
