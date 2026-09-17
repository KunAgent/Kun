import { createHash } from 'node:crypto'
import { readFile, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import {
  MEMORY_FEEDBACK_SCHEMA_VERSION,
  MemoryConfirmRequest,
  MemoryConfirmResult,
  MemoryCorrectRequest,
  MemoryCorrectResult,
  MemoryFeedbackEvent,
  type MemoryConfirmRequest as MemoryConfirmRequestValue,
  type MemoryConfirmResult as MemoryConfirmResultValue,
  type MemoryCorrectRequest as MemoryCorrectRequestValue,
  type MemoryCorrectResult as MemoryCorrectResultValue,
  type MemoryFeedbackConfig,
  type MemoryFeedbackErrorCode,
  type MemoryFeedbackEvent as MemoryFeedbackEventValue
} from '../contracts/memory-feedback.js'
import type { MemoryRecord } from '../contracts/memory.js'
import { withMemoryMutation } from './memory-mutation-queue.js'
import { memoryLifecycleState } from './memory-ranking.js'
import type { MemoryStore } from './memory-store.js'

const CorrectionReceipt = z.object({
  schemaVersion: z.literal(1),
  operationId: z.string().min(1).max(256),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/u),
  previousMemoryId: z.string().min(1).max(256),
  replacementMemoryId: z.string().min(1).max(256),
  correctedAt: z.string().datetime(),
  request: MemoryCorrectRequest.optional(),
  state: z.enum(['prepared', 'canonical-applied', 'feedback-recorded', 'abandoned'])
}).strict().superRefine((receipt, context) => {
  if (receipt.state === 'feedback-recorded' || receipt.state === 'abandoned' || receipt.request) return
  context.addIssue({ code: 'custom', path: ['request'], message: 'unfinished correction receipt requires request' })
})
type CorrectionReceipt = z.infer<typeof CorrectionReceipt>

// Terminal receipts are retained so operation id replays resolve idempotently;
// the directory is pruned to a bounded tail on every reconcile pass.
const CORRECTION_RECEIPT_LIMIT = 64

export type MemoryFeedbackLedgerPort = {
  append(event: MemoryFeedbackEventValue): Promise<'appended' | 'replayed'>
  event(eventId: string): Promise<MemoryFeedbackEventValue | undefined>
}

export class MemoryFeedbackServiceError extends Error {
  constructor(readonly code: MemoryFeedbackErrorCode, message: string) {
    super(message)
    this.name = 'MemoryFeedbackServiceError'
  }
}

export class MemoryFeedbackService {
  constructor(private readonly options: {
    dataDir: string
    memoryStore: MemoryStore
    feedbackStore: MemoryFeedbackLedgerPort
    config: MemoryFeedbackConfig | (() => MemoryFeedbackConfig)
    nowIso?: () => string
    writeReceipt?: (path: string, contents: string) => Promise<void>
    afterReceiptPrepared?: () => Promise<void>
    afterCanonicalMutation?: () => Promise<void>
    afterFeedbackAppend?: () => Promise<void>
  }) {}

  async ready(): Promise<void> {
    await withMemoryMutation(this.receiptRoot(), async () => {
      let entries: string[]
      try {
        entries = await readdir(this.receiptRoot())
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error
      }
      for (const entry of entries.filter((value) => /^correction-[a-f0-9]{32}\.json$/u.test(value)).sort()) {
        const path = join(this.receiptRoot(), entry)
        // An unreadable receipt can never reconcile; moving it aside keeps the
        // payload for forensics without warning on every startup.
        const receipt = await this.readReceiptPath(path).catch(async () => {
          await rename(path, `${path}.corrupt`).catch(() => undefined)
          return undefined
        })
        if (!receipt) continue
        if (receipt.request && receipt.requestHash !== stableHash(receipt.request)) {
          await rename(path, `${path}.corrupt`).catch(() => undefined)
          continue
        }
        if (receipt.state === 'feedback-recorded' || receipt.state === 'abandoned') continue
        try {
          await this.reconcileCorrection(receipt)
        } catch (error) {
          const current = await this.readReceipt(receipt.operationId).catch(() => undefined)
          if (current?.state === 'abandoned') continue
          // A temporarily inactive memory keeps the prepared receipt for the
          // next startup instead of warning forever.
          if (error instanceof MemoryFeedbackServiceError && error.code === 'inactive') continue
          throw error
        }
      }
      await this.pruneTerminalReceipts()
    })
  }

  async confirm(raw: MemoryConfirmRequestValue): Promise<MemoryConfirmResultValue> {
    const request = MemoryConfirmRequest.parse(raw)
    if (!this.config().enabled) throw new MemoryFeedbackServiceError('unavailable', 'memory feedback is disabled')
    const eventId = confirmEventId(request.operationId)
    const existing = await this.options.feedbackStore.event(eventId)
    if (existing) {
      if (existing.kind !== 'confirmed' || existing.memoryId !== request.memoryId) {
        throw new MemoryFeedbackServiceError('id-conflict', 'memory confirmation operation id conflicts')
      }
      return MemoryConfirmResult.parse({
        memoryId: existing.memoryId,
        eventId: existing.id,
        confirmedAt: existing.occurredAt,
        replayed: true
      })
    }
    await this.mustActiveMemory(request.memoryId, request.access)
    const event = MemoryFeedbackEvent.parse({
      schemaVersion: MEMORY_FEEDBACK_SCHEMA_VERSION,
      id: eventId,
      kind: 'confirmed',
      memoryId: request.memoryId,
      occurredAt: this.now()
    })
    const result = await this.options.feedbackStore.append(event)
    return MemoryConfirmResult.parse({
      memoryId: event.memoryId,
      eventId: event.id,
      confirmedAt: event.occurredAt,
      replayed: result === 'replayed'
    })
  }

  async correct(raw: MemoryCorrectRequestValue): Promise<MemoryCorrectResultValue> {
    const request = MemoryCorrectRequest.parse(raw)
    return withMemoryMutation(this.receiptRoot(), async () => {
      const requestHash = stableHash(request)
      let receipt = await this.readReceipt(request.operationId)
      const replayedBeforeCall = receipt?.state === 'feedback-recorded'
      if (receipt) {
        if (receipt.requestHash !== requestHash || receipt.previousMemoryId !== request.memoryId) {
          throw new MemoryFeedbackServiceError('id-conflict', 'memory correction operation id conflicts')
        }
      } else {
        await this.mustActiveMemory(request.memoryId, request.access)
        receipt = CorrectionReceipt.parse({
          schemaVersion: 1,
          operationId: request.operationId,
          requestHash,
          previousMemoryId: request.memoryId,
          replacementMemoryId: replacementId(request.operationId),
          correctedAt: this.now(),
          request,
          state: 'prepared'
        })
        await this.persistReceipt(receipt)
        await this.options.afterReceiptPrepared?.()
      }
      const reconciled = await this.reconcileCorrection(receipt)
      await this.pruneTerminalReceipts()

      return MemoryCorrectResult.parse({
        previousMemoryId: reconciled.receipt.previousMemoryId,
        replacementMemoryId: reconciled.receipt.replacementMemoryId,
        eventId: correctEventId(request.operationId),
        correctedAt: reconciled.receipt.correctedAt,
        replayed: replayedBeforeCall || reconciled.feedbackReplayed
      })
    })
  }

  private async reconcileCorrection(initial: CorrectionReceipt): Promise<{
    receipt: CorrectionReceipt
    feedbackReplayed: boolean
  }> {
    let receipt = initial
    let feedbackReplayed = false
    const request = receipt.request
    if (receipt.state === 'abandoned') {
      throw new MemoryFeedbackServiceError('inactive', 'memory correction can no longer be applied')
    }
    if (receipt.state !== 'feedback-recorded' && !request) {
      throw new MemoryFeedbackServiceError('validation', 'memory correction receipt request is missing')
    }
    if (receipt.state === 'prepared') {
      const previous = await this.findMemory(receipt.previousMemoryId, request!.access)
      if (!previous) return this.abandonCorrection(receipt, 'not-found', 'memory not found')
      const existingReplacement = await this.findMemory(receipt.replacementMemoryId, request!.access)
      if (existingReplacement && existingReplacement.supersedes !== previous.id) {
        return this.abandonCorrection(receipt, 'id-conflict', 'memory correction replacement id conflicts')
      }
      if (!existingReplacement) {
        const lifecycle = memoryLifecycleState(previous, Date.parse(this.now()))
        // Disabled or not-yet-valid records can return to active, so those
        // receipts stay prepared; every other state is terminal.
        if (lifecycle === 'disabled' || lifecycle === 'not-yet-valid') {
          throw new MemoryFeedbackServiceError('inactive', 'memory changed before correction could be applied')
        }
        if (lifecycle !== 'active') {
          return this.abandonCorrection(receipt, 'inactive', 'memory can no longer be corrected')
        }
      }
      if (!this.options.memoryStore.createWithId) {
        return this.abandonCorrection(receipt, 'unavailable', 'memory store does not support correction identities')
      }
        await this.options.memoryStore.createWithId(
          receipt.replacementMemoryId,
          replacementInput(previous, request!)
      )
      await this.options.afterCanonicalMutation?.()
      receipt = await this.advanceReceipt(receipt, 'canonical-applied')
    }

    if (receipt.state === 'canonical-applied') {
      const appendResult = await this.options.feedbackStore.append(MemoryFeedbackEvent.parse({
        schemaVersion: MEMORY_FEEDBACK_SCHEMA_VERSION,
        id: correctEventId(receipt.operationId),
        kind: 'corrected',
        memoryId: receipt.previousMemoryId,
        replacementMemoryId: receipt.replacementMemoryId,
        occurredAt: receipt.correctedAt
      }))
      feedbackReplayed = appendResult === 'replayed'
      await this.options.afterFeedbackAppend?.()
      receipt = await this.advanceReceipt(receipt, 'feedback-recorded')
    }
    return { receipt, feedbackReplayed }
  }

  private async mustActiveMemory(
    memoryId: string,
    access: { workspace?: string; project?: string }
  ): Promise<MemoryRecord> {
    const memory = await this.findMemory(memoryId, access)
    if (!memory) throw new MemoryFeedbackServiceError('not-found', 'memory not found')
    if (memoryLifecycleState(memory, Date.parse(this.now())) !== 'active') {
      throw new MemoryFeedbackServiceError('inactive', 'memory is not active')
    }
    return memory
  }

  private async findMemory(
    memoryId: string,
    access: { workspace?: string; project?: string }
  ): Promise<MemoryRecord | undefined> {
    return (await this.options.memoryStore.list({ ...access, includeDeleted: true }))
      .find((memory) => memory.id === memoryId)
  }

  private async readReceipt(operationId: string): Promise<CorrectionReceipt | undefined> {
    try {
      return await this.readReceiptPath(this.receiptPath(operationId))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw new MemoryFeedbackServiceError('validation', 'memory correction receipt is invalid')
    }
  }

  private async readReceiptPath(path: string): Promise<CorrectionReceipt> {
    return CorrectionReceipt.parse(JSON.parse(await readFile(path, 'utf8')) as unknown)
  }

  private async abandonCorrection(
    receipt: CorrectionReceipt,
    code: MemoryFeedbackErrorCode,
    message: string
  ): Promise<never> {
    await this.advanceReceipt(receipt, 'abandoned')
    throw new MemoryFeedbackServiceError(code, message)
  }

  private async advanceReceipt(receipt: CorrectionReceipt, state: CorrectionReceipt['state']): Promise<CorrectionReceipt> {
    const next = CorrectionReceipt.parse({
      ...receipt,
      state,
      ...(state === 'feedback-recorded' || state === 'abandoned' ? { request: undefined } : {})
    })
    await this.persistReceipt(next)
    return next
  }

  private async pruneTerminalReceipts(): Promise<void> {
    const entries = await readdir(this.receiptRoot()).catch(() => [] as string[])
    const terminal: Array<{ path: string; correctedAt: string }> = []
    for (const entry of entries) {
      if (!/^correction-[a-f0-9]{32}\.json$/u.test(entry)) continue
      const path = join(this.receiptRoot(), entry)
      const receipt = await this.readReceiptPath(path).catch(() => undefined)
      if (receipt?.state === 'feedback-recorded' || receipt?.state === 'abandoned') {
        terminal.push({ path, correctedAt: receipt.correctedAt })
      }
    }
    if (terminal.length <= CORRECTION_RECEIPT_LIMIT) return
    terminal.sort((left, right) => right.correctedAt.localeCompare(left.correctedAt) || right.path.localeCompare(left.path))
    for (const entry of terminal.slice(CORRECTION_RECEIPT_LIMIT)) await rm(entry.path, { force: true })
  }

  private async persistReceipt(receipt: CorrectionReceipt): Promise<void> {
    const contents = `${JSON.stringify(receipt, null, 2)}\n`
    const path = this.receiptPath(receipt.operationId)
    if (this.options.writeReceipt) return this.options.writeReceipt(path, contents)
    await atomicWriteFile(path, contents, { durable: true, allowDirectWriteFallback: false })
  }

  private receiptRoot(): string { return join(this.options.dataDir, 'memory-feedback-corrections') }
  private receiptPath(operationId: string): string {
    return join(this.receiptRoot(), `correction-${stableHash(operationId).slice(0, 32)}.json`)
  }
  private config(): MemoryFeedbackConfig {
    return typeof this.options.config === 'function' ? this.options.config() : this.options.config
  }
  private now(): string { return this.options.nowIso?.() ?? new Date().toISOString() }
}

function replacementInput(previous: MemoryRecord, request: ReturnType<typeof MemoryCorrectRequest.parse>) {
  const replacement = request.replacement
  return {
    content: replacement.content,
    scope: previous.scope,
    workspace: previous.workspace,
    project: previous.project,
    provenance: { kind: 'user' as const, origin: 'memory_correction' },
    tags: replacement.tags ?? previous.tags,
    confidence: replacement.confidence ?? 1,
    type: replacement.type ?? previous.type,
    importance: replacement.importance ?? previous.importance,
    observedAt: replacement.observedAt,
    validFrom: replacement.validFrom === undefined ? previous.validFrom : replacement.validFrom ?? undefined,
    validTo: replacement.validTo === undefined ? previous.validTo : replacement.validTo ?? undefined,
    expiresAt: replacement.expiresAt === undefined ? previous.expiresAt : replacement.expiresAt ?? undefined,
    sources: [{ id: `correction-${stableHash(request.operationId).slice(0, 24)}`, kind: 'user' as const, trust: 'explicit-user' as const }],
    supersedes: previous.id
  }
}

function replacementId(operationId: string): string {
  return `mem_correction_${stableHash(operationId).slice(0, 24)}`
}

function confirmEventId(operationId: string): string {
  return `feedback-confirm-${stableHash(operationId).slice(0, 32)}`
}

function correctEventId(operationId: string): string {
  return `feedback-correct-${stableHash(operationId).slice(0, 32)}`
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
