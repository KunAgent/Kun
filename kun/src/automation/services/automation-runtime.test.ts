import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import { AutomationRuntime } from './automation-runtime.js'
import { AutomationTaskStore } from './automation-task-store.js'
import type { AutomationExecutor } from './automation-executor.js'
import type { AutomationSettings } from '../contracts/automation-types.js'

class FakeAutomationExecutor implements Pick<AutomationExecutor, 'execute'> {
  readonly requests: Array<{ inputText: string; systemPrompt: string; expertId?: string }> = []

  async execute(request: { inputText: string; systemPrompt: string; expertId?: string }) {
    this.requests.push(request)
    return {
      text: `draft:${request.inputText}`,
      threadId: 'thr_auto_fake',
      turnId: 'turn_auto_fake',
      tokensUsed: 12,
      toolCallCount: 0
    }
  }
}

function settings(): AutomationSettings {
  const now = '2026-07-16T00:00:00.000Z'
  return {
    enabled: true,
    employees: [
      {
        id: 'mail-helper',
        type: 'mail',
        name: 'Mail Helper',
        enabled: true,
        status: 'active',
        profile: {
          roleDescription: 'Draft helpful replies.',
          workBoundary: 'Never send externally.',
          tone: 'professional',
          defaultDeliverableFormat: 'short draft'
        },
        knowledgeScope: {
          knowledgeBaseIds: [],
          minScore: 0.4,
          citeSources: true,
          conflictPolicy: 'draft_approval'
        },
        expertAssignment: {
          expertId: 'expert-mail',
          expertTeamId: '',
          collaborationMode: 'lead_only',
          escalationRules: []
        },
        autoReplyPolicy: {
          enabled: true,
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
        approvalPolicy: {
          mode: 'risk_based',
          requireApprovalRiskAtOrAbove: 'medium',
          timeoutMinutes: 1440,
          allowApproverEdit: true
        },
        createdAt: now,
        updatedAt: now
      }
    ],
    defaults: {
      actionLevel: 'draft',
      autoReplyEnabled: false,
      maxAutoRepliesPerHour: 12,
      riskThreshold: 'medium',
      approvalPolicy: {
        mode: 'manual',
        requireApprovalRiskAtOrAbove: 'medium',
        timeoutMinutes: 30,
        allowApproverEdit: true
      }
    },
    schedules: []
  }
}

describe('AutomationRuntime', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
    tempDirs.length = 0
  })

  it('executes a task through the injected in-process executor', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-auto-'))
    tempDirs.push(dir)
    const store = new AutomationTaskStore(dir)
    const executor = new FakeAutomationExecutor()
    const runtime = new AutomationRuntime({
      taskStore: store,
      executor: executor as unknown as AutomationExecutor,
      now: () => '2026-07-16T00:00:00.000Z'
    })
    runtime.sync(settings())

    const result = await runtime.runTask({
      employeeId: 'mail-helper',
      source: 'manual',
      inputText: 'Reply to customer',
      actionLevel: 'draft'
    })

    expect(result.status).toBe('completed')
    expect(executor.requests).toHaveLength(1)
    expect(executor.requests[0].expertId).toBe('expert-mail')
    expect(executor.requests[0].systemPrompt).toContain('Draft helpful replies.')

    const task = await store.getTask(result.taskId)
    expect(task?.outputText).toBe('draft:Reply to customer')
    expect(task?.threadId).toBe('thr_auto_fake')
    expect(task?.turnId).toBe('turn_auto_fake')
  })
})
