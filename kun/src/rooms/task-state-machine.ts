import type { RoomTask, RoomTaskStatus } from '../contracts/room-tasks.js'

export class RoomTaskConflictError extends Error {
  readonly code = 'room_task_conflict'
}

export type TaskTransitionEvidence =
  | { kind: 'admitted'; turnId: string }
  | { kind: 'dependency'; satisfied: boolean }
  | { kind: 'input'; requestId: string }
  | { kind: 'approval'; approvalId: string }
  | { kind: 'cancel_requested' }
  | { kind: 'stopped'; executionConfirmedStopped: true }
  | { kind: 'delivery'; deliveryId: string; requiredReviewSatisfied: boolean }
  | { kind: 'accepted'; deliveryId: string }
  | { kind: 'failure'; reason: string }
  | { kind: 'recovery'; reason: string }
  | { kind: 'retry'; newAttemptId: string }

const allowed: Record<RoomTaskStatus, readonly RoomTaskStatus[]> = {
  queued: ['running', 'waiting_dependency', 'needs_input', 'cancelled', 'recovery_required', 'failed'],
  waiting_dependency: ['queued', 'needs_input', 'cancelled', 'recovery_required'],
  running: ['needs_input', 'needs_approval', 'stopping', 'awaiting_acceptance', 'failed', 'recovery_required'],
  needs_input: ['queued', 'stopping', 'cancelled', 'recovery_required'],
  needs_approval: ['queued', 'running', 'stopping', 'recovery_required'],
  recovery_required: ['queued', 'failed', 'cancelled'],
  stopping: ['cancelled', 'recovery_required'],
  awaiting_acceptance: ['completed', 'queued'],
  completed: ['queued'],
  failed: ['queued', 'cancelled'],
  cancelled: ['queued']
}

/** Business transitions require host evidence; assistant text is never an input. */
export function transitionRoomTask(input: {
  task: RoomTask
  expectedRevision: number
  next: RoomTaskStatus
  evidence: TaskTransitionEvidence
  now: string
}): RoomTask {
  const { task, expectedRevision, next, evidence, now } = input
  if (task.revision !== expectedRevision) throw new RoomTaskConflictError('stale task revision')
  if (!allowed[task.status].includes(next)) {
    throw new RoomTaskConflictError(`invalid task transition: ${task.status} -> ${next}`)
  }
  const valid = (() => {
    switch (next) {
      case 'running': return evidence.kind === 'admitted' && Boolean(evidence.turnId)
      case 'waiting_dependency': return evidence.kind === 'dependency' && !evidence.satisfied
      case 'needs_input': return evidence.kind === 'input' && Boolean(evidence.requestId)
      case 'needs_approval': return evidence.kind === 'approval' && Boolean(evidence.approvalId)
      case 'stopping': return evidence.kind === 'cancel_requested'
      case 'cancelled': return evidence.kind === 'stopped' && evidence.executionConfirmedStopped
      case 'awaiting_acceptance': return evidence.kind === 'delivery' &&
        Boolean(evidence.deliveryId) && evidence.requiredReviewSatisfied
      case 'completed': return evidence.kind === 'accepted' &&
        Boolean(task.latestDeliveryId) && evidence.deliveryId === task.latestDeliveryId
      case 'failed': return evidence.kind === 'failure' && Boolean(evidence.reason)
      case 'recovery_required': return evidence.kind === 'recovery' && Boolean(evidence.reason)
      case 'queued': return (evidence.kind === 'retry' && Boolean(evidence.newAttemptId)) ||
        (task.status === 'waiting_dependency' && evidence.kind === 'dependency' && evidence.satisfied)
    }
  })()
  if (!valid) throw new RoomTaskConflictError(`missing authoritative evidence for ${next}`)
  return {
    ...task, status: next, revision: task.revision + 1, updatedAt: now,
    ...(evidence.kind === 'delivery' ? { latestDeliveryId: evidence.deliveryId } : {}),
    ...(evidence.kind === 'accepted' ? { acceptedDeliveryId: evidence.deliveryId } : {})
  }
}

/** Acceptance and application intentionally do not participate in each other's state. */
export function currentReviewCoversDelivery(
  review: { deliveryId: string; versionHash: string; verdict: 'passed' | 'changes_requested' },
  delivery: { id: string; versionHash: string }
): boolean {
  return review.verdict === 'passed' && review.deliveryId === delivery.id &&
    review.versionHash === delivery.versionHash
}

export function mayAutomaticallyRework(input: {
  explicitlyAuthorized: boolean
  completedRounds: number
  maximumRounds: number
}): boolean {
  return input.explicitlyAuthorized && Number.isInteger(input.completedRounds) &&
    input.completedRounds >= 0 && Number.isInteger(input.maximumRounds) &&
    input.maximumRounds >= 0 && input.maximumRounds <= 2 &&
    input.completedRounds < input.maximumRounds
}
