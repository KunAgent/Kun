import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollaborationPlan } from '../contracts/collaboration.js'
import { CollaborationPlanService } from './collaboration-plan-service.js'
import { CollaborationStore } from './collaboration-store.js'
import { CollaborationTaskService } from './collaboration-task-service.js'

describe('CollaborationTaskService recovery controls', () => {
  let dataDir: string
  let store: CollaborationStore
  let startTask: ReturnType<typeof vi.fn>
  let cancelTask: ReturnType<typeof vi.fn>
  let service: CollaborationTaskService

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'kun-collaboration-'))
    store = new CollaborationStore({ dataDir })
    startTask = vi.fn().mockResolvedValue({ threadId: 'thread-2', turnId: 'turn-2' })
    cancelTask = vi.fn(async () => undefined)
    service = new CollaborationTaskService({
      store,
      planService: new CollaborationPlanService({ store }),
      startTask,
      cancelTask
    })
    await store.savePlan(createPlan())
  })

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('interrupts the exact live Kun turn and makes repeated interruption idempotent', async () => {
    await service.interruptTaskExecution('plan-1', 'task-1')
    const repeated = await service.interruptTaskExecution('plan-1', 'task-1')

    expect(cancelTask).toHaveBeenCalledTimes(1)
    expect(cancelTask).toHaveBeenCalledWith('thread-1', 'turn-1')
    expect(repeated?.status).toBe('interrupted')
  })

  it('preserves the previous attempt when retry starts a linked Kun turn', async () => {
    await service.interruptTaskExecution('plan-1', 'task-1')
    const retried = await service.retryTaskExecution('plan-1', 'task-1')

    expect(retried).toMatchObject({
      status: 'in_progress',
      threadId: 'thread-2',
      turnId: 'turn-2',
      attempt: 2,
      previousAttempts: [
        expect.objectContaining({
          attempt: 1,
          threadId: 'thread-1',
          turnId: 'turn-1',
          status: 'interrupted'
        })
      ]
    })
  })
})

describe('CollaborationStore restart recovery', () => {
  it('normalizes persisted running tasks to interrupted without touching completed tasks', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-collaboration-restart-'))
    try {
      const store = new CollaborationStore({ dataDir })
      const plan = createPlan()
      plan.tasks.push({
        ...plan.tasks[0],
        id: 'task-completed',
        status: 'completed',
        threadId: 'thread-completed',
        turnId: 'turn-completed'
      })
      await store.savePlan(plan)

      await expect(store.markRunningTasksInterrupted()).resolves.toBe(1)
      const recovered = await store.getPlan('plan-1')

      expect(recovered?.tasks[0].status).toBe('interrupted')
      expect(recovered?.tasks[1].status).toBe('completed')
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})

function createPlan(): CollaborationPlan {
  return {
    id: 'plan-1',
    expertTeamId: 'team-1',
    title: 'Plan',
    description: 'Test plan',
    status: 'in_progress',
    tasks: [{
      id: 'task-1',
      planId: 'plan-1',
      title: 'Task',
      description: 'Do the work',
      assignedExpertId: 'expert-1',
      status: 'in_progress',
      dependencies: [],
      blockedBy: [],
      priority: 5,
      threadId: 'thread-1',
      turnId: 'turn-1',
      attempt: 1,
      previousAttempts: [],
      createdAt: new Date(0).toISOString(),
      startedAt: new Date(1).toISOString(),
      metadata: {}
    }],
    limits: {
      maxConcurrentTasks: 3,
      maxTotalTasks: 50,
      taskTimeoutSeconds: 600,
      clarificationTimeoutSeconds: 300
    },
    createdAt: new Date(0).toISOString(),
    metadata: {}
  }
}
