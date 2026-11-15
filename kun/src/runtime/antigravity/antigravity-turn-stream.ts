import { makeAssistantTextItem } from '../../domain/item.js'
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'
import type { TurnService } from '../../services/turn-service.js'
import { harnessTurnTiming, type HarnessTurnTiming } from '../harness-turn-timing.js'
import { antigravityUsageSnapshot, type AntigravityUsage } from './antigravity-result.js'
import { antigravityStreamSignal } from './antigravity-stream.js'

type StreamDeps = {
  turns: Pick<TurnService, 'applyAssistantDelta' | 'applyItem'>
  ids: { next(prefix: string): string }
}

/** Persist a reply the CLI delivered as one complete fragment (no streamed pieces). */
export async function persistAntigravityText(
  deps: StreamDeps,
  threadId: string,
  turnId: string,
  text: string
): Promise<void> {
  const itemId = deps.ids.next('item_assistant')
  const createdAt = new Date().toISOString()
  const runningItem = makeAssistantTextItem({ id: itemId, threadId, turnId, text, status: 'running', createdAt })
  // Persist the cumulative canonical snapshot before exposing the fragment at
  // UTF-16 offset zero, then publish the final authoritative item.
  await deps.turns.applyAssistantDelta(threadId, runningItem, text, 0)
  await deps.turns.applyItem(
    threadId,
    makeAssistantTextItem({ id: itemId, threadId, turnId, text, status: 'completed', createdAt })
  )
}

export type AntigravityStreamCallbacks = {
  onInitModel?: (model: string) => Promise<unknown> | unknown
  onContextOccupancy?: (update: {
    inputTokens: number
    toolCount: number
    resolvedModel?: string
  }) => Promise<unknown> | unknown
}

/**
 * One `agy --output-format stream-json` turn: shows the reply as it streams,
 * and times it on arrival (TTFT, tok/s) before recording its usage.
 */
export class AntigravityTurnStream {
  private readonly timing: HarnessTurnTiming
  private item: { id: string; createdAt: string } | undefined
  private text = ''
  private queue: Promise<void> = Promise.resolve()
  private failure: unknown
  private initModel: string | undefined
  private lastStepInputTokens: number | undefined
  private lastPublishedOccupancy:
    | { inputTokens: number; toolCount: number; resolvedModel: string | undefined }
    | undefined
  private toolSteps = 0
  private startedTurn = false

  constructor(
    private readonly deps: StreamDeps,
    private readonly threadId: string,
    private readonly turnId: string,
    private readonly callbacks?: AntigravityStreamCallbacks
  ) {
    this.timing = harnessTurnTiming(threadId, turnId)
  }

  /** Whether any streamed assistant delta has already been published to the timeline. */
  get hasEmittedOutput(): boolean {
    return Boolean(this.item)
  }

  /** Any accepted request, tool activity, text or usage makes replay unsafe. */
  get hasStartedTurn(): boolean {
    return this.startedTurn
  }

  get toolStepCount(): number {
    return this.toolSteps
  }

  get resolvedModel(): string | undefined {
    return this.initModel
  }

  hasPublishedOccupancy(inputTokens: number, toolCount: number): boolean {
    return Boolean(
      this.lastPublishedOccupancy &&
      this.lastPublishedOccupancy.inputTokens === inputTokens &&
      this.lastPublishedOccupancy.toolCount === toolCount &&
      this.lastPublishedOccupancy.resolvedModel === this.initModel
    )
  }

  /** Every complete stdout line, handed over the moment it arrives. */
  readonly onLine = (line: string): void => {
    const signal = antigravityStreamSignal(line)
    if (!signal) return
    this.startedTurn = true
    switch (signal.kind) {
      case 'prompt-accepted':
        this.timing.requestStarted()
        if (signal.model && signal.model !== this.initModel) {
          this.initModel = signal.model
          const onInitModel = this.callbacks?.onInitModel
          if (onInitModel && this.lastStepInputTokens === undefined) {
            this.enqueueCallback(() => onInitModel(signal.model!))
          }
        }
        break
      case 'tool-started':
        this.toolSteps += 1
        this.timing.toolStarted()
        break
      case 'tool-finished': this.timing.toolFinished(); break
      case 'text':
        this.timing.text(signal.text)
        this.publish(signal.text)
        if (signal.inputTokens !== undefined) this.updateStepOccupancy(signal.inputTokens)
        break
      case 'response-usage':
        this.updateStepOccupancy(signal.inputTokens)
        break
    }
  }

  /**
   * Latest-request context occupancy (`input_tokens + cache_read_tokens`).
   * Multi-step and resumed `agy` turns accumulate `result.usage` across steps
   * and prior conversation turns, so only fall back to `finalUsage` for a fresh
   * single-step non-streaming response.
   */
  contextOccupancyTokens(finalUsage: AntigravityUsage | undefined, resumed = false): number | undefined {
    if (this.lastStepInputTokens !== undefined) return this.lastStepInputTokens
    if (!resumed && this.toolSteps === 0 && finalUsage) {
      const totalInput = finalUsage.inputTokens + finalUsage.cacheReadTokens
      if (totalInput > 0) return totalInput
    }
    return undefined
  }

  private updateStepOccupancy(inputTokens: number): void {
    this.lastStepInputTokens = inputTokens
    const toolCount = this.toolSteps
    const resolvedModel = this.initModel
    if (
      this.lastPublishedOccupancy &&
      this.lastPublishedOccupancy.inputTokens === inputTokens &&
      this.lastPublishedOccupancy.toolCount === toolCount &&
      this.lastPublishedOccupancy.resolvedModel === resolvedModel
    ) {
      return
    }
    this.lastPublishedOccupancy = { inputTokens, toolCount, resolvedModel }
    const onContextOccupancy = this.callbacks?.onContextOccupancy
    if (onContextOccupancy) {
      this.enqueueCallback(() => onContextOccupancy({ inputTokens, toolCount, resolvedModel }))
    }
  }

  private enqueueCallback(fn: () => Promise<unknown> | unknown): void {
    this.queue = this.queue
      .then(() => (this.failure ? undefined : fn()))
      .then(() => undefined)
      .catch(() => {
        // Telemetry callback errors must not abort assistant delta persistence.
      })
  }

  private publish(delta: string): void {
    const offset = this.text.length
    this.text += delta
    this.item ??= { id: this.deps.ids.next('item_assistant'), createdAt: new Date().toISOString() }
    const running = makeAssistantTextItem({
      id: this.item.id, threadId: this.threadId, turnId: this.turnId, text: this.text, status: 'running', createdAt: this.item.createdAt
    })
    // Writes keep the order the pieces arrived in; a failed one stops the rest.
    this.queue = this.queue
      .then(() => this.failure ? undefined : this.deps.turns.applyAssistantDelta(this.threadId, running, delta, offset))
      .catch((error: unknown) => { this.failure ??= error })
  }

  /** Wait for the writes in flight (before a turn ends without a result). */
  async settle(): Promise<void> {
    await this.queue
  }

  /** Publish the authoritative reply; a CLI that streamed nothing gets the single-fragment path. */
  async finish(finalText: string): Promise<void> {
    await this.queue
    if (this.failure) throw this.failure
    if (!this.item) {
      await persistAntigravityText(this.deps, this.threadId, this.turnId, finalText)
      return
    }
    await this.deps.turns.applyItem(
      this.threadId,
      makeAssistantTextItem({
        id: this.item.id, threadId: this.threadId, turnId: this.turnId, text: finalText, status: 'completed', createdAt: this.item.createdAt
      })
    )
  }

  /** The turn's usage with the stream timing measured on arrival stamped on. */
  usageDraft(usage: AntigravityUsage | undefined, model: string, providerId: string): RuntimeEventDraft | undefined {
    if (!usage) return undefined
    const draft: Extract<RuntimeEventDraft, { kind: 'usage' }> = {
      kind: 'usage', threadId: this.threadId, turnId: this.turnId, model, providerId, usage: antigravityUsageSnapshot(usage)
    }
    this.timing.observe([draft])
    // The CLI says how many output tokens were hidden thinking, so the streamed
    // answer cannot be longer than the rest.
    const visible = usage.outputTokens - usage.thinkingTokens
    const generated = draft.usage.requestGenerationTokens
    if (generated !== undefined && visible > 0 && generated > visible) {
      draft.usage = { ...draft.usage, requestGenerationTokens: visible }
    }
    return draft
  }
}
