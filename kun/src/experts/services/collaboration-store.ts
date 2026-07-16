import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  CollaborationPlan,
  CollaborationTask,
  CollaborationPlanStatus
} from '../contracts/collaboration.js'

/**
 * EXT-SEAM: Collaboration plan/task persistence.
 *
 * Stores plans and tasks as JSON files in dataDir/collaboration/.
 * Each plan gets its own file: {planId}.json
 */

export interface CollaborationStoreOptions {
  dataDir: string
}

export class CollaborationStore {
  private readonly plansDir: string

  constructor(options: CollaborationStoreOptions) {
    this.plansDir = join(options.dataDir, 'collaboration', 'plans')
  }

  async ensureDir(): Promise<void> {
    await mkdir(this.plansDir, { recursive: true })
  }

  async savePlan(plan: CollaborationPlan): Promise<void> {
    await this.ensureDir()
    const filePath = join(this.plansDir, `${plan.id}.json`)
    await writeFile(filePath, JSON.stringify(plan, null, 2), 'utf-8')
  }

  async getPlan(planId: string): Promise<CollaborationPlan | null> {
    const filePath = join(this.plansDir, `${planId}.json`)
    try {
      const content = await readFile(filePath, 'utf-8')
      return JSON.parse(content) as CollaborationPlan
    } catch {
      return null
    }
  }

  async listPlans(): Promise<CollaborationPlan[]> {
    await this.ensureDir()
    const files = (await readdir(this.plansDir)).filter((name) => name.endsWith('.json')).sort()
    const plans = await Promise.all(files.map((name) => this.getPlan(name.slice(0, -5))))
    return plans.filter((plan): plan is CollaborationPlan => plan !== null)
  }

  async markRunningTasksInterrupted(): Promise<number> {
    const plans = await this.listPlans()
    let changed = 0
    for (const plan of plans) {
      let planChanged = false
      plan.tasks = plan.tasks.map((task) => {
        if (task.status !== 'in_progress') return task
        changed += 1
        planChanged = true
        return {
          ...task,
          status: 'interrupted' as const,
          metadata: { ...task.metadata, interruptedAt: new Date().toISOString(), interruptionReason: 'runtime_restart' }
        }
      })
      if (planChanged) await this.savePlan(plan)
    }
    return changed
  }

  async updatePlan(
    planId: string,
    updates: Partial<CollaborationPlan>
  ): Promise<CollaborationPlan | null> {
    const plan = await this.getPlan(planId)
    if (!plan) return null

    const updated = { ...plan, ...updates }
    await this.savePlan(updated)
    return updated
  }

  async updateTask(
    planId: string,
    taskId: string,
    updates: Partial<CollaborationTask>
  ): Promise<CollaborationPlan | null> {
    const plan = await this.getPlan(planId)
    if (!plan) return null

    const taskIndex = plan.tasks.findIndex((t) => t.id === taskId)
    if (taskIndex === -1) return null

    plan.tasks[taskIndex] = { ...plan.tasks[taskIndex], ...updates }
    await this.savePlan(plan)
    return plan
  }

  async updatePlanStatus(
    planId: string,
    status: CollaborationPlanStatus,
    timestamp?: string
  ): Promise<CollaborationPlan | null> {
    const plan = await this.getPlan(planId)
    if (!plan) return null

    const updates: Partial<CollaborationPlan> = { status }
    const now = timestamp || new Date().toISOString()

    if (status === 'in_progress' && !plan.startedAt) {
      updates.startedAt = now
    } else if (status === 'completed' && !plan.completedAt) {
      updates.completedAt = now
    } else if (status === 'cancelled' && !plan.cancelledAt) {
      updates.cancelledAt = now
    }

    return this.updatePlan(planId, updates)
  }
}
