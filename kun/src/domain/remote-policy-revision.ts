import { createHash } from 'node:crypto'
import type { ThreadRecord, ThreadGoal } from '../contracts/threads.js'
export class PolicyMutationRejected extends Error {
  constructor(readonly code: 'REVISION_CONFLICT' | 'TASK_BUSY' | 'INVALID_REQUEST' | 'NOT_FOUND') { super(code) }
}
export function policyHash(prefix: string, value: unknown): string {
  return prefix + ':' + createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
/** Usage accounting is deliberately excluded; only user-visible goal policy participates. */
export function goalRevision(goal: ThreadGoal | null | undefined, generation = 0): string {
  return policyHash('goal-v1', [generation, goal ? [goal.objective, goal.status, goal.tokenBudget ?? null, goal.createdAt] : null])
}
export function queueRevision(thread: ThreadRecord): string {
  return policyHash('queue-v1', [thread.queueControl ?? null, thread.queueResumeSourceTurnId ?? null,
    thread.turns.filter((t) => t.status === 'queued').map((t) => [t.id, t.clientSurface ?? null,
      t.clientRequestFingerprint ?? null, Boolean(t.admissionPending), t.attachmentIds,
      t.queueEdit?.revision ?? 0, t.queueEdit?.pending?.operationId ?? null])])
}
export function requirePolicyRevision(actual: string, expected?: string): void {
  if (expected !== undefined && actual !== expected) throw new PolicyMutationRejected('REVISION_CONFLICT')
}
