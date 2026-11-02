import { createHash } from 'node:crypto'
import { StartTurnRequest, type StartTurnRequest as StartTurnRequestValue } from '../../contracts/turns.js'
import type { FollowUpEnvelope } from '../../contracts/collaboration-followup.js'
import { canonicalizeFingerprintValue } from '../../domain/turn-request-fingerprint.js'

/** Stable identities for a single explicit continuation action, not its delivery attempts. */
function identity(kind: string, ...parts: string[]): string {
  return kind + '-' + createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 40)
}

export const manualContinueEventId = (commitmentId: string, requestId: string): string =>
  identity('followup-user-event', commitmentId, requestId)
export const manualContinueBindingId = (commitmentId: string, eventId: string): string =>
  identity('followup-binding', commitmentId, eventId, 'continuation')
export const manualContinueSourceId = (roomId: string): string => identity('followup-user-source', roomId)

export function manualContinueIds(roomId: string, commitmentId: string, clientRequestId: string) {
  const action = identity('followup-user-action', roomId, clientRequestId)
  const requestId = identity('followup-request', action, commitmentId)
  const eventId = manualContinueEventId(commitmentId, requestId)
  return { action, requestId, eventId, bindingId: manualContinueBindingId(commitmentId, eventId),
    effectId: identity('followup-effect', action, commitmentId), attemptId: identity('followup-attempt', action, commitmentId),
    admissionKey: identity('followup-admission', action, commitmentId) }
}

export function manualContinueCommandFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalizeFingerprintValue(value)), 'utf8').digest('hex')
}

/** Only the actual user message is passed as instructions for this first manual path. */
export function manualContinueRequest(requestId: string, message: string): StartTurnRequestValue {
  return StartTurnRequest.parse({ clientRequestId: requestId, prompt: message })
}

/** Transport, claim ownership and retry time are deliberately excluded. */
export function manualContinueFingerprint(envelope: FollowUpEnvelope, request: StartTurnRequestValue): string {
  return createHash('sha256').update(JSON.stringify(canonicalizeFingerprintValue({ envelope, request })), 'utf8').digest('hex')
}
