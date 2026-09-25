import type {
  HarnessDefinition,
  HarnessId,
  HarnessRoute,
  HarnessTransport
} from '../contracts/harness.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'
import type { DelegatedTurnRuntime } from '../runtime/delegated-turn-runtime.js'
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
}

export type HarnessResolveResult =
  | { ok: true; runtime?: DelegatedTurnRuntime; resolved: ResolvedHarnessRoute }
  | { ok: false; error: HarnessAdmissionError }

export type HarnessRouterDeps = {
  /** Feature switch: `agents.kun.ade.harnessRouter` (default true). */
  enabled(): boolean
  catalog: { get(id: string): HarnessDefinition | undefined }
  /**
   * Live transport -> runtime view. A held reference must reflect hot
   * replacement; implementations should read through a getter rather than
   * snapshot the map.
   */
  runtimes(): Partial<Record<HarnessTransport, DelegatedTurnRuntime>>
  providerKinds(): ProviderKindsView
  defaultModel(): string | undefined
  /** Optional admission hook (P0-05). Absent means capability-only routing. */
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
    const route: HarnessRoute = {
      harnessId,
      providerId: turn.providerId ?? undefined,
      model: turn.model ?? thread.model ?? this.deps.defaultModel() ?? '',
      credentialMode:
        turn.credentialMode ?? defaultCredentialMode(harnessId, definition)
    }
    const admissionError = this.deps.admission?.({ definition, thread, turn })
    if (admissionError) return { ok: false, error: admissionError }
    if (definition.transport === 'native-loop') {
      return { ok: true, resolved: { route, definition } }
    }
    const runtime = this.deps.runtimes()[definition.transport]
    if (!runtime) {
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
    const owns = runtime.handlesRoute
      ? runtime.handlesRoute(route)
      : runtime.handlesProvider(route.providerId)
    if (!owns) {
      return {
        ok: false,
        error: new HarnessAdmissionError(
          'route_unsupported',
          `Harness ${harnessId} does not handle provider route ${route.providerId ?? 'default'}`
        )
      }
    }
    const resolved = runtime.resolveProvider?.(route.providerId) ?? runtime
    return { ok: true, runtime: resolved, resolved: { route, definition } }
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
