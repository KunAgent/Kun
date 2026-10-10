/**
 * Per-turn companions of an ACP prompt that only some engines support:
 * - live guidance (ProviderAcpHooks.liveSteering) — see acp-live-steering.ts;
 * - per-call usage from an OpenCode-family session store — see
 *   opencode-session-usage.ts. When it booked calls, the prompt results'
 *   usage (last call only, input without cache reads) is not booked again.
 */
import type { SteeringEntry } from '../../contracts/turns.js'
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'
import type { TurnService } from '../../services/turn-service.js'
import { providerModule } from '../../harness/providers/registry.js'
import { AcpLiveSteering } from './acp-live-steering.js'
import { AcpPromptResultSchema } from './acp-schema.js'
import { acpPromptResultUsage } from './acp-session-usage.js'
import type { AcpUsage } from './acp-usage-types.js'
import { startOpenCodeSessionUsage, type OpenCodeCallUsage } from './opencode-session-usage.js'

export type AcpTurnCompanionsInput = {
  harnessId: string
  threadId: string
  turnId: string
  model: string
  acpSessionId: string
  /** OpenCode-family session store; absent for other engines. */
  sessionDbPath?: string
  /** A kun-gateway route is metered by the gateway; the Agent's own usage is dropped. */
  gatewayMetered: boolean
  turns: Pick<TurnService, 'openDelegatedSteering'>
  /** Live usage drafts: timed, then queued behind the stream's own drafts. */
  emitLive(drafts: RuntimeEventDraft[]): void
  /** Send guidance as a `session/prompt` on this session. */
  sendGuidance(entries: SteeringEntry[]): Promise<unknown>
  debug?: (summary: string) => void
}

export type AcpTurnCompanions = {
  /**
   * The main prompt resolved: close guidance, send late guidance as a
   * follow-up when the run ended normally, and wait for every guidance request.
   */
  afterPrompt(options: { followUp: boolean }): Promise<void>
  /** Usage drafts to book at the end of a completed prompt. */
  settleUsage(mainResult: AcpUsage | null | undefined, applyPromptResult: (usage: AcpUsage | null | undefined) => RuntimeEventDraft[]): RuntimeEventDraft[]
  /** Failed or cancelled turn: close guidance and return the usage already consumed. */
  abandon(): Promise<RuntimeEventDraft[]>
  stop(): void
}

/** The engine answers a `session/prompt` sent while its run is still going. */
export function acpLiveSteeringEnabled(harnessId: string): boolean {
  return providerModule(harnessId)?.acp?.liveSteering === true
}

export function startAcpTurnCompanions(input: AcpTurnCompanionsInput): AcpTurnCompanions {
  const usageDraft = (call: OpenCodeCallUsage): RuntimeEventDraft => ({
    kind: 'usage', threadId: input.threadId, turnId: input.turnId, model: input.model,
    source: 'harness-reported', harnessId: input.harnessId, usage: call.usage
  })
  const calls = input.sessionDbPath && !input.gatewayMetered
    ? startOpenCodeSessionUsage({
        dbPath: input.sessionDbPath,
        acpSessionId: input.acpSessionId,
        onCalls: (booked) => input.emitLive(booked.map(usageDraft)),
        ...(input.debug ? { debug: input.debug } : {})
      })
    : undefined
  const guidanceUsage: AcpUsage[] = []
  const live = acpLiveSteeringEnabled(input.harnessId) &&
    typeof input.turns.openDelegatedSteering === 'function'
    ? new AcpLiveSteering({
        steering: input.turns.openDelegatedSteering(input.threadId, input.turnId),
        send: input.sendGuidance,
        onResult: (raw) => {
          const parsed = AcpPromptResultSchema.safeParse(raw)
          const usage = parsed.success ? acpPromptResultUsage(input.harnessId, parsed.data) : undefined
          if (usage) guidanceUsage.push(usage)
        },
        onError: (error) => input.debug?.(`guidance prompt failed: ${String(error).slice(0, 300)}`)
      })
    : undefined
  return {
    async afterPrompt(options) {
      await live?.finish(options)
    },
    settleUsage(mainResult, applyPromptResult) {
      const remaining = calls?.finish() ?? []
      if (calls && calls.calls > 0) return remaining.map(usageDraft)
      // Guidance that joined the main run resolves with the same last-call
      // usage; book each distinct report once.
      const seen = new Set<string>()
      return [mainResult, ...guidanceUsage].flatMap((usage) => {
        const key = JSON.stringify(usage ?? null)
        if (!usage || seen.has(key)) return []
        seen.add(key)
        return applyPromptResult(usage)
      })
    },
    async abandon() {
      await live?.finish({ followUp: false }).catch(() => undefined)
      return (calls?.finish() ?? []).map(usageDraft)
    },
    stop() {
      calls?.stop()
    }
  }
}
