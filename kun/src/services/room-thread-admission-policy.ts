import type { ThreadRecord } from '../contracts/threads.js'
import type { StartTurnRequest } from '../contracts/turns.js'
import { TurnConflictError } from './turn-service-core.js'

/** Public and internal admission share this frozen room-member capability ceiling. */
export function assertRoomTurnAdmission(thread: ThreadRecord, request: StartTurnRequest): void {
  if (!thread.roomContext) return
  const frozen = ['approvalPolicy', 'sandboxMode', 'approvalReviewer', 'model', 'providerId', 'accountId', 'mode'] as const
  if (frozen.some((key) => request[key] !== undefined && request[key] !== thread[key]) ||
    request.orchestration === 'graph' || request.guiPlan || request.guiDesignMode ||
    request.guiDesignCanvas || request.guiDesignArtifact || request.designDocumentTarget || request.writeContext ||
    (request.agentSurface !== undefined && request.agentSurface !== 'code')) {
    throw new TurnConflictError('room thread execution policy is frozen; submit changes through its room task')
  }
}
