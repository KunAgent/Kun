import type { TurnRunOutcome } from '../loop/turn-execution-types.js'
import type { HarnessRoute } from '../contracts/harness.js'
import type { HarnessCapabilities } from '../contracts/harness-capabilities.js'

export type DelegatedRuntimeCapabilities = {
  nativeResume: boolean
  structuredStreaming: boolean
  kunTools: boolean
  /** Native tools cannot bypass the room's frozen Kun tool policy. */
  roomToolPolicy?: boolean
  externalApproval: boolean
  liveSteering: boolean
  nativeContextTelemetry: boolean
  fork: boolean
}

/**
 * A provider-native runtime that owns an entire Kun turn instead of exposing an
 * HTTP ModelClient. Subscription CLIs/SDKs implement this narrow boundary.
 */
export interface DelegatedTurnRuntime {
  handlesProvider(providerId: string | undefined): boolean
  capabilities(providerId: string | undefined): DelegatedRuntimeCapabilities | undefined
  /**
   * Harness-aware admission. When present the HarnessRouter uses it instead
   * of `handlesProvider` so a runtime can decide on the full route
   * (harnessId x providerId x model x credentialMode).
   */
  handlesRoute?(route: HarnessRoute): boolean
  /** Capability v2 view; defaults are derived from the legacy booleans. */
  capabilitiesV2?(providerId: string | undefined): HarnessCapabilities | undefined
  /**
   * Resolve the immutable runtime generation that owns a provider. AgentLoop
   * calls this before any lifecycle await so a later hot configuration cannot
   * switch transports or credentials underneath an already-started turn.
   */
  resolveProvider?(providerId: string | undefined): DelegatedTurnRuntime | undefined
  runTurn(
    threadId: string,
    turnId: string,
    signal: AbortSignal,
    providerId?: string
  ): Promise<TurnRunOutcome>
}

export function composeDelegatedTurnRuntimes(
  runtimes: readonly DelegatedTurnRuntime[]
): DelegatedTurnRuntime | undefined {
  const active = runtimes.filter(Boolean)
  if (active.length === 0) return undefined
  return {
    handlesProvider(providerId) {
      return active.some((runtime) => runtime.handlesProvider(providerId))
    },
    handlesRoute(route) {
      return active.some((runtime) =>
        runtime.handlesRoute
          ? runtime.handlesRoute(route)
          : runtime.handlesProvider(route.providerId)
      )
    },
    capabilities(providerId) {
      return active.find((candidate) => candidate.handlesProvider(providerId))
        ?.capabilities(providerId)
    },
    resolveProvider(providerId) {
      const runtime = active.find((candidate) => candidate.handlesProvider(providerId))
      return runtime?.resolveProvider?.(providerId) ?? runtime
    },
    async runTurn(threadId, turnId, signal, providerId) {
      const runtime = active.find((candidate) => candidate.handlesProvider(providerId))
      if (runtime) return runtime.runTurn(threadId, turnId, signal, providerId)
      throw new Error('no delegated runtime owns this turn')
    }
  }
}

/**
 * Stable boundary held by AgentLoop while the runtime swaps whole immutable
 * delegated generations for subsequent turns.
 */
export class ReplaceableDelegatedTurnRuntime implements DelegatedTurnRuntime {
  constructor(private current: DelegatedTurnRuntime | undefined) {}

  replace(next: DelegatedTurnRuntime | undefined): void {
    this.current = next
  }

  handlesProvider(providerId: string | undefined): boolean {
    return this.current?.handlesProvider(providerId) === true
  }

  handlesRoute(route: HarnessRoute): boolean {
    return this.current
      ? this.current.handlesRoute
        ? this.current.handlesRoute(route)
        : this.current.handlesProvider(route.providerId)
      : false
  }

  capabilities(providerId: string | undefined): DelegatedRuntimeCapabilities | undefined {
    return this.resolveProvider(providerId)?.capabilities(providerId)
  }

  resolveProvider(providerId: string | undefined): DelegatedTurnRuntime | undefined {
    if (!this.current?.handlesProvider(providerId)) return undefined
    return this.current.resolveProvider?.(providerId) ?? this.current
  }

  async runTurn(
    threadId: string,
    turnId: string,
    signal: AbortSignal,
    providerId?: string
  ): Promise<TurnRunOutcome> {
    const runtime = this.resolveProvider(providerId)
    if (!runtime) throw new Error('no delegated runtime owns this turn')
    return runtime.runTurn(threadId, turnId, signal, providerId)
  }
}
