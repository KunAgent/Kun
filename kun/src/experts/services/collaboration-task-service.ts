import type {
  CollaborationPlan,
  CollaborationTask,
  CollaborationTaskStatus
} from '../contracts/collaboration.js'
import { CollaborationStore } from './collaboration-store.js'
import { CollaborationPlanService } from './collaboration-plan-service.js'

/**
 * EXT-SEAM: Collaboration task service.
 *
 * Handles task dispatch, lifecycle management, and clarification workflows.
 */

export interface CollaborationTaskServiceOptions {
  store: CollaborationStore
  planService: CollaborationPlanService
  startTask: (task: CollaborationTask) => Promise<{ threadId: string; turnId: string }>
  cancelTask: (threadId: string, turnId?: string) => Promise<void>
}

export class CollaborationTaskService {
  private readonly store: CollaborationStore
  private readonly planService: CollaborationPlanService
  private readonly startTask: (task: CollaborationTask) => Promise<{ threadId: string; turnId: string }>
  private readonly cancelTask: (threadId: string, turnId?: string) => Promise<void>

  constructor(options: CollaborationTaskServiceOptions) {
    this.store = options.store
    this.planService = options.planService
    this.startTask = options.startTask
    this.cancelTask = options.cancelTask
  }

  async getTask(taskId: string, planId: string): Promise<CollaborationTask | null> {
    const plan = await this.store.getPlan(planId)
    if (!plan) return null
    return plan.tasks.find((t) => t.id === taskId) || null
  }

  async updateTaskStatus(
    planId: string,
    taskId: string,
    status: CollaborationTaskStatus,
    updates?: Partial<CollaborationTask>
  ): Promise<CollaborationTask | null> {
    const plan = await this.store.updateTask(planId, taskId, {
      status,
      ...updates
    })
    if (!plan) return null

    const task = plan.tasks.find((t) => t.id === taskId)
    if (!task) return null

    // Update dependent tasks' blockedBy
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      await this.updateDependentTasks(plan, taskId)
    }

    return task
  }

  async assignTask(
    planId: string,
    taskId: string,
    expertId: string
  ): Promise<CollaborationTask | null> {
    const plan = await this.store.updateTask(planId, taskId, {
      assignedExpertId: expertId,
      status: 'assigned'
    })
    if (!plan) return null
    return plan.tasks.find((t) => t.id === taskId) || null
  }

  async dispatchTask(planId: string, taskId: string): Promise<CollaborationTask | null> {
    const plan = await this.store.getPlan(planId)
    if (!plan) return null

    const task = plan.tasks.find((t) => t.id === taskId)
    if (!task) return null

    // Verify task is ready
    if (task.status !== 'pending' && task.status !== 'assigned') {
      throw new Error(`Cannot dispatch task ${taskId} in status ${task.status}`)
    }

    if (task.blockedBy.length > 0) {
      throw new Error(`Task ${taskId} is blocked by dependencies: ${task.blockedBy.join(', ')}`)
    }

    if (!task.assignedExpertId) {
      throw new Error(`Task ${taskId} has no assigned expert`)
    }

    // Start the task (creates Kun thread)
    const { threadId, turnId } = await this.startTask(task)

    // Update task status
    return this.updateTaskStatus(planId, taskId, 'in_progress', {
      threadId,
      turnId,
      attempt: task.attempt + 1,
      startedAt: new Date().toISOString()
    })
  }

  async completeTask(
    planId: string,
    taskId: string,
    result: string
  ): Promise<CollaborationTask | null> {
    return this.updateTaskStatus(planId, taskId, 'completed', {
      result,
      completedAt: new Date().toISOString()
    })
  }

  async failTask(
    planId: string,
    taskId: string,
    error: string
  ): Promise<CollaborationTask | null> {
    return this.updateTaskStatus(planId, taskId, 'failed', {
      error,
      completedAt: new Date().toISOString()
    })
  }

  async requestClarification(
    planId: string,
    taskId: string,
    prompt: string
  ): Promise<CollaborationTask | null> {
    return this.updateTaskStatus(planId, taskId, 'clarification_needed', {
      clarificationPrompt: prompt
    })
  }

  async answerClarification(
    planId: string,
    taskId: string,
    answer: string
  ): Promise<CollaborationTask | null> {
    const task = await this.getTask(taskId, planId)
    if (!task) return null

    if (task.status !== 'clarification_needed') {
      throw new Error(`Task ${taskId} is not waiting for clarification`)
    }

    // Resume task with answer
    return this.updateTaskStatus(planId, taskId, 'in_progress', {
      clarificationResponse: answer
    })
  }

  async cancelTaskExecution(planId: string, taskId: string): Promise<CollaborationTask | null> {
    const task = await this.getTask(taskId, planId)
    if (!task) return null

    if (task.threadId) {
      await this.cancelTask(task.threadId, task.turnId)
    }

    return this.updateTaskStatus(planId, taskId, 'cancelled', {
      completedAt: new Date().toISOString()
    })
  }

  async interruptTaskExecution(planId: string, taskId: string): Promise<CollaborationTask | null> {
    const task = await this.getTask(taskId, planId)
    if (!task) return null
    if (task.status === 'interrupted') return task
    if (!['in_progress', 'retrying', 'paused', 'clarification_needed'].includes(task.status)) {
      throw new Error(`Cannot interrupt task ${taskId} in status ${task.status}`)
    }
    if (task.threadId) await this.cancelTask(task.threadId, task.turnId)
    return this.updateTaskStatus(planId, taskId, 'interrupted', {
      completedAt: undefined,
      metadata: { ...task.metadata, interruptedAt: new Date().toISOString() }
    })
  }

  async retryTaskExecution(planId: string, taskId: string): Promise<CollaborationTask | null> {
    const task = await this.getTask(taskId, planId)
    if (!task) return null
    if (task.status !== 'failed' && task.status !== 'interrupted' && task.status !== 'paused') {
      throw new Error(`Cannot retry task ${taskId} in status ${task.status}`)
    }
    const endedAt = new Date().toISOString()
    const previousAttempts = task.threadId && task.turnId
      ? [
          ...task.previousAttempts,
          {
            attempt: Math.max(1, task.attempt),
            threadId: task.threadId,
            turnId: task.turnId,
            status: task.status,
            ...(task.startedAt ? { startedAt: task.startedAt } : {}),
            endedAt
          }
        ]
      : task.previousAttempts
    await this.updateTaskStatus(planId, taskId, 'retrying', {
      error: undefined,
      threadId: undefined,
      turnId: undefined,
      completedAt: undefined,
      previousAttempts,
      metadata: { ...task.metadata, retryCount: Number(task.metadata.retryCount ?? 0) + 1 }
    })
    await this.updateTaskStatus(planId, taskId, 'assigned')
    return this.dispatchTask(planId, taskId)
  }

  private async updateDependentTasks(plan: CollaborationPlan, completedTaskId: string): Promise<void> {
    // Find tasks that depend on the completed task
    const dependentTasks = plan.tasks.filter((t) => t.dependencies.includes(completedTaskId))

    for (const task of dependentTasks) {
      // Remove completed task from blockedBy
      const updatedBlockedBy = task.blockedBy.filter((id) => id !== completedTaskId)

      await this.store.updateTask(plan.id, task.id, {
        blockedBy: updatedBlockedBy
      })
    }
  }
}
