import type { CommitmentControl, CollaborationPolicy } from '../../contracts/collaboration-followup.js'
import { FollowUpError } from './state.js'

const DAY_MS = 86_400_000
export type FollowUpBudget = CommitmentControl['budget']

/** Lifetime totals never reset; only the rolling window does. */
export function rollBudget(budget: FollowUpBudget, now: string): FollowUpBudget {
  if (now < budget.windowEnd) return budget
  return { ...budget, windowStart: now, windowEnd: new Date(Date.parse(now) + DAY_MS).toISOString(), consumed: 0 }
}

/**
 * Refuses a new attempt when the policy budget is spent. Staging already permits only
 * one unsettled outcome, so this check cannot be raced between check and dispatch.
 */
export function assertBudget(policy: CollaborationPolicy, control: CommitmentControl, now: string): void {
  const budget = rollBudget(control.budget, now), limits = policy.limits
  if (budget.consumed >= limits.attemptsPerDay) {
    throw new FollowUpError('BUDGET_EXHAUSTED', 'daily follow-up attempt budget is exhausted')
  }
  if (budget.totalConsumed >= limits.attemptsTotal) {
    throw new FollowUpError('BUDGET_EXHAUSTED', 'total follow-up attempt budget is exhausted')
  }
  const last = budget.lastAttemptAt
  if (last && Date.parse(now) - Date.parse(last) < limits.minimumIntervalMs) {
    throw new FollowUpError('BUDGET_EXHAUSTED', 'minimum interval between follow-up attempts has not elapsed')
  }
}

/** A dispatched attempt stays spent even when transport retries the same attempt id. */
export function consumeAttempt(control: CommitmentControl, now: string): CommitmentControl {
  const budget = rollBudget(control.budget, now)
  return { ...control, updatedAt: now, budget: { ...budget,
    consumed: budget.consumed + 1, totalConsumed: budget.totalConsumed + 1, lastAttemptAt: now } }
}
