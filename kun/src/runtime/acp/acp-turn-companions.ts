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
import type { AcpPromptResult } from './acp-prompt-exchange.js'
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
  applyPromptResult(usage: AcpUsage): RuntimeEventDraft[]
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
  afterPrompt(options: { followUp: boolean }): Promise<AcpPromptResult | undefined>
  rememberPromptUsage(usage: AcpUsage): void
  settleUsage(): RuntimeEventDraft[]
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
  const promptUsage: AcpUsage[] = []
  const guidanceUsage: AcpUsage[] = []
  let guidanceStop: AcpPromptResult | undefined
  const live = input.guidance
  live?.start({
    send: input.sendGuidance,
    onResult: (raw) => {
      const parsed = AcpPromptResultSchema.safeParse(raw)
      if (!parsed.success) return
      if (parsed.data.stopReason !== 'end_turn') guidanceStop = parsed.data
      const usage = acpPromptResultUsage(input.harnessId, parsed.data)
      if (usage) guidanceUsage.push(usage)
    },
    onError: (error) => input.debug?.(`guidance prompt failed: ${String(error).slice(0, 300)}`),
    ...(input.beforeFollowUp ? { beforeFollowUp: input.beforeFollowUp } : {}),
    canFollowUp: () => !guidanceStop && input.canFollowUp?.() !== false
  })
  const settleUsage = () => {
    const main = promptUsage.splice(0)
    const guidance = guidanceUsage.splice(0)
    const remaining = calls?.finish() ?? []
    if (calls && calls.calls > 0) return remaining.map(usageDraft)
    // Concurrent guidance may report the same final call as the main prompt.
    // A deferred follow-up and a design correction are separate engine calls.
    const seen = new Set(main.slice(0, 1).map(usage => JSON.stringify(usage)))
    const drafts = main.flatMap(input.applyPromptResult)
    for (const usage of guidance) {
      const key = JSON.stringify(usage)
      if (live?.mode !== 'deferred' && seen.has(key)) continue
      seen.add(key)
      drafts.push(...input.applyPromptResult(usage))
    }
    return drafts
  }
  return {
    async afterPrompt(options) {
      await live?.finish(options)
      return guidanceStop
    },
    rememberPromptUsage(usage) { promptUsage.push(usage) },
    settleUsage,
    async abandon() {
      await live?.finish({ followUp: false }).catch(() => undefined)
      return settleUsage()
    },
    stop() {
      calls?.stop()
    }
  }
}
