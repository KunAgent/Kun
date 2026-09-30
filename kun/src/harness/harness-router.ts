import type {
  HarnessDefinition,
  HarnessId,
  HarnessRoute,
  HarnessStatus,
  HarnessTransport
} from '../contracts/harness.js'
import type { HarnessCapabilities } from '../contracts/harness-capabilities.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'
import type { DelegatedTurnRuntime } from '../runtime/delegated-turn-runtime.js'
import { checkHarnessAdmission } from './harness-admission.js'
import { effectiveKunTurnIntent, isInternalGraphWorker, unsupportedKunTurnIntent } from './kun-turn-intent.js'
import {
  effectiveCapabilitiesForRoute,
  roomAdjustedCapabilities
} from './effective-capabilities.js'
import { isUnattendedTurn, usageForTurn } from './usage-for-turn.js'
import {
  defaultCredentialMode,
  legacyHarnessForProvider,
  type ProviderKindsView
} from './resolve-turn-harness.js'

export const HARNESS_FAILURE_CODES = [
  'harness_unknown',
  'harness_unavailable',
  'harness_not_ready',
  'capability_missing',
  'sandbox_insufficient',
  'route_unsupported'
] as const
export type HarnessFailureCode = (typeof HARNESS_FAILURE_CODES)[number]

export class HarnessAdmissionError extends Error {
  constructor(
    readonly code: HarnessFailureCode,
    message: string,
    readonly missing: readonly string[] = []
  ) {
    super(message)
    this.name = 'HarnessAdmissionError'
  }

  /** User-facing message; i18n resolution happens at the client boundary. */
  get userMessage(): string {
    return this.message
  }
}

export type ResolvedHarnessRoute = {
  route: HarnessRoute
  definition: HarnessDefinition
  /** Effective capabilities for this route (declaration ∩ runtime report). */
  effective: HarnessCapabilities
  /** Resolved harness permission level after unattended clamping. */
  permissionMode: string
}

export type HarnessResolveResult =
  | { ok: true; runtime?: DelegatedTurnRuntime; resolved: ResolvedHarnessRoute }
  | { ok: false; error: HarnessAdmissionError }

export type HarnessRouterDeps = {
  /** Feature switch: `agents.kun.ade.harnessRouter` (default true). */
  enabled(): boolean
  catalog: {
    get(id: string): HarnessDefinition | undefined
    /** User-disabled harness ids fail admission; absent means nothing disabled. */
    isDisabled?(id: HarnessId): boolean
  }
  /**
   * Live transport -> runtime view. A held reference must reflect hot
   * replacement; implementations should read through a getter rather than
   * snapshot the map.
   */
  runtimes(): Partial<Record<HarnessTransport, DelegatedTurnRuntime>>
  providerKinds(): ProviderKindsView
  defaultModel(): string | undefined
  /**
   * Last probed detector status; undefined means "never probed" and the
   * not-ready gate is skipped (an unprobed harness is not a known-missing
   * one). Compositions should warm detection in the background.
   */
  status?(id: HarnessId): HarnessStatus | undefined
  /** `agents.kun.ade.allowUnattendedFullAccess`; default false. */
  allowUnattendedFullAccess?(): boolean
  /**
   * 07 §5 / 02 §5.2: whether the thread's bound task workspace is a
   * host-created isolated worktree. Absent or unknown → not isolated.
   */
  taskWorkspaceIsolated?(workspaceId: string): boolean
  /** Optional extra admission hook. Absent means capability-only routing. */
  admission?(input: {
    definition: HarnessDefinition
    thread: ThreadRecord
    turn: Turn
  }): HarnessAdmissionError | undefined
}

/**
 * Explicit `harnessId × providerId × model × credentialMode` resolution.
 * `resolve` is synchronous and must run before any lifecycle await so a
 * hot config swap can never retarget an already-admitted turn.
 */
export class HarnessRouter {
  constructor(private readonly deps: HarnessRouterDeps) {}

  enabled(): boolean {
    return this.deps.enabled()
  }

  resolve(thread: ThreadRecord, turn: Turn): HarnessResolveResult {
    const kinds = this.deps.providerKinds()
    const harnessId: HarnessId =
      turn.harnessId ?? thread.harnessId ?? legacyHarnessForProvider(turn.providerId, kinds)
    const definition = this.deps.catalog.get(harnessId)
    if (!definition) {
      return {
        ok: false,
        error: new HarnessAdmissionError(
          'harness_unknown',
          `Unknown harness: ${harnessId}`
        )
      }
    }
    if (this.deps.catalog.isDisabled?.(harnessId)) {
      return {
        ok: false,
        error: new HarnessAdmissionError(
          'harness_unavailable',
          `Harness disabled in settings: ${harnessId}`
        )
      }
    }
    const route: HarnessRoute = {
      harnessId,
      providerId: turn.providerId ?? undefined,
      model: turn.model ?? thread.model ?? this.deps.defaultModel() ?? '',
      credentialMode:
        turn.credentialMode ?? defaultCredentialMode(harnessId, definition)
    }
    const intentError = unsupportedKunTurnIntent(harnessId, effectiveKunTurnIntent(thread, turn), {
      graphWorker: isInternalGraphWorker(thread, turn)
    })
    if (intentError) return { ok: false, error: new HarnessAdmissionError('route_unsupported', intentError) }
    const admissionError = this.deps.admission?.({ definition, thread, turn })
    if (admissionError) return { ok: false, error: admissionError }
    let runtime: DelegatedTurnRuntime | undefined
    if (definition.transport !== 'native-loop') {
      const transport = this.deps.runtimes()[definition.transport]
      if (!transport) {
        return {
          ok: false,
          error: new HarnessAdmissionError(
            'harness_unavailable',
            `No runtime registered for harness transport: ${definition.transport}`
          )
        }
      }
      // Runtimes that understand routes get the explicit check; legacy runtimes
      // keep the provider-based admission so existing threads are unaffected.
      const owns = transport.handlesRoute
        ? transport.handlesRoute(route)
        : transport.handlesProvider(route.providerId)
      if (!owns) {
        return {
          ok: false,
          error: new HarnessAdmissionError(
            'route_unsupported',
            `Harness ${harnessId} does not handle provider route ${route.providerId ?? 'default'}`
          )
        }
      }
      runtime = transport.resolveProvider?.(route.providerId) ?? transport
    }
    const usage = usageForTurn(thread, turn)
    let effective = effectiveCapabilitiesForRoute(definition, runtime, route.providerId)
    if (usage === 'room-execution') {
      // A room turn strips native tools entirely: when the runtime declares
      // `roomToolPolicy`, Kun's tool host mediates every call, so the
      // room-scoped sandbox is host-enforced regardless of the harness's own
      // sandbox declaration.
      effective = roomAdjustedCapabilities(
        effective,
        runtime?.capabilities?.(route.providerId)?.roomToolPolicy === true
      )
    }
    // 07 §5: a thread bound to a host-managed worktree counts isolated.
    // Worker threads carry it on executionUnit; one-to-one threads on
    // thread.taskWorkspaceId (P1-22).
    const boundWorkspaceId = thread.executionUnit?.taskWorkspaceId ?? thread.taskWorkspaceId
    const verdict = checkHarnessAdmission({
      usage,
      credentialMode: route.credentialMode,
      harness: definition,
      effective,
      status: this.deps.status?.(harnessId) ?? {
        harnessId,
        installed: 'yes',
        login: 'unknown',
        checkedAt: '1970-01-01T00:00:00.000Z'
      },
      workspace: {
        isolated: Boolean(
          boundWorkspaceId && this.deps.taskWorkspaceIsolated?.(boundWorkspaceId)
        )
      },
      unattended: isUnattendedTurn(turn),
      allowUnattendedFullAccess: this.deps.allowUnattendedFullAccess?.() ?? false
    })
    if (!verdict.ok) {
      return {
        ok: false,
        error: new HarnessAdmissionError(verdict.code, verdict.message, verdict.missing)
      }
    }
    return {
      ok: true,
      runtime,
      resolved: { route, definition, effective, permissionMode: verdict.permissionMode }
    }
  }
}

/** Mutable map the router reads through; hot config swaps call replace(). */
export class HarnessRuntimeMap {
  private current: Partial<Record<HarnessTransport, DelegatedTurnRuntime>>

  constructor(initial: Partial<Record<HarnessTransport, DelegatedTurnRuntime>>) {
    this.current = initial
  }

  get(): Partial<Record<HarnessTransport, DelegatedTurnRuntime>> {
    return this.current
  }

  replace(next: Partial<Record<HarnessTransport, DelegatedTurnRuntime>>): void {
    this.current = next
  }
}
