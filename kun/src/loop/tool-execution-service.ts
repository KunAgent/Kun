import type { TurnItem } from '../contracts/items.js'
import { makeToolResultItem } from '../domain/item.js'
import { CREATE_PLAN_TOOL_NAME } from '../adapters/tool/create-plan-tool.js'
import type { ToolCallLike, ToolHost, ToolHostContext, ToolHostResult } from '../ports/tool-host.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { TurnService } from '../services/turn-service.js'
import { InflightTracker } from './inflight-tracker.js'
import {
  TOOL_CANCELLED_BY_USER_CODE,
  ToolCancellationRegistry
} from './tool-cancellation-registry.js'
import {
  isPendingReceiptOutput,
  type CanvasReceiptRegistry
} from '../services/canvas-receipt-registry.js'
import { prepareBrowserUseToolResultForPersistence } from './tool-result-image.js'
import type { ArtifactStore } from '../artifacts/artifact-store.js'

export const TOOL_RESULT_ARTIFACT_THRESHOLD_BYTES = 1024 * 1024
const TOOL_RESULT_PREVIEW_CHARS = 16 * 1024
const DEFAULT_TOOL_ABORT_GRACE_MS = 5_000
export const TOOL_ABORT_OUTCOME_UNKNOWN_CODE = 'tool_abort_outcome_unknown'

class ToolAbortOutcomeUnknownError extends Error {
  readonly unknownOutcome = true
  constructor(readonly graceMs: number) {
    super(`tool did not settle within ${graceMs} ms after cancellation`)
    this.name = 'ToolAbortOutcomeUnknownError'
  }
}

export type PlanWrittenCallback = (input: {
  threadId: string
  turnId: string
  planId: string
  relativePath: string
  markdown: string
}) => Promise<void>

export type ToolExecutionServiceDeps = {
  toolHost: ToolHost
  inflight: InflightTracker
  turns: TurnService
  events: RuntimeEventRecorder
  toolCancellation?: ToolCancellationRegistry
  nowIso: () => string
  onPlanWritten?: PlanWrittenCallback
  awaitWorkspaceCheckpoint?: (
    checkpointRequestId: string,
    signal: AbortSignal
  ) => Promise<string | null>
  /** Design-tool renderer receipt registry; finalizes accepted results. */
  receipts?: CanvasReceiptRegistry
  artifactStore?: ArtifactStore
  /** Bounded wait for an aborted provider/tool to acknowledge cancellation. */
  abortGraceMs?: number
}

export type ToolExecutionInput = {
  threadId: string
  turnId: string
  call: ToolCallLike
  context: ToolHostContext
}

/**
 * Executes an already-persisted tool call and persists its result. Batch and
 * storm policy remain with the dispatcher; this service owns only execution,
 * partial updates, error normalization, and result-side plan integration.
 */
export class ToolExecutionService {
  private readonly checkpointGates = new Map<string, Promise<void>>()
  private readonly deps: ToolExecutionServiceDeps
  private readonly toolCancellation: ToolCancellationRegistry
  private readonly abortGraceMs: number

  constructor(deps: ToolExecutionServiceDeps) {
    const toolCancellation = deps.toolCancellation ?? new ToolCancellationRegistry()
    this.deps = {
      ...deps,
      toolCancellation
    }
    this.toolCancellation = toolCancellation
    this.abortGraceMs = Math.max(0, Math.floor(deps.abortGraceMs ?? DEFAULT_TOOL_ABORT_GRACE_MS))
  }

  async executeSafely(input: ToolExecutionInput): Promise<ToolHostResult> {
    // Detached/background turns keep their dedicated lifecycle controls. The
    // registry is intentionally limited to foreground GUI tool calls.
    const registration = input.context.messageSource
      ? undefined
      : this.toolCancellation.register(
          {
            threadId: input.threadId,
            turnId: input.turnId,
            callId: input.call.callId
          },
          input.context.abortSignal
        )
    const executionInput: ToolExecutionInput = {
      ...input,
      ...(registration
        ? { context: { ...input.context, abortSignal: registration.signal } }
        : {})
    }
    try {
      const result = await this.execute(executionInput)
      if (input.context.abortSignal.aborted) {
        throw input.context.abortSignal.reason ?? new Error('Tool execution aborted')
      }
      if (registration?.wasCancelledByUser()) return this.cancelledResult(input)
      return result
    } catch (error) {
      if (error instanceof ToolAbortOutcomeUnknownError) return this.unknownOutcomeResult(input, error)
      if (input.context.abortSignal.aborted && !registration?.wasCancelledByUser()) throw error
      if (registration?.wasCancelledByUser()) return this.cancelledResult(input)
      const message = error instanceof Error ? error.message : String(error)
      await this.deps.events.record({
        kind: 'error',
        threadId: input.threadId,
        turnId: input.turnId,
        message: `Tool call ${input.call.toolName} failed: ${message}`,
        code: 'tool_execution_failed',
        severity: 'warning'
      })
      return {
        item: makeToolResultItem({
          id: `item_${input.call.callId}`,
          turnId: input.turnId,
          threadId: input.threadId,
          callId: input.call.callId,
          toolName: input.call.toolName,
          toolKind: input.call.toolKind ?? 'tool_call',
          output: {
            code: 'tool_execution_failed',
            error: message,
            guidance:
              'The tool crashed while executing. Adjust the arguments or take a different approach instead of retrying the identical call.'
          },
          isError: true
        }),
        approved: false
      }
    } finally {
      registration?.dispose()
    }
  }

  private cancelledResult(input: ToolExecutionInput): ToolHostResult {
    return {
      item: makeToolResultItem({
        id: `item_${input.call.callId}`,
        turnId: input.turnId,
        threadId: input.threadId,
        callId: input.call.callId,
        toolName: input.call.toolName,
        toolKind: input.call.toolKind ?? 'tool_call',
        output: {
          code: TOOL_CANCELLED_BY_USER_CODE,
          error: 'The user stopped this tool execution.',
          guidance:
            'Only this tool was stopped. Continue using the other tool results and choose an alternative approach. Do not repeat the identical call automatically.'
        },
        isError: true
      }),
      approved: false
    }
  }

  private unknownOutcomeResult(
    input: ToolExecutionInput,
    error: ToolAbortOutcomeUnknownError
  ): ToolHostResult {
    return {
      item: makeToolResultItem({
        id: `item_${input.call.callId}`,
        turnId: input.turnId,
        threadId: input.threadId,
        callId: input.call.callId,
        toolName: input.call.toolName,
        toolKind: input.call.toolKind ?? 'tool_call',
        output: {
          code: TOOL_ABORT_OUTCOME_UNKNOWN_CODE,
          error: error.message,
          guidance: 'The tool may still have completed externally. Inspect state before retrying.'
        },
        isError: true
      }),
      approved: false
    }
  }

  async persistResult(
    threadId: string,
    turnId: string,
    call: ToolCallLike,
    result: ToolHostResult
  ): Promise<void> {
    await this.deps.turns.updateItem(threadId, `item_tool_${turnId}_${call.callId}`, {
      status: result.item.kind === 'tool_result' && result.item.isError ? 'failed' : 'completed',
      finishedAt: this.deps.nowIso()
    } as Partial<TurnItem>)
    // Register before publishing the result. Otherwise the renderer can receive
    // the SSE item and POST its receipt before this process knows the key.
    await this.registerPendingDesignReceipt(threadId, turnId, call, result)
    const browserSafeItem = prepareBrowserUseToolResultForPersistence(result.item)
    await this.deps.turns.applyItem(
      threadId,
      await this.materializeLargeToolResult(threadId, turnId, call, browserSafeItem)
    )
    await this.afterResultPersisted(threadId, turnId, call, result)
    await this.deps.turns.compactItemHistory(threadId)
  }

  /**
   * When a design tool returns an `accepted` placeholder with a receiptKey,
   * register it so the loop can finalize the result once the renderer applies
   * the operations (or time out to an explicit `unverified` state).
   */
  private async registerPendingDesignReceipt(
    threadId: string,
    turnId: string,
    call: ToolCallLike,
    result: ToolHostResult
  ): Promise<void> {
    if (!this.deps.receipts || result.item.kind !== 'tool_result') return
    const output = result.item.output
    if (!isPendingReceiptOutput(output)) return
    this.deps.receipts.register({
      receiptKey: output.receiptKey,
      threadId,
      turnId,
      call,
      itemId: result.item.id,
      acceptedOutput: output as Record<string, unknown>
    })
  }

  async persistSuppressed(input: {
    threadId: string
    turnId: string
    call: ToolCallLike
    reason?: string
  }): Promise<void> {
    const item = makeToolResultItem({
      id: `item_${input.call.callId}_storm`,
      turnId: input.turnId,
      threadId: input.threadId,
      callId: input.call.callId,
      toolName: input.call.toolName,
      toolKind: input.call.toolKind ?? 'tool_call',
      output: { error: input.reason ?? 'duplicate tool call suppressed by repeat-loop guard' },
      isError: true
    })
    const message = input.reason ?? 'duplicate tool call suppressed by repeat-loop guard'
    await this.deps.turns.updateItem(input.threadId, `item_tool_${input.turnId}_${input.call.callId}`, {
      status: 'failed',
      finishedAt: this.deps.nowIso()
    } as Partial<TurnItem>)
    await this.deps.turns.applyItem(input.threadId, item)
    await this.deps.events.record({
      kind: 'tool_storm_suppressed',
      threadId: input.threadId,
      turnId: input.turnId,
      itemId: item.id,
      toolName: input.call.toolName,
      callId: input.call.callId,
      message
    })
  }

  private async execute(input: ToolExecutionInput): Promise<ToolHostResult> {
    return this.deps.inflight.run(
      {
        id: `inflight_${input.threadId}_${input.turnId}_${input.call.callId}`,
        kind: 'tool',
        threadId: input.threadId,
        turnId: input.turnId,
        callId: input.call.callId
      },
      async () => {
        try {
          await this.ensureWorkspaceCheckpoint(input)
          let acceptingUpdates = true
          let updateFailure: unknown
          let pendingUpdates = Promise.resolve()
          let durableProgressInitialized = false
          let lastProgressFingerprint: string | undefined
          let result: ToolHostResult
          try {
            const execution = this.deps.toolHost.execute(input.call, input.context, (item) => {
              if (!acceptingUpdates) return
              const fingerprint = progressFingerprint(item)
              if (fingerprint === lastProgressFingerprint) return pendingUpdates
              lastProgressFingerprint = fingerprint
              const update = pendingUpdates.then(async () => {
                const runningItem = { ...item, status: 'running' } as TurnItem
                if (durableProgressInitialized) {
                  await this.deps.turns.publishTransientItem(input.threadId, runningItem)
                  return
                }
                const existing = await this.deps.turns.updateItem(input.threadId, item.id, {
                    output: item.kind === 'tool_result' ? item.output : undefined,
                    isError: item.kind === 'tool_result' ? item.isError : undefined,
                    status: 'running'
                  } as Partial<TurnItem>)
                if (!existing) await this.deps.turns.applyItem(input.threadId, runningItem)
                durableProgressInitialized = true
              })
              pendingUpdates = update.catch((error) => {
                updateFailure ??= error
              })
              return update
            })
            result = await settleToolAfterAbort(execution, input.context.abortSignal, this.abortGraceMs)
          } finally {
            // Tool progress is scoped to the execute() promise. Detached work
            // may keep a callback reference, but it must not regress an already
            // completed tool_result back to "running".
            acceptingUpdates = false
            await pendingUpdates
          }
          if (updateFailure) throw updateFailure
          await this.recordSourceToolPage(input, result)
          return result
        } catch (error) {
          if (input.context.abortSignal.aborted || !isRecoverableToolDispatchError(error)) {
            throw error
          }
          const message = error instanceof Error ? error.message : String(error)
          const planActive = input.context.threadMode === 'plan' || Boolean(input.context.guiPlan)
          const guidance = planActive
            ? `\`${input.call.toolName}\` is not available in Plan mode. Continue with advertised read-only tools or \`generate_image\` when the user requests an image. Call \`create_plan\` and put a COMPLETE implementation plan in its \`markdown\` argument — concrete steps, the files to create with their intended contents, and how to verify. Do NOT copy this message into the plan; write the actual plan. If the request is still ambiguous, ask the user a clarifying question and wait instead.`
            : 'Use only tools advertised in the current turn context.'
          await this.deps.events.record({
            kind: 'error',
            threadId: input.threadId,
            turnId: input.turnId,
            message: `Tool call ${input.call.toolName} was rejected: ${message}`,
            code: 'tool_dispatch_rejected',
            severity: 'warning'
          })
          return {
            item: makeToolResultItem({
              id: `item_${input.call.callId}`,
              turnId: input.turnId,
              threadId: input.threadId,
              callId: input.call.callId,
              toolName: input.call.toolName,
              toolKind: input.call.toolKind ?? 'tool_call',
              output: { code: 'tool_dispatch_rejected', error: message, guidance },
              isError: true
            }),
            approved: false
          }
        }
      }
    )
  }

  private async recordSourceToolPage(input: ToolExecutionInput, result: ToolHostResult): Promise<void> {
    const toolName = input.call.toolName
    if (!['read', 'grep', 'glob', 'find'].includes(toolName)) return
    const output = result.item.kind === 'tool_result' && result.item.output && typeof result.item.output === 'object'
      ? result.item.output as Record<string, unknown> : undefined
    if (!output) return
    const hasMore = output.has_more === true
    const continuation = typeof output.next_offset === 'number'
      ? 'offset' as const
      : typeof output.next_cursor === 'string' ? 'cursor' as const : 'none' as const
    await this.deps.events.record({
      kind: 'source_tool_page',
      threadId: input.threadId,
      turnId: input.turnId,
      toolName: toolName as 'read' | 'grep' | 'glob' | 'find',
      callId: input.call.callId,
      hasMore,
      continuation,
      ...(input.context.sourceResultBudgetTokens !== undefined
        ? { budgetTokens: input.context.sourceResultBudgetTokens }
        : {})
    })
  }

  private async ensureWorkspaceCheckpoint(input: ToolExecutionInput): Promise<void> {
    const requestId = input.context.workspaceCheckpointRequestId?.trim()
    if (
      !requestId ||
      !this.deps.awaitWorkspaceCheckpoint ||
      (input.call.toolKind !== 'file_change' && input.call.toolKind !== 'command_execution')
    ) return

    const key = `${input.turnId}:${requestId}`
    let gate = this.checkpointGates.get(key)
    if (!gate) {
      gate = (async () => {
        const checkpointId = await this.deps.awaitWorkspaceCheckpoint!(
          requestId,
          input.context.abortSignal
        )
        if (!checkpointId) return
        await this.deps.turns.updateTurnMetadata(input.threadId, input.turnId, {
          workspaceCheckpointId: checkpointId
        })
        await this.deps.turns.updateItem(
          input.threadId,
          `item_${input.turnId}_user`,
          { workspaceCheckpointId: checkpointId }
        )
      })()
      this.checkpointGates.set(key, gate)
      if (this.checkpointGates.size > 512) {
        const oldest = this.checkpointGates.keys().next().value
        if (oldest !== undefined) this.checkpointGates.delete(oldest)
      }
    }
    await gate
  }

  private async afterResultPersisted(
    threadId: string,
    turnId: string,
    call: ToolCallLike,
    result: ToolHostResult
  ): Promise<void> {
    if (call.toolName !== CREATE_PLAN_TOOL_NAME) return
    if (result.item.kind !== 'tool_result' || result.item.isError === true) return
    const output = result.item.output
    if (!output || typeof output !== 'object') return
    const record = output as Record<string, unknown>
    const planId = typeof record.plan_id === 'string' ? record.plan_id : ''
    const relativePath = typeof record.relative_path === 'string' ? record.relative_path : ''
    const markdown = typeof call.arguments.markdown === 'string' ? call.arguments.markdown : ''
    if (!planId || !relativePath || !markdown) return
    try {
      await this.deps.onPlanWritten?.({ threadId, turnId, planId, relativePath, markdown })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.deps.events.record({
        kind: 'error',
        threadId,
        turnId,
        message: `Failed to sync plan checklist to thread todos: ${message}`,
        code: 'todo_plan_sync_failed',
        severity: 'warning'
      })
    }
  }

  private async materializeLargeToolResult(
    threadId: string,
    turnId: string,
    call: ToolCallLike,
    item: TurnItem
  ): Promise<TurnItem> {
    if (!this.deps.artifactStore || item.kind !== 'tool_result') return item
    let content: string
    try {
      content = JSON.stringify(item.output)
    } catch {
      content = String(item.output)
    }
    const byteSize = Buffer.byteLength(content, 'utf8')
    if (byteSize <= TOOL_RESULT_ARTIFACT_THRESHOLD_BYTES) return item
    try {
      const stored = await this.deps.artifactStore.put({
        content,
        mimeType: 'application/json',
        source: 'tool',
        origin: call.toolName,
        linkedOwners: [threadId, turnId],
        maxInlineChars: TOOL_RESULT_PREVIEW_CHARS
      })
      return {
        ...item,
        output: {
          artifactId: stored.meta.id,
          byteSize: stored.meta.byteSize,
          lineCount: stored.meta.lineCount,
          mimeType: stored.meta.mimeType ?? 'application/json',
          inline: stored.summary.inline,
          truncated: true
        }
      }
    } catch (error) {
      return {
        ...item,
        output: {
          artifactUnavailable: true,
          byteSize,
          preview: content.slice(0, TOOL_RESULT_PREVIEW_CHARS),
          reason: error instanceof Error ? error.message : String(error)
        }
      }
    }
  }
}

function progressFingerprint(item: TurnItem): string {
  if (item.kind !== 'tool_result') return JSON.stringify(item)
  return JSON.stringify([item.output, item.isError, item.status])
}

function isRecoverableToolDispatchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.startsWith('unknown tool:') ||
    message.includes(' is not provided by ') ||
    message.includes(' is not advertised') ||
    message.includes(' is disabled by policy')
}

async function settleToolAfterAbort<T>(
  execution: Promise<T>,
  signal: AbortSignal,
  graceMs: number
): Promise<T> {
  type Settled = { status: 'fulfilled'; value: T } | { status: 'rejected'; reason: unknown }
  const settled: Promise<Settled> = execution.then(
    (value) => ({ status: 'fulfilled', value }),
    (reason) => ({ status: 'rejected', reason })
  )
  let onAbort: (() => void) | undefined
  const aborted = signal.aborted
    ? Promise.resolve<'aborted'>('aborted')
    : new Promise<'aborted'>((resolve) => {
        onAbort = () => resolve('aborted')
        signal.addEventListener('abort', onAbort, { once: true })
      })
  const first = await Promise.race([settled, aborted])
  if (onAbort) signal.removeEventListener('abort', onAbort)
  if (first !== 'aborted') return unwrapSettled(first)

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), graceMs)
    timer.unref?.()
  })
  const afterAbort = await Promise.race([settled, timeout])
  if (timer) clearTimeout(timer)
  if (afterAbort === 'timeout') throw new ToolAbortOutcomeUnknownError(graceMs)
  return unwrapSettled(afterAbort)
}

function unwrapSettled<T>(settled: { status: 'fulfilled'; value: T } | { status: 'rejected'; reason: unknown }): T {
  if (settled.status === 'rejected') throw settled.reason
  return settled.value
}
