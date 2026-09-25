import type {
  HarnessCredentialMode,
  HarnessDefinition,
  HarnessId
} from '../contracts/harness.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { StartTurnRequest, Turn } from '../contracts/turns.js'
import type { ServeProviderConfig } from '../config/kun-config-application.js'

export type ProviderKindsView = {
  /** providerId -> configured kind; missing id resolves to undefined. */
  byId: Record<string, ServeProviderConfig['kind'] | undefined>
  /** Kind of the runtime's default provider (env-level provider kind). */
  defaultKind: ServeProviderConfig['kind'] | 'http'
}

const KIND_TO_HARNESS: Partial<Record<NonNullable<ServeProviderConfig['kind']>, HarnessId>> = {
  'agent-sdk': 'claude-code',
  'cursor-sdk': 'cursor',
  'antigravity-cli': 'antigravity'
}

/**
 * Infer a harness from a provider id for legacy records that predate the
 * explicit `harnessId` fields. `'default'`/absent resolves through the
 * default provider's kind. HTTP and unknown kinds are Kun's native loop.
 */
export function legacyHarnessForProvider(
  providerId: string | undefined,
  kinds: ProviderKindsView
): HarnessId {
  const kind =
    !providerId || providerId === 'default'
      ? kinds.defaultKind
      : kinds.byId[providerId] ?? kinds.defaultKind
  return (kind && KIND_TO_HARNESS[kind]) ?? 'kun'
}

/**
 * Harness frozen onto a turn at admission. Explicit request value wins, then
 * the thread pin, then legacy provider inference. This is computed next to
 * `turnProviderId` so a hot config change cannot move an admitted turn.
 */
export function resolveAdmissionHarness(input: {
  request: Pick<StartTurnRequest, 'harnessId' | 'providerId'>
  thread: Pick<ThreadRecord, 'harnessId'>
  turnProviderId: string
  providerKinds: ProviderKindsView
}): HarnessId {
  return (
    (input.request.harnessId?.trim() as HarnessId | undefined) ??
    (input.thread.harnessId as HarnessId | undefined) ??
    legacyHarnessForProvider(input.turnProviderId, input.providerKinds)
  )
}

/** Read the harness a recorded turn belongs to (frozen value, else infer). */
export function resolveTurnHarness(
  thread: Pick<ThreadRecord, 'harnessId'>,
  turn: Pick<Turn, 'harnessId' | 'providerId'>,
  providerKinds: ProviderKindsView
): HarnessId {
  return (
    (turn.harnessId as HarnessId | undefined) ??
    (thread.harnessId as HarnessId | undefined) ??
    legacyHarnessForProvider(turn.providerId, providerKinds)
  )
}

/** Default credential mode: the harness's first declared mode ('provider' for kun). */
export function defaultCredentialMode(
  harnessId: HarnessId,
  definition?: Pick<HarnessDefinition, 'credentialModes'>
): HarnessCredentialMode {
  return definition?.credentialModes[0] ?? (harnessId === 'kun' ? 'provider' : 'native-login')
}
