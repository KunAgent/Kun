import { makeToolResultItem } from '../domain/item.js'
import type { ToolResultTurnItem as ToolResultItem } from '../contracts/items.js'
import type { RuntimeEventRecorder } from './runtime-event-recorder.js'
import type { TurnService } from './turn-service.js'
import type { ToolCallLike } from '../ports/tool-host.js'

/**
 * Bounded registry for renderer-executed design-tool receipts.
 *
 * Design canvas tools return `{ ok: true, status: 'accepted', receiptKey, ops }`
 * without claiming the renderer applied anything. The renderer later POSTs a
 * receipt (`applied` / `failed`) through the HTTP route, and this registry
 * finalizes the persisted tool result (overwriting the accepted placeholder)
 * so the model sees the REAL outcome on its next request.
 *
 * Process-local + event-recorded. After a runtime restart the pending entries
 * are gone and the accepted placeholder simply stays `unverified` — the loop
 * timeout path covers that case instead of pretending success.
 */
export type CanvasReceiptStatus = 'applied' | 'failed'

export type CanvasReceiptPayload = {
  status: CanvasReceiptStatus
  errors?: Array<{ code: string; message: string; suggestion?: string }>
  affectedIds?: string[]
  generatedFiles?: Array<{
    name: string
    relativePath: string
    absolutePath?: string
    mimeType: 'image/png' | 'image/svg+xml'
    byteSize: number
  }>
}

export type CanvasReceiptRegistryDeps = {
  turns: Pick<TurnService, 'applyItem'>
  events: Pick<RuntimeEventRecorder, 'record'>
  nowIso: () => string
}

type PendingReceipt = {
  receiptKey: string
  threadId: string
  turnId: string
  call: ToolCallLike
  itemId: string
  /** The accepted placeholder output; used as the base for the final result. */
  acceptedOutput: Record<string, unknown>
  onFinalized?: (item: ToolResultItem) => void
  resolve: (payload: CanvasReceiptPayload | null) => void
  settled: boolean
  waiting: boolean
  fulfilling: boolean
  finalization?: Promise<void>
  waitPromise?: Promise<void>
}

export class CanvasReceiptRegistry {
  private readonly pending = new Map<string, PendingReceipt>()
  private readonly deps: CanvasReceiptRegistryDeps

  constructor(deps: CanvasReceiptRegistryDeps) {
    this.deps = deps
  }

  register(input: {
    receiptKey: string
    threadId: string
    turnId: string
    call: ToolCallLike
    itemId: string
    acceptedOutput: Record<string, unknown>
    onFinalized?: (item: ToolResultItem) => void
  }): void {
    const key = input.receiptKey.trim()
    if (!key) return
    if (this.pending.has(key)) return
    this.pending.set(key, {
      receiptKey: key,
      threadId: input.threadId,
      turnId: input.turnId,
      call: input.call,
      itemId: input.itemId,
      acceptedOutput: input.acceptedOutput,
      onFinalized: input.onFinalized,
      resolve: () => undefined,
      settled: false,
      waiting: false,
      fulfilling: false
    })
  }

  /**
   * Wait until every receipt registered for this turn has been fulfilled or
   * timed out. Each entry is finalized exactly once (fulfill wins over the
   * timeout race). `null` timeout payloads finalize as `unverified`.
   */
  async awaitTurnReceipts(
    threadId: string,
    turnId: string,
    timeoutMs: number,
    nowMs: () => number = Date.now
  ): Promise<void> {
    const entries = [...this.pending.values()].filter(
      (entry) =>
        entry.threadId === threadId && entry.turnId === turnId
    )
    await Promise.all(entries.map((entry) => this.awaitReceipt(entry.receiptKey, timeoutMs)))
    void nowMs
  }

  /**
   * Backward-compatible TURN-level receipt. New renderer calls use
   * fulfillForTurn with the receipt key so every tool is acknowledged as soon
   * as its own result is applied.
   */
  async fulfillTurn(
    threadId: string,
    turnId: string,
    payload: CanvasReceiptPayload
  ): Promise<boolean> {
    const entries = [...this.pending.values()].filter(
      (entry) =>
        entry.threadId === threadId && entry.turnId === turnId &&
        !entry.settled && !entry.fulfilling
    )
    if (entries.length === 0) return false
    for (const entry of entries) {
      await this.fulfillEntry(entry, payload)
    }
    return true
  }

  /**
   * Per-key fulfillment for callers that do not have turn ownership metadata.
   * Idempotent: a second receipt for the same key is ignored.
   */
  async fulfill(receiptKey: string, payload: CanvasReceiptPayload): Promise<boolean> {
    const entry = this.pending.get(receiptKey)
    if (!entry || entry.settled || entry.fulfilling) return false
    return this.fulfillEntry(entry, payload)
  }

  /** Fulfill one renderer call without allowing a receipt to cross turn boundaries. */
  async fulfillForTurn(
    receiptKey: string,
    threadId: string,
    turnId: string,
    payload: CanvasReceiptPayload
  ): Promise<boolean> {
    const entry = this.pending.get(receiptKey)
    if (
      !entry ||
      entry.settled ||
      entry.fulfilling ||
      entry.threadId !== threadId ||
      entry.turnId !== turnId
    ) return false
    return this.fulfillEntry(entry, payload)
  }

  private async fulfillEntry(
    entry: PendingReceipt,
    payload: CanvasReceiptPayload
  ): Promise<boolean> {
    entry.fulfilling = true
    try {
      // Record while the entry is still awaitable. This prevents the loop from
      // observing `settled` and advancing before the accepted item is replaced.
      await this.deps.events.record({
        kind: 'canvas_receipt',
        threadId: entry.threadId,
        turnId: entry.turnId,
        itemId: entry.itemId,
        receiptKey: entry.receiptKey,
        status: payload.status,
        ...(payload.errors?.length ? { errorCount: payload.errors.length } : {}),
        ...(payload.affectedIds?.length ? { affectedCount: payload.affectedIds.length } : {})
      })
      entry.settled = true
      const finalization = this.finalize(entry, payload)
      entry.resolve(payload)
      await finalization
      return true
    } finally {
      entry.fulfilling = false
    }
  }

  /** Await only one bridge call; sibling SDK calls may wait concurrently. */
  async awaitReceipt(receiptKey: string, timeoutMs: number): Promise<void> {
    const entry = this.pending.get(receiptKey)
    if (!entry) return
    if (entry.finalization) return entry.finalization
    entry.waitPromise ??= this.awaitOne(entry, timeoutMs, Date.now)
    await entry.waitPromise
  }

  /** Count of pending (unfulfilled) receipts for diagnostics. */
  pendingCount(): number {
    return this.pending.size
  }

  private async awaitOne(
    entry: PendingReceipt,
    timeoutMs: number,
    nowMs: () => number
  ): Promise<void> {
    entry.waiting = true
    try {
      const payload = await new Promise<CanvasReceiptPayload | null>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined
        entry.resolve = (value) => {
          if (timer) clearTimeout(timer)
          resolve(value)
        }
        timer = setTimeout(() => {
          if (entry.settled) return
          entry.settled = true
          entry.resolve = () => undefined
          resolve(null)
        }, Math.max(1, timeoutMs))
        if (typeof (timer as { unref?: () => void }).unref === 'function') {
          ;(timer as { unref: () => void }).unref()
        }
      })
      void nowMs
      await this.finalize(entry, payload)
    } finally {
      entry.waiting = false
    }
  }

  private finalize(entry: PendingReceipt, payload: CanvasReceiptPayload | null): Promise<void> {
    entry.finalization ??= this.persistFinalResult(entry, payload)
    return entry.finalization
  }

  private async persistFinalResult(entry: PendingReceipt, payload: CanvasReceiptPayload | null): Promise<void> {
    const base = { ...entry.acceptedOutput }
    let output: Record<string, unknown>
    let isError: boolean
    if (payload) {
      output = {
        ...base,
        ok: payload.status === 'applied',
        status: payload.status,
        unverified: false,
        ...(payload.errors?.length ? { errors: payload.errors } : {}),
        ...(payload.affectedIds?.length ? { affectedIds: payload.affectedIds } : {}),
        ...(payload.generatedFiles?.length ? { generatedFiles: payload.generatedFiles } : {})
      }
      isError = payload.status === 'failed'
    } else {
      // Timeout / restart: never report a verified success without a receipt.
      output = {
        ...base,
        ok: false,
        status: 'accepted',
        unverified: true,
        hint: 'renderer receipt timed out; the canvas may not have applied these operations.'
      }
      isError = true
    }
    const item = makeToolResultItem({
      id: entry.itemId,
      turnId: entry.turnId,
      threadId: entry.threadId,
      callId: entry.call.callId,
      toolName: entry.call.toolName,
      toolKind: entry.call.toolKind ?? 'tool_call',
      output,
      isError
    })
    await this.deps.turns.applyItem(entry.threadId, item)
    if (item.kind === 'tool_result') entry.onFinalized?.(item)
    if (this.pending.get(entry.receiptKey) === entry) this.pending.delete(entry.receiptKey)
  }
}

export function isPendingReceiptOutput(output: unknown): output is Record<string, unknown> & {
  receiptKey: string
  status: 'accepted'
} {
  if (!output || typeof output !== 'object') return false
  const record = output as Record<string, unknown>
  return typeof record.receiptKey === 'string' &&
    Boolean(record.receiptKey.trim()) &&
    record.status === 'accepted'
}
