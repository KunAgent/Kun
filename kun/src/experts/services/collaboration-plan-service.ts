import { randomUUID } from 'node:crypto'
import {
  CollaborationPlanSchema,
  CreateCollaborationPlanSchema,
  type CollaborationPlan,
  type CreateCollaborationPlan,
  type CollaborationTask,
  type CollaborationState
} from '../contracts/collaboration.js'
import { CollaborationStore } from './collaboration-store.js'

/**
 * EXT-SEAM: Collaboration plan service.
 *
 * Handles plan CRUD, validation, and confirmation.
 */

export interface CollaborationPlanServiceOptions {
  store: CollaborationStore
}

export class CollaborationPlanService {
  private readonly store: CollaborationStore

  constructor(options: CollaborationPlanServiceOptions) {
    this.store = options.store
  }

  async createPlan(input: CreateCollaborationPlan): Promise<CollaborationPlan> {
    // Validate input
    const validated = CreateCollaborationPlanSchema.parse(input)

    // Generate IDs
    const planId = randomUUID()
    const taskIds = validated.tasks.map(() => randomUUID())

    // Build tasks
    const tasks: CollaborationTask[] = validated.tasks.map((taskInput, index) => ({
      id: taskIds[index],
      planId,
      title: taskInput.title,
      description: taskInput.description,
      assignedExpertId: taskInput.assignedExpertId,
      status: 'pending' as const,
      dependencies: taskInput.dependencies,
      blockedBy: [],
      priority: taskInput.priority,
      attempt: 0,
      previousAttempts: [],
      dependencyRevision: 0,
      createdAt: new Date().toISOString(),
      metadata: {}
    }))

    // Compute blockedBy (reverse dependencies)
    for (const task of tasks) {
      for (const depId of task.dependencies) {
        const depTask = tasks.find((t) => t.id === depId)
        if (depTask) {
          task.blockedBy.push(depId)
        }
      }
    }

    // Build plan
    const plan: CollaborationPlan = {
      id: planId,
      expertTeamId: validated.expertTeamId,
      title: validated.title,
      description: validated.description,
      status: 'draft',
      tasks,
      limits: validated.limits || {
        maxConcurrentTasks: 3,
        maxTotalTasks: 50,
        taskTimeoutSeconds: 600,
        clarificationTimeoutSeconds: 300
      },
      createdAt: new Date().toISOString(),
      metadata: {}
    }

    // Validate full schema
    const validatedPlan = CollaborationPlanSchema.parse(plan)

    // Persist
    await this.store.savePlan(validatedPlan)

    return validatedPlan
  }

  async getPlan(planId: string): Promise<CollaborationPlan | null> {
    return this.store.getPlan(planId)
  }

  async listPlans(): Promise<CollaborationPlan[]> {
    return this.store.listPlans()
  }

  async confirmPlan(planId: string): Promise<CollaborationPlan | null> {
    const plan = await this.store.getPlan(planId)
    if (!plan) return null

    if (plan.status !== 'draft') {
      throw new Error(`Cannot confirm plan ${planId} in status ${plan.status}`)
    }

    // Validate plan structure
    this.validatePlanStructure(plan)

    // Update status
    return this.store.updatePlan(planId, {
      status: 'confirmed',
      confirmedAt: new Date().toISOString()
    })
  }

  async cancelPlan(planId: string, reason?: string): Promise<CollaborationPlan | null> {
    const plan = await this.store.getPlan(planId)
    if (!plan) return null

    if (plan.status === 'completed' || plan.status === 'cancelled') {
      throw new Error(`Cannot cancel plan ${planId} in status ${plan.status}`)
    }

    return this.store.updatePlan(planId, {
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
      metadata: { ...plan.metadata, cancelReason: reason }
    })
  }

  async getState(planId: string): Promise<CollaborationState | null> {
    const plan = await this.store.getPlan(planId)
    if (!plan) return null

    const completed = plan.tasks.filter((t) => t.status === 'completed')
    const failed = plan.tasks.filter((t) => t.status === 'failed')
    const pending = plan.tasks.filter((t) => t.status === 'pending')
    const inProgress = plan.tasks.filter((t) => t.status === 'in_progress')
    const clarification = plan.tasks.filter((t) => t.status === 'clarification_needed')
    const paused = plan.tasks.filter((t) => t.status === 'paused')
    const interrupted = plan.tasks.filter((t) => t.status === 'interrupted')

    const runningTaskIds = inProgress.map((t) => t.id)
    const blockedTaskIds = plan.tasks.filter((t) => t.blockedBy.length > 0).map((t) => t.id)
    const nextTaskIds = plan.tasks
      .filter((t) => t.status === 'pending' && t.blockedBy.length === 0)
      .map((t) => t.id)

    return {
      planId: plan.id,
      status: plan.status,
      totalTasks: plan.tasks.length,
      completedTasks: completed.length,
      failedTasks: failed.length,
      pendingTasks: pending.length,
      inProgressTasks: inProgress.length,
      clarificationNeededTasks: clarification.length,
      pausedTasks: paused.length,
      interruptedTasks: interrupted.length,
      runningTaskIds,
      blockedTaskIds,
      nextTaskIds
    }
  }

  private validatePlanStructure(plan: CollaborationPlan): void {
    // Check task count
    if (plan.tasks.length === 0) {
      throw new Error('Plan must have at least one task')
    }

    if (plan.tasks.length > plan.limits.maxTotalTasks) {
      throw new Error(`Plan exceeds max tasks: ${plan.tasks.length} > ${plan.limits.maxTotalTasks}`)
    }

    // Check for cycles in dependencies
    const visited = new Set<string>()
    const recStack = new Set<string>()

    const hasCycle = (taskId: string): boolean => {
      if (recStack.has(taskId)) return true
      if (visited.has(taskId)) return false

      visited.add(taskId)
      recStack.add(taskId)

      const task = plan.tasks.find((t) => t.id === taskId)
      if (task) {
        for (const depId of task.dependencies) {
          if (hasCycle(depId)) return true
        }
      }

      recStack.delete(taskId)
      return false
    }

    for (const task of plan.tasks) {
      if (hasCycle(task.id)) {
        throw new Error(`Circular dependency detected in task ${task.id}`)
      }
    }

    // Check all dependencies exist
    const taskIds = new Set(plan.tasks.map((t) => t.id))
    for (const task of plan.tasks) {
      for (const depId of task.dependencies) {
        if (!taskIds.has(depId)) {
          throw new Error(`Task ${task.id} depends on non-existent task ${depId}`)
        }
      }
    }
  }
}
