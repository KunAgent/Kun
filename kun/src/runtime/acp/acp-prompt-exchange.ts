/**
 * The `session/prompt` exchange of one admitted ACP turn: the main prompt,
 * native pending-tool continuations, and at most one Kun Design correction.
 * Every request reuses the turn's deadline and pending-tool handling, and the
 * exchange books a result before another prompt can replace its usage, so a
 * correction cannot outlive the turn or double-count an engine call.
 */
import type { AcpError } from './acp-schema.js'
import type { AcpEventMapper } from './acp-event-mapper.js'
import type { AcpPromptContentBlock } from './acp-prompt.js'
import type { AcpDraftEmitter } from './acp-turn-emitter.js'
import type { AcpUsage } from './acp-usage-types.js'
import type { AcpJsonRpc } from './acp-jsonrpc.js'
import type { HarnessTurnTiming } from '../harness-turn-timing.js'
import type { z } from 'zod'
import { continueAcpPendingTools } from './acp-pending-tool-continuation.js'
import { ACP_AGENT_METHODS, AcpPromptResultSchema, parseAcpResponse } from './acp-schema.js'
import { acpPromptResultUsage } from './acp-session-usage.js'

export type AcpPromptResult = z.infer<typeof AcpPromptResultSchema>

export type AcpPromptExchangeInput = {
  sessionId: string
  harnessId: string
  prompt: readonly AcpPromptContentBlock[]
  /** The turn's original wall-clock deadline; no prompt may extend it. */
  deadlineMs: number
  signal: AbortSignal
  /** Rejects when the session stream breaks while a prompt is in flight. */
  streamFailure: Promise<never>
  /** The engine declares native pending-tool continuation. */
  continuePendingTools: boolean
  rpc: Pick<AcpJsonRpc, 'request'>
  mapper: Pick<AcpEventMapper, 'pendingTools' | 'applyPromptResult' | 'closeSegment'>
  emitter: Pick<AcpDraftEmitter, 'emitAll'>
  timing: Pick<HarnessTurnTiming, 'requestStarted' | 'observe'>
  /** Drafts emitted from the stream are drained (and may fail it) before a prompt. */
  queued(): Promise<void>
  /** Refuses a prompt once the stream has already failed. */
  assertLive(): void
  onIncomplete(error: AcpError): void
  /** A follow-up prompt is about to go out; the previous answer gets its own item. */
  beforeCorrection?(): Promise<void> | void
  /** Runs after the main prompt (and its answer handling), before the correction gate. */
  settle(main: AcpPromptResult): Promise<AcpPromptResult | undefined>
  onPromptUsage(usage: AcpUsage): void
  /** The design gate: only a normal end_turn with time left gets one correction. */
  correction?(stopReason: string | undefined, timeLeft: boolean): string | undefined
}

export type AcpPromptExchange = {
  /** One prompt (also used for composer guidance), with pending-tool handling. */
  send(blocks: readonly AcpPromptContentBlock[]): Promise<unknown>
  /** The main prompt plus an optional design correction, in order. */
  run(): Promise<AcpPromptResult>
}

export function createAcpPromptExchange(input: AcpPromptExchangeInput): AcpPromptExchange {
  const request = (blocks: readonly AcpPromptContentBlock[]): Promise<unknown> => {
    input.assertLive()
    input.signal.throwIfAborted()
    return input.rpc.request(ACP_AGENT_METHODS.sessionPrompt,
      { sessionId: input.sessionId, prompt: blocks },
      { timeoutMs: Math.max(1, input.deadlineMs - Date.now()) })
  }
  const parse = (raw: unknown) => parseAcpResponse('session/prompt response', AcpPromptResultSchema, raw)
  const book = async (usage: AcpUsage): Promise<void> => {
    await input.queued()
    const drafts = input.mapper.applyPromptResult(usage)
    input.timing.observe(drafts)
    await input.emitter.emitAll(drafts)
  }
  const send = async (blocks: readonly AcpPromptContentBlock[]): Promise<unknown> =>
    continueAcpPendingTools(await Promise.race([request(blocks), input.streamFailure]), {
      enabled: input.continuePendingTools,
      signal: input.signal,
      deadlineMs: input.deadlineMs,
      pendingTools: () => input.mapper.pendingTools(),
      onIncomplete: input.onIncomplete,
      sendPrompt: (text) => {
        input.timing.requestStarted()
        return Promise.race([request([{ type: 'text', text }]), input.streamFailure])
      },
      onUnsettledResult: async (result) => {
        const usage = acpPromptResultUsage(input.harnessId, parse(result))
        if (usage) await book(usage)
        await input.emitter.emitAll(input.mapper.closeSegment())
      }
    })
  // Retain each settled prompt before attempting another one. Engines with
  // native continuations book immediately; others reconcile with session usage.
  const sendAndRecord = async (blocks: readonly AcpPromptContentBlock[]) => {
    const result = parse(await send(blocks))
    const usage = acpPromptResultUsage(input.harnessId, result)
    if (usage) {
      if (input.continuePendingTools) await book(usage)
      else input.onPromptUsage(usage)
    }
    return result
  }
  return {
    send,
    async run() {
      const main = await sendAndRecord(input.prompt)
      const guidanceStop = await input.settle(main)
      const last = main.stopReason === 'end_turn' && guidanceStop ? guidanceStop : main
      const correction = () => !input.signal.aborted && input.correction?.(last.stopReason, Date.now() < input.deadlineMs)
      if (!correction()) return last
      await input.beforeCorrection?.()
      // A receipt, cancellation or permission decision can arrive while flushing.
      const text = correction()
      return text ? sendAndRecord([{ type: 'text', text }]) : last
    }
  }
}
