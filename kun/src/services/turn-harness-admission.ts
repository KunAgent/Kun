import type { StartTurnRequest } from '../contracts/turns.js'
import type { ThreadRecord } from '../contracts/threads.js'
import { legacyHarnessForProvider, resolveAdmissionHarness, type ProviderKindsView } from '../harness/resolve-turn-harness.js'
import { isInternalGraphWorker, unsupportedKunTurnIntent } from '../harness/kun-turn-intent.js'
import { TurnConflictError } from './turn-service-core.js'

/** Reject unsupported product intent before attachments, Graph drafts or queue records are written. */
export function resolveSupportedAdmissionHarness(input: {
  request: StartTurnRequest
  thread: ThreadRecord
  effectiveSurface: StartTurnRequest['agentSurface']
  providerKinds?: ProviderKindsView
  harnessCatalog?: import('./turn-service-core.js').TurnServiceDeps['harnessCatalog']
}) {
  const providerId = input.request.providerId?.trim() || input.thread.providerId?.trim() || 'default'
  const providerKinds = input.providerKinds ?? { byId: {}, defaultKind: 'http' }
  const harnessId = resolveAdmissionHarness({
    request: input.request,
    thread: input.thread,
    turnProviderId: providerId,
    providerKinds
  })
  if (harnessId === 'kun' && legacyHarnessForProvider(providerId, providerKinds) !== 'kun') {
    throw new TurnConflictError('Kun Agent cannot use an external Agent provider. Select a Kun model connection or enable and select the external Agent profile.')
  }
  if (harnessId !== 'kun' && input.harnessCatalog) {
    const definition = input.harnessCatalog.get(harnessId)
    const credentialMode = input.request.credentialMode ??
      (input.thread.executionConfig?.route.harnessId === harnessId ? input.thread.executionConfig.route.credentialMode : undefined) ??
      definition?.credentialModes[0] ?? 'native-login'
    if (!input.harnessCatalog.isProfileEnabled?.({ harnessId, credentialMode, providerId })) {
      throw new TurnConflictError(`Agent profile is disabled: ${harnessId}. Test and enable this profile in Agent settings.`)
    }
  }
  const error = unsupportedKunTurnIntent(harnessId, {
    ...input.request,
    mode: input.request.mode ?? input.thread.mode,
    agentSurface: input.effectiveSurface
  }, { graphWorker: isInternalGraphWorker(input.thread) })
  if (error) throw new TurnConflictError(error)
  return harnessId
}
