import { createOpenCodeReference, inspectOpenCode } from './opencode-history.js'
import { discoverOpenCodeSessions, type OpenCodeDiscoveryOptions } from './opencode-discovery.js'
import { historySourceAdapter } from './history-source-adapter.js'
import { HistorySourceProviderSchema, OpenCodeSourceKindSchema, type OpenCodeSource, type HistorySourceProvider } from '../contracts/history-reference.js'
import { randomUUID } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import type { ThreadRecord } from '../contracts/threads.js'
import type { HistoryReference } from '../contracts/history-reference.js'
import type { ThreadService } from '../services/thread-service.js'
import type { ThreadStore } from '../ports/thread-store.js'
import {
  createHistoryReference, createHistoryPreviewReference, createHistorySubreference, inspectCodexSession,
  HistorySourceError,
  readHistoryPage, readSourceHistory, relinkHistoryReference
} from './codex-history.js'
import { HistoryReferenceStore, historyKey } from './history-reference-store.js'
import { invalidateCodexIndexCache } from './codex-index-cache.js'
import { readHistoryAttachment } from './history-reference-attachments.js'

export const CreateReferenceBranchSchema = z.object({
  sourceProvider: HistorySourceProviderSchema.optional(),
  sourceKind: OpenCodeSourceKindSchema.optional(),
  sessionId: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  referenceId: z.string().min(1).optional(),
  cutoffTurnId: z.string().min(1).optional(),
  workspace: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  providerId: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).max(256)
}).strict().refine((value) => Boolean(value.path) !== Boolean(value.referenceId), {
  message: 'Specify exactly one source path or reference ID'
})
export type CreateReferenceBranchInput = z.infer<typeof CreateReferenceBranchSchema>
export type HistoryReferenceServiceOptions = {
  dataDir: string
  threadService: ThreadService
  threadStore?: ThreadStore
  enabled: () => boolean
  enabledFor?: (provider: HistorySourceProvider) => boolean
  claudeHome?: string
  defaultModel: () => { model: string; providerId?: string; accountId?: string }
  opencodeHome?: string
  codexHome?: string
}
export class HistoryReferenceError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 400) {
    super(message)
    this.name = 'HistoryReferenceError'
  }
}

export class HistoryReferenceService {
  readonly store: HistoryReferenceStore

  constructor(private readonly options: HistoryReferenceServiceOptions) {
    this.store = new HistoryReferenceStore(options.dataDir)
  }

  isEnabled(provider?: HistorySourceProvider): boolean {
    return provider ? this.options.enabledFor?.(provider) ?? (provider === 'codex' && this.options.enabled())
      : this.isEnabled('codex') || this.isEnabled('claude-code') || this.isEnabled('opencode')
  }

  assertEnabled(provider?: HistorySourceProvider): void {
    if (!this.isEnabled(provider)) throw new HistoryReferenceError('history_reference_disabled',
      'Enable the source history branches in Labs to access external history.', 403)
  }

  get(id: string): Promise<HistoryReference | null> { return this.store.get(id) }

  /** Legacy branches already have a trusted host reservation even without a session snapshot. */
  async recoverBinding(threadId: string): Promise<{ historyRefId: string; workspace: string } | null> {
    for (const { value } of await this.store.reservations()) {
      if (value.threadId !== threadId || !value.completed || value.deleted) continue
      const reference = await this.store.get(value.referenceId)
      if (reference) return { historyRefId: reference.id, workspace: value.request?.workspace ?? reference.workspace }
    }
    return null
  }

  async discover(options: OpenCodeDiscoveryOptions = {}, provider: HistorySourceProvider = 'codex') {
    this.assertEnabled()
    this.assertEnabled(provider)
    const sessions = provider === 'opencode' ? await discoverOpenCodeSessions({ ...options, opencodeHome: this.options.opencodeHome }) : await historySourceAdapter(provider).discover({ ...options, codexHome: this.options.codexHome, claudeHome: this.options.claudeHome })
    this.assertEnabled(provider)
    this.assertEnabled()
    return sessions
  }

  async preview(input: { path: string; sourceKind?: OpenCodeSource['kind']; sessionId?: string; cursor?: string; limit?: number }, provider: HistorySourceProvider = 'codex') {
    this.assertEnabled()
    this.assertEnabled(provider)
    const path = sourcePath(input.path, provider)
    if (provider === 'opencode') {
      const { reference, ...inspected } = await inspectOpenCode(path, input.sessionId, input.sourceKind)
      const page = reference ? await readHistoryPage(reference, { threadId: `preview:${reference.sessionId}`, cursor: input.cursor, limit: input.limit })
        : { turns: [], hasMore: false, itemCount: 0, itemBytes: 0, status: 'partial' as const, warnings: inspected.warnings }
      this.assertEnabled(provider)
      return { ...inspected, page }
    }
    const inspected = await inspectCodexSession(path, provider)
    this.assertEnabled(provider)
    const previewReference = provider === 'claude-code' ? await createHistoryPreviewReference(path, provider) : undefined
    if (!inspected.cutoffs.length && !previewReference) return { ...inspected, page: {
      turns: [], hasMore: false, itemCount: 0, itemBytes: 0,
      status: 'partial' as const, warnings: ['No completed turn is available for branching.']
    } }
    const reference = previewReference ?? await createHistoryReference(path, undefined, provider)
    const page = await readHistoryPage(reference, {
      threadId: `preview:${reference.sessionId}`, cursor: input.cursor, limit: input.limit
    })
    this.assertEnabled()
    this.assertEnabled(provider)
    return { ...inspected, page }
  }

  async createBranch(raw: CreateReferenceBranchInput): Promise<{
    thread: ThreadRecord; reference: HistoryReference
  }> {
    this.assertEnabled()
    const input = CreateReferenceBranchSchema.parse(raw)
    const sourceProvider = input.referenceId ? (await this.requireReference(input.referenceId)).provider : input.sourceProvider ?? 'codex'
    this.assertEnabled(sourceProvider)
    const requestHash = historyKey(JSON.stringify(input))
    return this.store.withLifecycleMutation(async () => {
      this.assertEnabled(sourceProvider)
      let reservation = await this.store.getReservation(input.idempotencyKey)
      if (reservation && reservation.requestHash !== requestHash) {
        throw new HistoryReferenceError('history_request_conflict',
          'This request ID was already used with different branch options.', 409)
      }
      if (reservation?.deleted) throw new HistoryReferenceError('history_branch_deleted',
        'The branch created by this request was deleted. Start a new branch request.', 409)
      if (!reservation) {
        const reference = await this.resolveBranchReference(input)
        this.assertEnabled(sourceProvider)
        const existing = await this.store.get(reference.id)
        const defaults = this.options.defaultModel()
        const workspace = input.workspace?.trim() || reference.workspace
        if (!workspace || !isAbsolute(workspace)) {
          throw new HistoryReferenceError('history_workspace_required',
            'Choose an absolute workspace directory for this branch.')
        }
        // A user-selected equivalent snapshot can also repair its shared source location.
        await this.store.put(existing ? { ...existing, files: reference.files, ...(reference.provider === 'opencode' ? { source: reference.source } : {}), workspace: reference.workspace } : reference)
        reservation = {
          requestHash, referenceId: reference.id, threadId: `thr_${randomUUID()}`,
          request: {
            title: reference.title || 'History branch', workspace: resolve(workspace),
            model: input.model ?? defaults.model,
            providerId: input.providerId ?? defaults.providerId,
            accountId: input.accountId ?? defaults.accountId,
            agentSurface: 'code', mode: 'agent'
          }, completed: false
        }
        await this.store.saveReservation(input.idempotencyKey, reservation)
      }
      let thread = await this.options.threadService.getMetadata(reservation.threadId)
      if (!thread && reservation.completed) {
        throw new HistoryReferenceError('history_branch_deleted',
          'The branch created by this request was deleted. Start a new branch request.', 409)
      }
      const reference = await this.requireReference(reservation.referenceId)
      this.assertEnabled(sourceProvider)
      if (!thread) thread = await this.options.threadService.create(reservation.request!, {
        id: reservation.threadId, historyRefId: reference.id
      })
      if (thread.historyRefId !== reference.id) throw new HistoryReferenceError(
        'history_branch_conflict', 'The reserved branch no longer matches its history source.', 409)
      if (!reservation.completed) await this.store.saveReservation(input.idempotencyKey, {
        ...reservation, completed: true
      })
      return { thread, reference }
    })
  }

  /** Deletion is independent from the Labs switch and never touches source files. */
  async cleanupDeletedThread(threadId: string, referenceId?: string): Promise<void> {
    if (!referenceId) return
    await this.store.withMutation(async () => {
      const reservations = await this.store.reservations()
      for (const { key, value } of reservations) {
        if (value.referenceId !== referenceId || value.deleted) continue
        if (value.threadId === threadId) await this.store.tombstoneReservation(key, value)
      }
      // Only an explicit successful deletion retires a reservation. Missing thread metadata
      // can still be recovered from this host binding, including pre-snapshot empty branches.
      if (reservations.some(({ value }) => value.referenceId === referenceId &&
        value.threadId !== threadId && !value.deleted)) return
      const lookup = this.options.threadStore?.hasHistoryReference
      if (!lookup || await lookup.call(this.options.threadStore, referenceId)) return
      await this.store.remove(referenceId)
      invalidateCodexIndexCache(referenceId)
    })
  }

  async page(id: string, options: Parameters<typeof readHistoryPage>[1]) {
    this.assertEnabled()
    const page = await readHistoryPage(await this.requireReference(id), options)
    await this.requireReference(id)
    return page
  }

  async status(id: string) {
    this.assertEnabled()
    const page = await this.page(id, { threadId: `source:${id}`, limit: 1 })
    return { status: page.status, warnings: page.warnings }
  }

  async readForThread(threadId: string, input: Parameters<typeof readSourceHistory>[1] & {
    referenceId?: string
  }) {
    this.assertEnabled()
    const thread = await this.options.threadService.getMetadata(threadId)
    if (!thread?.historyRefId || (input.referenceId && input.referenceId !== thread.historyRefId)) {
      throw new HistoryReferenceError('history_reference_forbidden',
        'This history reference is not attached to the current thread.', 403)
    }
    const result = await readSourceHistory(await this.requireReference(thread.historyRefId), input)
    await this.requireReference(thread.historyRefId)
    return result
  }

  async attachment(id: string, itemId: string, index: number) {
    this.assertEnabled()
    const attachment = await readHistoryAttachment(await this.requireReference(id), itemId, index)
    await this.requireReference(id)
    return attachment
  }

  async relink(id: string, path: string): Promise<HistoryReference> {
    this.assertEnabled()
    return this.store.withMutation(async () => {
      const current = await this.requireReference(id)
      const linked = await relinkHistoryReference(current, sourcePath(path, current.provider))
      this.assertEnabled(current.provider)
      const saved = await this.store.put({ ...linked, id: current.id })
      invalidateCodexIndexCache(current.id)
      return saved
    })
  }

  private async requireReference(id: string): Promise<HistoryReference> {
    const reference = await this.store.get(id)
    if (!reference) throw new HistoryReferenceError('history_reference_not_found',
      'The history reference was not found.', 404)
    this.assertEnabled(reference.provider)
    return reference
  }

  private async resolveBranchReference(input: CreateReferenceBranchInput): Promise<HistoryReference> {
    if (input.path && input.sourceProvider === 'opencode') return createOpenCodeReference(sourcePath(input.path, 'opencode'), input.sessionId, input.sourceKind, input.cutoffTurnId)
    if (input.path) return createHistoryReference(sourcePath(input.path), input.cutoffTurnId, input.sourceProvider ?? 'codex')
    const reference = await this.requireReference(input.referenceId!)
    if (input.sourceProvider && input.sourceProvider !== reference.provider) throw new HistoryReferenceError('history_source_mismatch', 'The source provider does not match the reference.')
    if (!input.cutoffTurnId || input.cutoffTurnId === reference.cutoffTurnId) {
      // Old descriptors stored only session_meta.cwd; derive the default from
      // the fixed cutoff again without changing any existing thread workspace.
      try { return await createHistorySubreference(reference, reference.cutoffTurnId) }
      catch (error) {
        throw new HistoryReferenceError('history_source_unavailable',
          error instanceof Error ? error.message : 'Relink the original history before creating a new branch.', 409)
      }
    }
    // Derive from the frozen prefix even when Codex later appends rollback/parent records.
    try {
      return await createHistorySubreference(reference, input.cutoffTurnId)
    } catch (error) {
      if (!(error instanceof HistorySourceError)) throw error
      throw new HistoryReferenceError(error.status === 'partial' ? 'history_cutoff_invalid' : 'history_source_unavailable',
        error.message, error.status === 'partial' ? 400 : 409)
    }
  }
}

function sourcePath(path: string, provider: HistorySourceProvider = 'codex'): string {
  if (!isAbsolute(path) || (provider !== 'opencode' && !/\.jsonl(?:\.zst)?$/iu.test(path))) {
    throw new HistoryReferenceError('history_path_invalid', 'Select an absolute source .jsonl or .jsonl.zst path.')
  }
  return resolve(path)
}
