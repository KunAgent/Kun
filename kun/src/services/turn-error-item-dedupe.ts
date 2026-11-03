/**
 * Loop recovery paths persist their own error item (random id) and then also
 * report the same failure through `rememberFailure`, which turn settlement
 * renders again as `item_<turn>_error`. Remember what the loop already wrote so
 * settlement can skip the duplicate card.
 */
const appliedErrorMessages = new Map<string, Set<string>>()

function key(threadId: string, turnId: string): string {
  return `${threadId}\u0000${turnId}`
}

export function noteAppliedTurnError(threadId: string, turnId: string, message: string): void {
  const entry = key(threadId, turnId)
  const messages = appliedErrorMessages.get(entry) ?? new Set<string>()
  messages.add(message)
  appliedErrorMessages.set(entry, messages)
}

export function turnErrorAlreadyApplied(threadId: string, turnId: string, message: string): boolean {
  return appliedErrorMessages.get(key(threadId, turnId))?.has(message) ?? false
}

export function clearAppliedTurnErrors(threadId: string, turnId: string): void {
  appliedErrorMessages.delete(key(threadId, turnId))
}
