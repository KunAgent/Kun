export function timelineTurnIsProcessing(input: {
  busy: boolean
  busyUnconfirmed?: boolean
  isLatestTurn: boolean
  isActiveTurn?: boolean
  turnPending: boolean
  hasLiveStream: boolean
  turnId?: string
  graphPlanningCorrectionTurnId?: string | null
}): boolean {
  if (
    input.graphPlanningCorrectionTurnId &&
    input.turnId === input.graphPlanningCorrectionTurnId
  ) {
    return false
  }
  // An unconfirmed busy flag comes from a persisted snapshot that claims a
  // running turn; until live events confirm it, render the history settled
  // instead of replaying live-progress UI over a finished conversation.
  if (input.busyUnconfirmed && input.busy) return input.turnPending || input.hasLiveStream
  return (input.busy && (input.isActiveTurn ?? input.isLatestTurn)) ||
    input.turnPending ||
    input.hasLiveStream
}

export function timelineTurnAllowsRecoveryContinue(input: {
  busy: boolean
  busyUnconfirmed?: boolean
  isLatestTurn: boolean
}): boolean {
  return input.isLatestTurn && !input.busy && !input.busyUnconfirmed
}
