import type { ThreadGoal, ThreadRecord } from '../contracts/threads.js'

/** Private-room autonomous continuations always have a host-owned ceiling.
 * Explicit user token limits may narrow it, never silently remove it. */
export const ROOM_GOAL_MAX_TOKENS = 250_000
export const ROOM_GOAL_MAX_TIME_SECONDS = 3_600
export const ROOM_GOAL_MAX_NO_PROGRESS_TOOLS = 32

export function isPrivateRoomGoal(thread: ThreadRecord): boolean {
  return thread.roomContext?.kind === 'conversation'
}

export function goalTokenLimit(thread: ThreadRecord): number | undefined {
  const configured = thread.goal?.tokenBudget ?? undefined
  return isPrivateRoomGoal(thread) ? Math.min(configured ?? Infinity, ROOM_GOAL_MAX_TOKENS) : configured
}

export function goalBudgetStatus(thread: ThreadRecord, goal: ThreadGoal): ThreadGoal['status'] {
  if (goal.status !== 'active') return goal.status
  const limit = goalTokenLimit(thread)
  if (limit !== undefined && goal.tokensUsed >= limit) return 'usageLimited'
  if (isPrivateRoomGoal(thread) && goal.timeUsedSeconds >= ROOM_GOAL_MAX_TIME_SECONDS) return 'budgetLimited'
  return goal.status
}

export function goalBudgetMessage(thread: ThreadRecord, status = thread.goal?.status): string {
  return status === 'budgetLimited'
    ? `Goal active-time budget exhausted (${ROOM_GOAL_MAX_TIME_SECONDS} seconds). Review the result before creating a new goal.`
    : `Goal token budget exhausted: ${thread.goal?.tokensUsed ?? 0} used of ${goalTokenLimit(thread) ?? 0}.`
}
