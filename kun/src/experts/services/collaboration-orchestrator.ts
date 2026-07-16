import type {
  CollaborationPlan,
  CollaborationTask,
  CollaborationState
} from '../contracts/collaboration.js'
import { CollaborationStore } from './collaboration-store.js'
import { CollaborationPlanService } from './collaboration-plan-service.js'
import { CollaborationTaskService } from './collaboration-task-service.js'

/**
 * EXT-SEAM: Collaboration orchestrator.
 *
 * Coordinates task dispatch with dependency resolution, concurrency limits,
 * and plan lifecycle management.
 */

export interface CollaborationOrchestratorOptions {
  store: CollaborationStore
  planService: CollaborationPlanService
  taskService: CollaborationTaskService
}

export class CollaborationOrchestrator {
  private readonly store: CollaborationStore
  private readonly planService: CollaborationPlanService
  private readonly taskService: CollaborationTaskService

  constructor(options: CollaborationOrchestratorOptions) {
    this.store = options.store
    this.planService = options.planService
    this.taskService = options.taskService
  }

  async startPlan(planId: string): Promise<CollaborationPlan | null> {
    const plan = await this.store.getPlan(planId)
    if (!plan) return null

    if (plan.status !== 'confirmed') {
      throw new Error(`Cannot start plan ${planId} in status ${plan.status}`)
    }

    // Update plan status
    await this.store.updatePlanStatus(planId, 'in_progress')

    // Dispatch initial tasks (no dependencies, ready to run)
    await this.dispatchReadyTasks(planId)

    return this.store.getPlan(planId)
  }

  async dispatchReadyTasks(planId: string): Promise<void> {
    const plan = await this.store.getPlan(planId)
    if (!plan) return

    const state = await this.planService.getState(planId)
    if (!state) return

    // Check concurrency limit
    const availableSlots = plan.limits.maxConcurrentTasks - state.inProgressTasks
    if (availableSlots <= 0) return

    // Get tasks ready to dispatch (pending, no blockers, assigned)
    const readyTasks = plan.tasks
      .filter(
        (t) =>
          t.status === 'pending' &&
          t.blockedBy.length === 0 &&
          t.assignedExpertId
      )
      .sort((a, b) => b.priority - a.priority) // Higher priority first
      .slice(0, availableSlots)

    // Dispatch each ready task
    for (const task of readyTasks) {
      try {
        await this.taskService.dispatchTask(planId, task.id)
      } catch (err) {
        await this.taskService.failTask(planId, task.id, String(err))
      }
    }
  }

  async onTaskCompleted(planId: string, taskId: string, result: string): Promise<void> {
    // Mark task as completed
    await this.taskService.completeTask(planId, taskId, result)

    // Check if plan is complete
    await this.checkPlanCompletion(planId)

    // Dispatch next ready tasks
    await this.dispatchReadyTasks(planId)
  }

  async onTaskFailed(planId: string, taskId: string, error: string): Promise<void> {
    // Mark task as failed
    await this.taskService.failTask(planId, taskId, error)

    // Check if plan should fail (critical task failed)
    const plan = await this.store.getPlan(planId)
    if (!plan) return

    const task = plan.tasks.find((t) => t.id === taskId)
    if (!task) return

    // If task has no dependents, continue with other tasks
    const hasDependents = plan.tasks.some((t) => t.dependencies.includes(taskId))
    if (!hasDependents) {
      await this.dispatchReadyTasks(planId)
      return
    }

    // Critical task failed - fail the plan
    await this.store.updatePlanStatus(planId, 'failed')
  }

  async onClarificationNeeded(
    planId: string,
    taskId: string,
    prompt: string
  ): Promise<void> {
    await this.taskService.requestClarification(planId, taskId, prompt)
    // Dispatch other ready tasks while waiting for clarification
    await this.dispatchReadyTasks(planId)
  }

  async answerClarification(planId: string, taskId: string, answer: string): Promise<void> {
    await this.taskService.answerClarification(planId, taskId, answer)
    // Resume the task (it's now back in in_progress)
    // The actual resumption happens in the task's thread
  }

  async terminatePlan(planId: string, reason?: string): Promise<void> {
    const plan = await this.store.getPlan(planId)
    if (!plan) return

    // Cancel all in-progress tasks
    const inProgressTasks = plan.tasks.filter((t) => t.status === 'in_progress')
    for (const task of inProgressTasks) {
      await this.taskService.cancelTaskExecution(planId, task.id)
    }

    // Cancel the plan
    await this.planService.cancelPlan(planId, reason)
  }

  async getState(planId: string): Promise<CollaborationState | null> {
    return this.planService.getState(planId)
  }

  private async checkPlanCompletion(planId: string): Promise<void> {
    const state = await this.planService.getState(planId)
    if (!state) return

    // Plan is complete if all tasks are in terminal states
    const allComplete =
      state.completedTasks + state.failedTasks + state.clarificationNeededTasks ===
      state.totalTasks

    if (allComplete && state.failedTasks === 0) {
      await this.store.updatePlanStatus(planId, 'completed')
    } else if (allComplete && state.failedTasks > 0) {
      await this.store.updatePlanStatus(planId, 'failed')
    }
  }
}
