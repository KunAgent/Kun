import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { goalRevision, PolicyMutationRejected, requirePolicyRevision } from '../../domain/remote-policy-revision.js'
import { RemoteNoEffect } from '../requests/rejections.js'
import { requireCode } from '../code/access.js'
export class RemoteGoals {
  constructor(private runtime: ServerRuntime) {}
  async preflight(method: string, p: any) {
    let thread
    try { thread = await requireCode(this.runtime, p.threadId) }
    catch (error) {
      if (error instanceof Error && ['NOT_FOUND', 'NOT_A_CODE_TASK'].includes(error.message))
        throw new RemoteNoEffect(error.message as 'NOT_FOUND' | 'NOT_A_CODE_TASK')
      throw error
    }
    requirePolicyRevision(goalRevision(thread.goal, thread.goalPolicyRevision), p.expectedRevision)
    if (method === 'goal.update' && p.objective !== undefined && !p.objective.trim()) throw new RemoteNoEffect('INVALID_REQUEST')
  }
  async goal(threadId: string) {
    const thread = await requireCode(this.runtime, threadId), goal = thread.goal ?? null
    return { threadId, revision: goalRevision(goal, thread.goalPolicyRevision), goal }
  }
  async dispatch(method: string, p: any): Promise<unknown> {
    try {
      await this.preflight(method, p)
      switch (method) {
        case 'goal.get': return this.goal(p.threadId)
        case 'goal.update': {
          const { threadId, expectedRevision, ...request } = p
          await this.runtime.threadService.setGoal(threadId, request, { expectedRevision })
          return this.goal(threadId)
        }
        case 'goal.clear':
          await this.runtime.threadService.clearGoal(p.threadId, { expectedRevision: p.expectedRevision })
          return this.goal(p.threadId)
        default: throw new RemoteNoEffect('INVALID_REQUEST')
      }
    } catch (error) {
      if (error instanceof PolicyMutationRejected) throw new RemoteNoEffect(error.code)
      throw error
    }
  }
}
