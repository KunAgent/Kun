import type { ThreadRecord } from '../contracts/threads.js'
import type { StartTurnRequest } from '../contracts/turns.js'
import {
  DesignDocumentTargetSchema,
  DesignTaskProfileInputSchema,
  type DesignDocumentTarget,
  type DesignTaskProfile
} from '../contracts/design-task-profile.js'
import {
  lockDesignTaskProfile,
  sameDesignDocumentTarget,
  sameDesignTaskProfile
} from '../domain/design-task-profile.js'
import { legacyThreadCanClaimWrite } from '../domain/thread.js'
import { resolveThreadLockedTaskSurface } from '../domain/task-surface-lock.js'
import {
  DesignProfileLockedError,
  TaskSurfaceLockedError,
  TurnConflictError
} from './turn-service-core.js'

export type DesignTurnAdmission = {
  effectiveSurface?: 'code' | 'write' | 'design'
  effectiveProfile?: DesignTaskProfile
  effectiveDocumentTarget?: DesignDocumentTarget
  locksSurface: boolean
  locksProfile: boolean
}

export { legacyThreadCanClaimWrite } from '../domain/thread.js'

/**
 * Resolve all task/profile ownership before any attachment binding, document
 * commit, model turn, item, or event is created. The caller runs this while it
 * owns the per-thread mutation lock, making the returned lock decisions atomic.
 */
export function resolveDesignTurnAdmission(input: {
  thread: ThreadRecord
  request: StartTurnRequest
  turnId: string
}): DesignTurnAdmission {
  const requestedSurface = input.request.agentSurface
  const threadSurface = input.thread.agentSurface
  // Code owns unified workbench records, while the first accepted turn owns
  // the immutable Code/Design task mode. Legacy standalone Design and Work
  // records remain fixed to their persisted thread surface.
  const legacyWriteClaim = requestedSurface === 'write' && legacyThreadCanClaimWrite(input.thread)
  const lockedTaskSurface = legacyWriteClaim
    ? undefined
    : resolveThreadLockedTaskSurface(input.thread)
  if (
    lockedTaskSurface &&
    requestedSurface &&
    lockedTaskSurface !== requestedSurface
  ) {
    throw new TaskSurfaceLockedError(lockedTaskSurface, requestedSurface)
  }

  // Legacy records may not have ownership metadata. Claim those on their
  // first explicit surfaced turn; unified workbench threads are created as
  // Code-owned before this point and therefore keep that ownership in Design.
  const locksSurface = !threadSurface && Boolean(requestedSurface) && (
    input.thread.turns.length === 0 || legacyWriteClaim
  )
  // Legacy callers that omit the mode inherit the already-selected task mode.
  // Before the first turn, an explicitly Code-owned workbench still defaults
  // to Code while remaining editable in the renderer.
  const effectiveSurface = requestedSurface ?? lockedTaskSurface ?? threadSurface ?? 'code'
  const rawProfile = input.request.designProfile
  const rawTarget = input.request.designDocumentTarget
  if (Boolean(rawProfile) !== Boolean(rawTarget)) {
    throw new TurnConflictError('designProfile and designDocumentTarget must be supplied together')
  }

  const submittedProfile = rawProfile
    ? DesignTaskProfileInputSchema.parse(rawProfile)
    : undefined
  const submittedTarget = rawTarget
    ? DesignDocumentTargetSchema.parse(rawTarget)
    : undefined
  if (
    submittedProfile &&
    submittedTarget &&
    !sameDesignDocumentTarget(submittedProfile.documentTarget, submittedTarget)
  ) {
    throw new TurnConflictError('designDocumentTarget must match designProfile.documentTarget')
  }

  if (submittedProfile && effectiveSurface !== 'design') {
    if (lockedTaskSurface) throw new TaskSurfaceLockedError(lockedTaskSurface, 'design')
    throw new TurnConflictError('a Design profile requires a Design turn')
  }

  const lockedProfile = input.thread.designProfile
  if (lockedProfile) {
    if (effectiveSurface === 'code') {
      if (submittedProfile || submittedTarget) {
        throw new TurnConflictError('a Code turn cannot submit a Design profile or document target')
      }
      return { effectiveSurface, locksSurface, locksProfile: false }
    }
    if (effectiveSurface !== 'design') {
      throw new TurnConflictError('a locked Design profile requires a Code or Design turn')
    }
    if (submittedProfile && !sameDesignTaskProfile(lockedProfile, submittedProfile)) {
      throw new DesignProfileLockedError(lockedProfile.lockedAtTurnId, {
        lockedDocumentId: lockedProfile.documentTarget.documentId,
        lockedBoardArtifactId: lockedProfile.documentTarget.boardArtifactId,
        mismatch: 'profile'
      })
    }
    if (
      submittedTarget &&
      !sameDesignDocumentTarget(lockedProfile.documentTarget, submittedTarget)
    ) {
      throw new DesignProfileLockedError(lockedProfile.lockedAtTurnId, {
        lockedDocumentId: lockedProfile.documentTarget.documentId,
        lockedBoardArtifactId: lockedProfile.documentTarget.boardArtifactId,
        mismatch: 'document-target'
      })
    }
    return {
      effectiveSurface,
      effectiveProfile: lockedProfile,
      effectiveDocumentTarget: lockedProfile.documentTarget,
      locksSurface,
      locksProfile: false
    }
  }

  if (effectiveSurface !== 'design') {
    return { effectiveSurface, locksSurface, locksProfile: false }
  }
  if (!submittedProfile || !submittedTarget) {
    throw new TurnConflictError('the first accepted Design turn requires a Design profile and document target')
  }
  const effectiveProfile = lockDesignTaskProfile(submittedProfile, input.turnId)
  return {
    effectiveSurface,
    effectiveProfile,
    effectiveDocumentTarget: effectiveProfile.documentTarget,
    locksSurface,
    locksProfile: true
  }
}
