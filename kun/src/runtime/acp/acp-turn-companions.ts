/**
 * Per-turn companions of an ACP prompt:
 * - composer guidance, live or deferred — see acp-live-steering.ts;
 * - per-call usage from the Agent's own session store — OpenCode family
 *   (opencode-session-usage.ts) or Devin (devin-session-usage.ts). When it
 *   booked calls, the prompt results' usage (last call only) is not booked again.
 */
import type { SteeringEntry } from '../../contracts/turns.js'
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'
import type { TurnService } from '../../services/turn-service.js'
import { providerModule } from '../../harness/providers/registry.js'
import { AcpLiveSteering, type AcpGuidanceDelivery } from './acp-live-steering.js'
import { AcpPromptResultSchema } from './acp-schema.js'
import { acpPromptResultUsage } from './acp-session-usage.js'
import type { AcpUsage } from './acp-usage-types.js'
import { startOpenCodeSessionUsage, type OpenCodeCallUsage } from './opencode-session-usage.js'
import { startDevinSessionUsage } from './devin-session-usage.js'

export type AcpTurnCompanionsInput = {
  harnessId: string
  threadId: string
  turnId: string
  model: string
  acpSessionId: string
  /** OpenCode-family session store; absent for other engines. */
  sessionDbPath?: string
  /** Devin's session store; absent for other engines. */
  devinSessionDbPath?: string
  /** A kun-gateway route is metered by the gateway; the Agent's own usage is dropped. */
  gatewayMetered: boolean
  /** Guidance opened when the turn was handed over (openAcpGuidance). */
  guidance?: AcpLiveSteering
  /** Live usage drafts: timed, then queued behind the stream's own drafts. */
  emitLive(drafts: RuntimeEventDraft[]): void
  /** Send guidance as a `session/prompt` on this session. */
  sendGuidance(entries: SteeringEntry[]): Promise<unknown>
  /** A follow-up prompt is about to go out; the previous one settled. */
  beforeFollowUp?: AcpGuidanceDelivery['beforeFollowUp']
  /** False once the turn was stopped. */
  canFollowUp?: () => boolean
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

/**
 * Reopen guidance for an ACP turn as soon as the loop hands it over, so input
 * admitted while the Agent starts is kept for the run instead of refused. The
 * caller must `finish` it on every path.
 */
export function openAcpGuidance(
  turns: Partial<Pick<TurnService, 'openDelegatedSteering'>>,
  input: { harnessId: string; threadId: string; turnId: string; debug?: (summary: string) => void }
): AcpLiveSteering | undefined {
  if (typeof turns.openDelegatedSteering !== 'function') return undefined
  return new AcpLiveSteering({
    steering: turns.openDelegatedSteering(input.threadId, input.turnId),
    mode: acpLiveSteeringEnabled(input.harnessId) ? 'live' : 'deferred',
    ...(input.debug ? { debug: input.debug } : {})
  })
}

export function startAcpTurnCompanions(input: AcpTurnCompanionsInput): AcpTurnCompanions {
  const usageDraft = (call: OpenCodeCallUsage): RuntimeEventDraft => ({
    kind: 'usage', threadId: input.threadId, turnId: input.turnId, model: input.model,
    source: 'harness-reported', harnessId: input.harnessId, usage: call.usage
  })
  const reader = {
    acpSessionId: input.acpSessionId,
    onCalls: (booked: OpenCodeCallUsage[]) => input.emitLive(booked.map(usageDraft)),
    ...(input.debug ? { debug: input.debug } : {})
  }
  const calls = input.gatewayMetered ? undefined
    : input.sessionDbPath ? startOpenCodeSessionUsage({ dbPath: input.sessionDbPath, ...reader })
    : input.devinSessionDbPath ? startDevinSessionUsage({ dbPath: input.devinSessionDbPath, ...reader })
    : undefined
  const guidanceUsage: AcpUsage[] = []
  const live = input.guidance
  live?.start({
    send: input.sendGuidance,
    onResult: (raw) => {
      const parsed = AcpPromptResultSchema.safeParse(raw)
      const usage = parsed.success ? acpPromptResultUsage(input.harnessId, parsed.data) : undefined
      if (usage) guidanceUsage.push(usage)
    },
    onError: (error) => input.debug?.(`guidance prompt failed: ${String(error).slice(0, 300)}`),
    ...(input.beforeFollowUp ? { beforeFollowUp: input.beforeFollowUp } : {}),
    ...(input.canFollowUp ? { canFollowUp: input.canFollowUp } : {})
  })
  return {
    async afterPrompt(options) {
      await live?.finish(options)
    },
    settleUsage(mainResult, applyPromptResult) {
      const remaining = calls?.finish() ?? []
      if (calls && calls.calls > 0) return remaining.map(usageDraft)
      // Live guidance that joined the main run resolves with the same
      // last-call usage; book each distinct report once. A deferred follow-up
      // is a run of its own and always counts.
      const seen = new Set<string>()
      const dedupe = live?.mode !== 'deferred'
      return [mainResult, ...guidanceUsage].flatMap((usage) => {
        const key = JSON.stringify(usage ?? null)
        if (!usage || (dedupe && seen.has(key))) return []
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
