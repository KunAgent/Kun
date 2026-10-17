import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { canonical } from '@kun/remote-protocol'
import { historyRecovery, type HistoryRecovery } from './recovery.js'
import type { ServerRuntime } from '../../../server/routes/server-runtime.js'
import type { Envelope, RemoteScope } from '../../contracts.js'
import type { RemoteRewind } from '../../../contracts/remote-history.js'
import { RewindDraftSchema, RemoteRewindSchema } from '../../../contracts/remote-history.js'
import { RewindCommitParams, RewindPreviewParams } from './contracts.js'
import { isRemoteCodeAllowed } from '../access.js'
import { RemoteCodeManagement, metadataRevision } from '../management.js'
import { receiptKey, type Receipt } from '../../requests/receipts.js'
import { RemoteNoEffect } from '../../requests/rejections.js'
import { PolicyMutationRejected } from '../../../domain/remote-policy-revision.js'
import { finishRemoteRewind, rewindItemsHash, remoteHistoryBusy } from '../../../services/remote-history-rewind.js'
import { RemoteAttachmentAdmissions } from '../../files/admissions.js'
type PreviewResult = { token: string; expiresAt: number; summary: { removedTurns: number; remainingTurns: number;
  filesReverted: false; externalEffectsReverted: false; sourceHistoryRetained: boolean }; draft: RemoteRewind['draft']; canCommit: boolean;
  reason?: 'DRAFT_LIMIT' | 'ATTACHMENT_UNAVAILABLE' }
type Preview = { kind: 'rewind_preview'; accountId: string; deviceId: string; authorizationId: string; threadId: string; result: PreviewResult;
  plan: Omit<RemoteRewind, 'operationKey'>; usedBy?: string }
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
const CommitSchema = z.object({ kind: z.literal('rewind_commit'), status: z.enum(['pending', 'applied']), accountId: Id,
  deviceId: Id, requestId: Id, threadId: Id, plan: RemoteRewindSchema, result: z.unknown().optional() }).strict()
type Commit = z.infer<typeof CommitSchema>
const previewId = (scope: RemoteScope, id: string) => 'rewind-preview:' + receiptKey(scope, id)
const tokenId = (token: string) => 'rewind-token:' + createHash('sha256').update(token).digest('hex')
const commitId = (scope: RemoteScope, id: string) => 'rewind-commit:' + receiptKey(scope, id)
export class RemoteHistoryRewind {
  private admissions: RemoteAttachmentAdmissions
  private code: RemoteCodeManagement
  private previewActive = false
  private recovery: HistoryRecovery
  constructor(private runtime: ServerRuntime) {
    this.admissions = new RemoteAttachmentAdmissions(runtime); this.code = new RemoteCodeManagement(runtime, async () => [])
    this.recovery = historyRecovery(runtime, key => this.finish(key, true))
  }
  async source(raw: unknown) {
    const p = RewindPreviewParams.parse(raw), thread = await this.runtime.threadService.getMetadata(p.threadId)
    if (!thread) throw new RemoteNoEffect('NOT_FOUND')
    if (!await isRemoteCodeAllowed(this.runtime, thread)) throw new RemoteNoEffect('NOT_A_CODE_TASK')
    if (metadataRevision(thread) !== p.expectedRevision || (await this.runtime.sessionStore.itemHistoryVersion?.(thread.id) ?? 'legacy') !== p.historyVersion)
      throw new RemoteNoEffect('REVISION_CONFLICT')
    if (thread.remoteRewind?.phase === 'pending' || await remoteHistoryBusy(this.runtime.turnService, thread) ||
      this.runtime.approvalGate.pending(thread.id).length || this.runtime.userInputGate.pending(thread.id).length) throw new RemoteNoEffect('TASK_BUSY')
    if (thread.designProfile || !thread.turns.some(turn => turn.id === p.turnId)) throw new RemoteNoEffect('INVALID_REQUEST')
    return { p, thread }
  }
  async preflight(method: string, raw: unknown) { if (method === 'code.rewind.preview') await this.source(raw) }
  async preview(raw: unknown, scope: Envelope) {
    if (this.previewActive) throw new RemoteNoEffect('TASK_BUSY')
    this.previewActive = true
    try { return await this.createPreview(raw, scope) } finally { this.previewActive = false }
  }
  private async createPreview(raw: unknown, scope: Envelope) {
    const { p, thread } = await this.source(raw), sessions = this.runtime.sessionStore, snapshot = await sessions.loadItemSnapshot(thread.id)
    const index = thread.turns.findIndex(turn => turn.id === p.turnId), target = thread.turns[index]
    const user = snapshot.items.find(item => item.turnId === p.turnId && item.kind === 'user_message')
    const text = user?.kind === 'user_message' ? user.displayText ?? user.text : target.prompt
    const ids = user?.kind === 'user_message' ? user.attachmentIds ?? target.attachmentIds : target.attachmentIds
    let end = Math.min(text.length, 64000)
    if (end > 0 && /[\uD800-\uDBFF]/.test(text[end - 1])) end--
    const draft = RewindDraftSchema.parse({ text: text.slice(0, end), attachmentIds: ids.slice(0, 8),
      complete: text.length <= 64000 && ids.length <= 8, totalChars: text.length, totalAttachments: ids.length })
    let canCommit = draft.complete, reason: PreviewResult['reason'] = draft.complete ? undefined : 'DRAFT_LIMIT'
    if (canCommit) for (const id of ids) {
      try {
        const store = this.runtime.attachmentStore, metadata = await store?.get(id)
        if (!store || !metadata || metadata.byteSize > 25 * 1024 * 1024) throw Error('unavailable')
        await store.resolveContent(id, { threadId: thread.id, workspace: thread.workspace })
      } catch { canCommit = false; reason = 'ATTACHMENT_UNAVAILABLE'; break }
    }
    await this.source(p)
    if ((await sessions.loadItemSnapshot(thread.id)).revision !== snapshot.revision) throw new RemoteNoEffect('REVISION_CONFLICT')
    const keepTurnIds = thread.turns.slice(0, index).map(turn => turn.id), keep = new Set(keepTurnIds)
    const result: PreviewResult = { token: randomBytes(32).toString('hex'), expiresAt: Date.now() + 300000,
      summary: { removedTurns: thread.turns.length - index, remainingTurns: index, filesReverted: false,
        externalEffectsReverted: false, sourceHistoryRetained: Boolean(thread.historyRefId) }, draft, canCommit, ...(reason ? { reason } : {}) }
    const value: Preview = { kind: 'rewind_preview', accountId: scope.accountId, deviceId: scope.deviceId, authorizationId: scope.authorizationId, threadId: thread.id, result,
      plan: { turnId: p.turnId, sourceRevision: thread.revision ?? 0, historyVersion: p.historyVersion, itemRevision: snapshot.revision,
        beforeHash: rewindItemsHash(snapshot.items), afterHash: rewindItemsHash(snapshot.items.filter(item => keep.has(item.turnId))),
        keepTurnIds, removedTurns: result.summary.removedTurns, remainingTurns: index, draft, phase: 'pending' } }
    const key = previewId(scope, scope.call.requestId), token = tokenId(result.token)
    return this.runtime.rooms!.exclusive(async () => {
      const store = this.runtime.rooms!.deps.store, old = await store.get<Preview>('remote_history', key)
      if (old) return old.value.result
      await store.commit({ requestId: key, checks: [{ kind: 'remote_history', id: key, expectedRevision: null }, { kind: 'remote_history', id: token, expectedRevision: null }],
        puts: [{ kind: 'remote_history', id: key, value }, { kind: 'remote_history', id: token, value: { previewId: key } }] })
      return result
    })
  }
  async commit(raw: unknown, scope: Envelope) {
    const p = RewindCommitParams.parse(raw), store = this.runtime.rooms!.deps.store, key = commitId(scope, scope.call.requestId)
    const reference = await store.get<{ previewId: string }>('remote_history', tokenId(p.token))
    const row = reference ? await store.get<Preview>('remote_history', reference.value.previewId) : null, value = row?.value
    if (!value || value.accountId !== scope.accountId || value.deviceId !== scope.deviceId || value.authorizationId !== scope.authorizationId || value.threadId !== p.threadId ||
      !value.result.canCommit || !value.result.draft.complete || value.result.expiresAt <= Date.now() || value.usedBy && value.usedBy !== key)
      throw new RemoteNoEffect('INVALID_REQUEST')
    const source = await this.source({ threadId: p.threadId, turnId: value.plan.turnId,
      expectedRevision: `thread-v1:${value.plan.sourceRevision}`, historyVersion: value.plan.historyVersion })
    for (const id of value.result.draft.attachmentIds) {
      try {
        const attachment = await this.runtime.attachmentStore?.resolveContent(id, { threadId: p.threadId, workspace: source.thread.workspace })
        if (!attachment || attachment.byteSize > 25 * 1024 * 1024) throw Error('unavailable')
      } catch { throw new RemoteNoEffect('ATTACHMENT_NOT_CONFIRMED') }
    }
    // Preserve proven, locally received inputs before their original user item is removed.
    await this.admissions.assert(scope, 'code.turn.start', { threadId: p.threadId, attachmentIds: value.result.draft.attachmentIds })
    const plan: RemoteRewind = { ...value.plan, operationKey: receiptKey(scope, scope.call.requestId) }
    await this.runtime.rooms!.exclusive(async () => {
      const current = await store.get<Preview>('remote_history', row!.id), old = await store.get<Commit>('remote_history', key)
      if (old) return
      if (!current || current.revision !== row!.revision || current.value.result.expiresAt <= Date.now() || current.value.usedBy) throw new RemoteNoEffect('INVALID_REQUEST')
      await store.commit({ requestId: key + '-admit', checks: [{ kind: 'remote_history', id: current.id, expectedRevision: current.revision },
        { kind: 'remote_history', id: key, expectedRevision: null }], puts: [
        { kind: 'remote_history', id: current.id, value: { ...current.value, usedBy: key } },
        { kind: 'remote_history', id: key, value: { kind: 'rewind_commit', status: 'pending', requestId: scope.call.requestId,
          accountId: scope.accountId, deviceId: scope.deviceId, threadId: p.threadId, plan } satisfies Commit }] })
    })
    return this.finish(key)
  }
  private async finish(key: string, recovery = false) {
    const store = this.runtime.rooms!.deps.store, row = await store.get<Commit>('remote_history', key)
    if (!row) return undefined
    const parsed = CommitSchema.safeParse(row.value)
    if (!parsed.success || key !== commitId({ ...parsed.data, authorizationId: '' }, parsed.data.requestId) ||
      parsed.data.plan.operationKey !== receiptKey({ ...parsed.data, authorizationId: '' }, parsed.data.requestId)) return undefined
    if (row.value.result) return row.value.result
    if (recovery) {
      const thread = await this.runtime.threadService.getMetadata(row.value.threadId), marker = thread?.remoteRewind
      if (!marker || canonical({ ...marker, phase: 'pending' }) !== canonical({ ...row.value.plan, phase: 'pending' })) return undefined
    }
    let thread
    try { thread = await finishRemoteRewind(this.runtime.turnService, row.value.threadId, row.value.plan) }
    catch (error) { if (error instanceof PolicyMutationRejected) throw new RemoteNoEffect(error.code); throw error }
    const result = { thread: await this.code.summary(thread), historyVersion: await this.runtime.sessionStore.itemHistoryVersion?.(thread.id) ?? 'legacy',
      draft: row.value.plan.draft, rewound: true as const }
    return this.runtime.rooms!.exclusive(async () => {
      const current = await store.get<Commit>('remote_history', key)
      if (!current) return undefined
      if (current.value.result) return current.value.result
      await store.commit({ requestId: key + '-applied', checks: [{ kind: 'remote_history', id: key, expectedRevision: current.revision }],
        puts: [{ kind: 'remote_history', id: key, value: { ...current.value, status: 'applied', result } }] })
      return result
    })
  }
  async reconcileThread(threadId: string) {
    const marker = (await this.runtime.threadService.getMetadata(threadId))?.remoteRewind
    if (marker?.phase === 'pending') await this.recovery.run('rewind-commit:' + marker.operationKey)
  }
  async recover(scope: RemoteScope, receipt: Receipt) {
    if (receipt.method === 'code.rewind.preview') return (await this.runtime.rooms!.deps.store.get<Preview>('remote_history', previewId(scope, receipt.requestId)))?.value.result
    if (receipt.method !== 'code.rewind.commit') return undefined
    const key = commitId(scope, receipt.requestId), row = await this.runtime.rooms!.deps.store.get<Commit>('remote_history', key)
    if (!row || row.value.accountId !== scope.accountId || row.value.deviceId !== scope.deviceId) return undefined
    return this.recovery.run(key)
  }
}
