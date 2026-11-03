import type { ThreadGoal, SetThreadGoalRequest } from '../contracts/threads.js'
import { touchThread } from '../domain/thread.js'
import { goalRevision, requirePolicyRevision, PolicyMutationRejected } from '../domain/remote-policy-revision.js'
import { withManagerDataMutex } from '../manager/data-mutex.js'
import type { ThreadService } from './thread-service-core.js'

export const threadServiceGoalsOperations = {
async getGoal(this: ThreadService, threadId: string): Promise<ThreadGoal | null> {
    const current = await this['threadStore'].get(threadId)
    if (!current) throw new Error(`thread not found: ${threadId}`)
    return current.goal ?? null
  },

async setGoal(this: ThreadService, threadId: string, request: SetThreadGoalRequest, options?: { expectedRevision: string }): Promise<ThreadGoal> {
    const goal = await withManagerDataMutex(`thread:${threadId}`, () =>
      this['withThreadMutation'](threadId, async () => {
      const current = await this['threadStore'].get(threadId)
      if (!current) throw new Error(`thread not found: ${threadId}`)
      requirePolicyRevision(goalRevision(current.goal, current.goalPolicyRevision), options?.expectedRevision)
      if (options && !current.goal && !request.objective) throw new PolicyMutationRejected('INVALID_REQUEST')
      if (!current.goal && !request.objective) {
        throw new Error(`cannot update goal for thread ${threadId}: no goal exists`)
      }

      const now = this['nowIso']()
      const existing = current.goal
      const objective = request.objective?.trim()
      const next: ThreadGoal = {
        threadId,
        objective: objective ?? existing?.objective ?? '',
        status: request.status ?? (objective ? 'active' : existing?.status ?? 'active'),
        ...(request.tokenBudget !== undefined
          ? request.tokenBudget === null
            ? {}
            : { tokenBudget: request.tokenBudget }
          : existing?.tokenBudget !== undefined
            ? { tokenBudget: existing.tokenBudget }
            : {}),
        tokensUsed: existing?.tokensUsed ?? 0,
        timeUsedSeconds: existing?.timeUsedSeconds ?? 0,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      }

      const updated = touchThread({ ...current, goal: next, goalPolicyRevision: (current.goalPolicyRevision ?? 0) + 1 }, now)
      if (options && this['threadStore'].upsertIfRevision) {
        const result = await this['threadStore'].upsertIfRevision(updated, current.revision ?? 0)
        if (!result.applied) throw new PolicyMutationRejected('REVISION_CONFLICT')
      } else await this['threadStore'].upsert(updated)
      return next
    })
    )
    await this['events'].record({
      kind: 'goal_updated',
      threadId,
      goal
    })
    return goal
  },

/** Add provider-reported token usage to an active goal and enforce its cap. */
async recordGoalUsage(this: ThreadService, threadId: string, tokenDelta: number): Promise<ThreadGoal | null> {
    const delta = Math.max(0, Math.floor(tokenDelta))
    if (delta === 0) return this.getGoal(threadId)
    const goal = await withManagerDataMutex(`thread:${threadId}`, () => this['withThreadMutation'](threadId, async () => {
      const current = await this['threadStore'].get(threadId)
      if (!current?.goal || current.goal.status !== 'active') return current?.goal ?? null
      const nextTokens = current.goal.tokensUsed + delta
      const next: ThreadGoal = {
        ...current.goal,
        tokensUsed: nextTokens,
        status: current.goal.tokenBudget !== undefined && current.goal.tokenBudget !== null && nextTokens >= current.goal.tokenBudget
          ? 'usageLimited'
          : current.goal.status,
        updatedAt: this['nowIso']()
      }
      await this['threadStore'].upsert(touchThread({ ...current, goal: next }, next.updatedAt))
      return next
    }))
    if (!goal) return null
    await this['events'].record({ kind: 'goal_updated', threadId, goal })
    return goal
  },

async clearGoal(this: ThreadService, threadId: string, options?: { expectedRevision: string }): Promise<boolean> {
    const cleared = await withManagerDataMutex(`thread:${threadId}`, () => this['withThreadMutation'](threadId, async () => {
      const current = await this['threadStore'].get(threadId)
      if (!current) throw new Error(`thread not found: ${threadId}`)
      requirePolicyRevision(goalRevision(current.goal, current.goalPolicyRevision), options?.expectedRevision)
      if (!current.goal) return false
      const updated = touchThread({ ...current, goalPolicyRevision: (current.goalPolicyRevision ?? 0) + 1 }, this['nowIso']())
      delete (updated as { goal?: ThreadGoal }).goal
      if (options && this['threadStore'].upsertIfRevision) {
        const result = await this['threadStore'].upsertIfRevision(updated, current.revision ?? 0)
        if (!result.applied) throw new PolicyMutationRejected('REVISION_CONFLICT')
      } else await this['threadStore'].upsert(updated)
      return true
    }))
    if (!cleared) return false
    await this['events'].record({
      kind: 'goal_cleared',
      threadId,
      cleared: true
    })
    return true
  },
}
