import { InMemoryApprovalGate } from '../adapters/in-memory-approval-gate.js'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { InMemoryUserInputGate } from '../adapters/in-memory-user-input-gate.js'
import { buildReadOnlyBuiltinLocalTools } from '../adapters/tool/builtin-tools.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import { normalizeRoleReasoningEffort } from '../loop/reasoning-effort.js'
import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import type { RuntimeEvent } from '../contracts/events.js'
import type { TurnItem } from '../contracts/items.js'
import type { ReviewTarget } from '../contracts/review.js'
import type { TurnReasoningEffort } from '../contracts/turns.js'
import { AgentLoop } from '../loop/agent-loop.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import type {
  ContextCompactionConfig,
  ModelConfig,
  ModelContextProfile
} from '../loop/model-context-profile.js'
import { modelCapabilitiesForModel } from '../loop/model-context-profile.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import type { TokenEconomyConfig } from '../loop/token-economy.js'
import { RandomIdGenerator } from '../ports/id-generator.js'
import type { ModelClient } from '../ports/model-client.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { RuntimeTuningConfig } from '../config/kun-config.js'
import { normalizeTurnLimits } from '../loop/turn-limits.js'
import { findSessionEvent } from '../adapters/session-event-query.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { ThreadService } from './thread-service.js'
import { TurnService } from './turn-service.js'
import { UsageService } from './usage-service.js'
import { resolveReviewTargetPrompt } from '../review/git-review-target.js'
import { parseReviewOutput, renderReviewOutput } from '../review/review-output.js'
import { KUN_REVIEW_PROMPT } from '../review/review-prompt.js'
import { ReviewEventProjector } from '../review/review-event-projector.js'

// A review runs as a hidden child turn. Keep a dedicated ceiling so a tool
// loop cannot leave the visible parent turn looking busy for the 24-hour
// generic default; stricter runtime limits still win below.
const DEFAULT_REVIEW_MAX_STEPS = 32
const DEFAULT_REVIEW_FINAL_ANSWER_STEP = 8
const DEFAULT_REVIEW_MAX_WALL_TIME_MS = 15 * 60_000
const DEFAULT_REVIEW_MAX_TOOL_CALLS_PER_STEP = 64
const MAX_REVIEW_PROGRESS_UPDATES = 24

export type ReviewServiceDeps = {
  threadStore: ThreadStore
  turns: TurnService
  model: ModelClient
  defaultModel: string
  nowIso: () => string
  models?: ModelConfig
  contextCompaction?: ContextCompactionConfig
  tokenEconomy?: TokenEconomyConfig
  runtime?: RuntimeTuningConfig
  modelCapabilities?: (model: string, providerId?: string) => ModelCapabilityMetadata
  profilesForProvider?: (
    providerId: string | undefined
  ) => readonly ModelContextProfile[]
  /** Fallback reasoning depth for review calls that do not specify one. */
  reasoningEffort?: string
  roleModel?: string
  roleProviderId?: string
  roleAccountId?: string
}

export class ReviewService {
  private deps: ReviewServiceDeps

  constructor(deps: ReviewServiceDeps) {
    this.deps = deps
  }

  updateRuntimeConfig(
    patch: Partial<Pick<ReviewServiceDeps, 'defaultModel' | 'models' | 'contextCompaction' | 'tokenEconomy' | 'runtime' | 'reasoningEffort' | 'roleModel' | 'roleProviderId' | 'roleAccountId'>>
  ): void {
    this.deps = {
      ...this.deps,
      ...patch
    }
  }

  async runReview(input: {
    threadId: string
    turnId: string
    reviewItemId: string
    target: ReviewTarget
    model?: string
    providerId?: string
    accountId?: string
    reasoningEffort?: TurnReasoningEffort
  }): Promise<'completed' | 'failed' | 'aborted'> {
    const signal = this.deps.turns.getAbortController(input.turnId)
    if (!signal) {
      await this.failReview(input, 'no abort controller for review turn')
      return 'failed'
    }
    if (signal.aborted) {
      await this.abortReview(input)
      return 'aborted'
    }
    try {
      await this.publishProgress(input, 'Preparing the review target...')
      const thread = await this.deps.threadStore.get(input.threadId)
      if (!thread) throw new Error(`thread not found: ${input.threadId}`)
      const resolved = await resolveReviewTargetPrompt({
        target: input.target,
        workspace: thread.workspace ?? ''
      })
      if (signal.aborted) {
        await this.abortReview(input)
        return 'aborted'
      }
      const eventProjector = new ReviewEventProjector(this.deps.turns, input)
      let rawReviewText: string
      try {
        rawReviewText = await this.runIsolatedReviewer({
          prompt: resolved.prompt,
          workspace: thread.workspace ?? '',
          model: input.model?.trim() || this.deps.roleModel?.trim() || thread.model || this.deps.defaultModel,
          providerId: input.providerId?.trim() || this.deps.roleProviderId?.trim() || thread.providerId?.trim(),
          accountId: input.accountId?.trim() || this.deps.roleAccountId?.trim() || thread.accountId?.trim(),
          reasoningEffort: input.reasoningEffort,
          onEvent: (event) => eventProjector.enqueue(event),
          onProgress: (message) => this.publishProgress(input, message),
          signal
        })
      } finally {
        await eventProjector.drain()
      }
      if (signal.aborted) {
        await this.abortReview(input)
        return 'aborted'
      }
      const output = parseReviewOutput(rawReviewText)
      const reviewText = renderReviewOutput(output)
      await this.deps.turns.updateItem(input.threadId, input.reviewItemId, {
        status: 'completed',
        title: resolved.title,
        output,
        reviewText,
        finishedAt: this.deps.nowIso()
      } as Partial<TurnItem>)
      await this.deps.turns.finishTurn({
        threadId: input.threadId,
        turnId: input.turnId,
        status: 'completed'
      })
      return 'completed'
    } catch (error) {
      if (signal.aborted) {
        await this.abortReview(input)
        return 'aborted'
      }
      const message = error instanceof Error ? error.message : String(error)
      await this.failReview(input, message)
      return 'failed'
    }
  }

  private async runIsolatedReviewer(input: {
    prompt: string
    workspace: string
    model: string
    providerId?: string
    accountId?: string
    reasoningEffort?: TurnReasoningEffort
    onEvent?: (event: RuntimeEvent) => void
    onProgress?: (message: string) => void | Promise<void>
    signal: AbortSignal
  }): Promise<string> {
    const nowIso = this.deps.nowIso
    const eventBus = new InMemoryEventBus()
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const usage = new UsageService()
    const ids = new RandomIdGenerator()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const compactor = new ContextCompactor({
      contextCompaction: this.deps.contextCompaction,
      models: this.deps.models,
      profilesForProvider: this.deps.profilesForProvider
    })
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight,
      steering,
      compactor,
      ids,
      nowIso
    })
    const threads = new ThreadService({
      threadStore,
      sessionStore,
      events,
      ids,
      nowIso
    })
    const turnLimits = reviewTurnLimits(this.deps.runtime)
    const loop = new AgentLoop({
      threadStore,
      sessionStore,
      approvalGate: new InMemoryApprovalGate(),
      userInputGate: new InMemoryUserInputGate(),
      model: this.deps.model,
      toolHost: new LocalToolHost({
        tools: buildReadOnlyBuiltinLocalTools(),
        readTracker: true
      }),
      usage,
      events,
      turns,
      inflight,
      steering,
      compactor,
      prefix: createImmutablePrefix({
        systemPrompt: KUN_REVIEW_PROMPT,
        pinnedConstraints: ['system: review mode is read-only and must output strict JSON']
      }),
      ids,
      nowIso,
      modelCapabilities: (model) =>
        this.deps.modelCapabilities?.(model, input.providerId) ?? modelCapabilitiesForModel(model),
      ...(this.deps.contextCompaction ? { contextCompaction: this.deps.contextCompaction } : {}),
      ...(this.deps.tokenEconomy ? { tokenEconomy: this.deps.tokenEconomy } : {}),
      turnLimits,
      finalAnswerOnlyStep: Math.min(
        DEFAULT_REVIEW_FINAL_ANSWER_STEP,
        turnLimits.maxSteps - 1
      ),
      ...(this.deps.runtime?.toolStorm ? { toolStorm: this.deps.runtime.toolStorm } : {}),
      ...(this.deps.runtime?.toolArgumentRepair ? { toolArgumentRepair: this.deps.runtime.toolArgumentRepair } : {})
    })

    const childThread = await threads.create({
      title: 'Review',
      workspace: input.workspace || '~',
      model: input.model,
      ...(input.providerId?.trim() ? { providerId: input.providerId.trim() } : {}),
      ...(input.accountId?.trim() ? { accountId: input.accountId.trim() } : {}),
      mode: 'agent',
      approvalPolicy: 'auto',
      // The reviewer receives untrusted diff and workspace content in its
      // prompt. Its deliberately read-only tool set must be paired with the
      // read-only sandbox, otherwise its child thread defaults to full access
      // and can read files outside the reviewed workspace.
      sandboxMode: 'read-only'
    })
    let progressUpdates = 0
    let progressQueue = Promise.resolve()
    const reportedProgress = new Set<string>()
    const queueProgress = (message: string): void => {
      if (!input.onProgress || reportedProgress.has(message)) return
      if (progressUpdates >= MAX_REVIEW_PROGRESS_UPDATES) return
      reportedProgress.add(message)
      progressUpdates += 1
      progressQueue = progressQueue
        .then(() => input.onProgress?.(message))
        .then(() => undefined)
        .catch(() => undefined)
    }
    const unsubscribe = eventBus.subscribe(childThread.id, (event) => {
      input.onEvent?.(event)
      const message = reviewProgressForEvent(event)
      if (message) queueProgress(message)
    })
    queueProgress('Starting the read-only reviewer...')
    try {
      const started = await turns.startTurn({
        threadId: childThread.id,
        request: {
          prompt: input.prompt,
          model: input.model,
          ...(input.providerId?.trim() ? { providerId: input.providerId.trim() } : {}),
          ...(input.accountId?.trim() ? { accountId: input.accountId.trim() } : {}),
          mode: 'agent',
          reasoningEffort: normalizeRoleReasoningEffort(
            input.reasoningEffort ?? this.deps.reasoningEffort
          )
        }
      })
      const abortChild = (): void => {
        void turns.interruptTurn({
          threadId: childThread.id,
          turnId: started.turnId
        }).catch(() => undefined)
      }
      if (input.signal.aborted) abortChild()
      else input.signal.addEventListener('abort', abortChild, { once: true })
      try {
        const status = await loop.runTurn(childThread.id, started.turnId)
        const runtimeError = await findSessionEvent(
          sessionStore,
          childThread.id,
          (event) => event.kind === 'error' && event.turnId === started.turnId
        )
        if (runtimeError?.kind === 'error') throw new Error(runtimeError.message)
        const items = await sessionStore.loadItems(childThread.id)
        const text = summarizeReviewTurn(items, started.turnId)
        if (status !== 'completed') throw new Error(text || `reviewer ${status}`)
        return text
      } finally {
        input.signal.removeEventListener('abort', abortChild)
      }
    } finally {
      unsubscribe()
      await progressQueue
    }
  }

  private async publishProgress(
    input: { threadId: string; reviewItemId: string },
    message: string
  ): Promise<void> {
    await this.deps.turns.updateItem(input.threadId, input.reviewItemId, {
      status: 'running',
      reviewText: message
    } as Partial<TurnItem>).catch(() => undefined)
  }

  private async failReview(
    input: { threadId: string; turnId: string; reviewItemId: string },
    message: string
  ): Promise<void> {
    await this.deps.turns.updateItem(input.threadId, input.reviewItemId, {
      status: 'failed',
      reviewText: message,
      finishedAt: this.deps.nowIso()
    } as Partial<TurnItem>)
    await this.deps.turns.finishTurn({
      threadId: input.threadId,
      turnId: input.turnId,
      status: 'failed',
      error: message
    })
  }

  private async abortReview(input: {
    threadId: string
    turnId: string
    reviewItemId: string
  }): Promise<void> {
    await this.deps.turns.updateItem(input.threadId, input.reviewItemId, {
      status: 'aborted',
      reviewText: 'Review aborted.',
      finishedAt: this.deps.nowIso()
    } as Partial<TurnItem>)
    await this.deps.turns.finishTurn({
      threadId: input.threadId,
      turnId: input.turnId,
      status: 'aborted'
    })
  }
}

function reviewTurnLimits(runtime: RuntimeTuningConfig | undefined): {
  maxSteps: number
  maxWallTimeMs: number
  maxToolCallsPerStep: number
} {
  const configured = normalizeTurnLimits(runtime?.turnLimits)
  return {
    maxSteps: Math.min(configured.maxSteps ?? DEFAULT_REVIEW_MAX_STEPS, DEFAULT_REVIEW_MAX_STEPS),
    maxWallTimeMs: Math.min(
      configured.maxWallTimeMs,
      DEFAULT_REVIEW_MAX_WALL_TIME_MS
    ),
    maxToolCallsPerStep: Math.min(
      configured.maxToolCallsPerStep,
      DEFAULT_REVIEW_MAX_TOOL_CALLS_PER_STEP
    )
  }
}

function reviewProgressForEvent(event: RuntimeEvent): string | undefined {
  switch (event.kind) {
    case 'pipeline_stage':
      return event.stage === 'pre_send' ? 'Sending the review request...' : undefined
    case 'assistant_reasoning_delta':
      return 'Analyzing the changed code...'
    case 'assistant_text_delta':
      return 'Formatting review findings...'
    case 'tool_call_started':
      return event.item.kind === 'tool_call'
        ? `Inspecting the workspace with ${event.item.toolName}...`
        : 'Inspecting the workspace...'
    case 'tool_call_ready':
      return `Inspecting the workspace with ${event.toolName}...`
    case 'model_request_retry':
      return `Retrying the review model request (${event.attempt}/${event.maxAttempts})...`
    case 'tool_result_upload_wait':
      return 'Waiting for review tool results...'
    case 'compaction_started':
      return 'Compacting the review context...'
    default:
      return undefined
  }
}

function summarizeReviewTurn(items: readonly TurnItem[], turnId: string): string {
  return items
    .filter((item): item is Extract<TurnItem, { kind: 'assistant_text' }> =>
      item.turnId === turnId && item.kind === 'assistant_text' && item.text.trim().length > 0
    )
    .map((item) => item.text.trim())
    .join('\n\n')
    .trim()
}
