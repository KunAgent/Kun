import type { StartTurnRequest } from '../contracts/turns.js'
import type { ThreadRecord } from '../contracts/threads.js'
import { resolveAdmissionHarness, type ProviderKindsView } from '../harness/resolve-turn-harness.js'
import { isInternalGraphWorker, unsupportedKunTurnIntent } from '../harness/kun-turn-intent.js'
import { TurnConflictError } from './turn-service-core.js'

/** Reject unsupported product intent before attachments, Graph drafts or queue records are written. */
export function resolveSupportedAdmissionHarness(input: {
  request: StartTurnRequest
  thread: ThreadRecord
  effectiveSurface: StartTurnRequest['agentSurface']
  providerKinds?: ProviderKindsView
}) {
  const harnessId = resolveAdmissionHarness({
    request: input.request,
    thread: input.thread,
    turnProviderId: input.request.providerId?.trim() || input.thread.providerId?.trim() || 'default',
    providerKinds: input.providerKinds ?? { byId: {}, defaultKind: 'http' }
  })
  const error = unsupportedKunTurnIntent(harnessId, {
    ...input.request,
    mode: input.request.mode ?? input.thread.mode,
    agentSurface: input.effectiveSurface
  }, { graphWorker: isInternalGraphWorker(input.thread) })
  if (error) throw new TurnConflictError(error)
  return harnessId
}
