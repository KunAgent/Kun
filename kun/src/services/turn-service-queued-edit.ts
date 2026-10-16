import { validateAttachmentAliases, type AttachmentAliases } from '../contracts/attachment-aliases.js'
import { createHash } from 'node:crypto'
import type { TurnService } from './turn-service-core.js'
import { queueRevision, requirePolicyRevision, PolicyMutationRejected } from '../domain/remote-policy-revision.js'
import type { ThreadRecord } from '../contracts/threads.js'
export interface QueuedEditInput {
  threadId: string; turnId: string; expectedRevision: string; operationId: string
  text: string; attachmentIds: string[]; attachmentAliases?: AttachmentAliases
}
/** Complete a staged edit under the same Manager/store lock as queue promotion. */
async function finishEdit(service: TurnService, thread: ThreadRecord, turnId: string): Promise<void> {
  const turn = thread.turns.find((row) => row.id === turnId), pending = turn?.queueEdit?.pending
  if (!turn || turn.status !== 'queued' || !pending) return
  if (pending.attachmentIds.length) {
    const store = service['deps'].attachmentStore?.()
    if (!store) throw new Error('attachment_store_unavailable')
    await store.bindScopes(pending.attachmentIds, { threadId: thread.id, workspace: thread.workspace })
  }
  const item = await service['deps'].sessionStore.updateItem(thread.id, `item_${turn.id}_user`, {
    text: pending.text, attachmentIds: pending.attachmentIds, attachmentAliases: pending.attachmentAliases, displayText: undefined
  })
  if (!item) throw new Error('queued_user_item_unavailable')
  // Keep the durable marker on failure; promotion repairs this exact authorized edit.
  const next = { ...thread, turns: thread.turns.map((row) => row.id === turn.id ? {
    ...row, prompt: pending.text, attachmentIds: pending.attachmentIds, attachmentAliases: pending.attachmentAliases,
    items: row.items.map((old) => old.id === item.id ? item : old),
    queueEdit: { revision: (row.queueEdit?.revision ?? 0) + 1,
      lastOperationId: pending.operationId, lastFingerprint: pending.fingerprint }
  } : row), updatedAt: service['deps'].nowIso() }
  if (!(await service['commitThreadRecordCAS'](next, thread.revision ?? 0)).applied)
    throw new Error('queued_edit_commit_uncertain')
  await service['deps'].events.record({ kind: 'item_updated', threadId: thread.id,
    turnId: turn.id, itemId: item.id, item })
}
export const turnServiceQueuedEditOperations = {
  async editQueuedTurn(this: TurnService, input: QueuedEditInput): Promise<{ threadId: string; turnId: string }> {
    return this['withQueueDataMutation'](input.threadId, async () => {
      const thread = await this['deps'].threadStore.get(input.threadId)
      if (!thread) throw new PolicyMutationRejected('NOT_FOUND')
      const turn = thread.turns.find((row) => row.id === input.turnId)
      if (!turn) throw new PolicyMutationRejected('NOT_FOUND')
      const fingerprint = createHash('sha256').update(JSON.stringify([input.text, input.attachmentIds])).digest('hex')
      if (turn.queueEdit?.lastOperationId === input.operationId) {
        if (turn.queueEdit.lastFingerprint !== fingerprint) throw new PolicyMutationRejected('INVALID_REQUEST')
        return { threadId: thread.id, turnId: turn.id }
      }
      if (turn.queueEdit?.pending?.operationId === input.operationId) {
        if (turn.queueEdit.pending.fingerprint !== fingerprint) throw new Error('queued_edit_operation_conflict')
        await finishEdit(this, thread, turn.id)
        return { threadId: thread.id, turnId: turn.id }
      }
      requirePolicyRevision(queueRevision(thread), input.expectedRevision)
      if (turn.status !== 'queued' || turn.admissionPending || turn.queueEdit?.pending)
        throw new PolicyMutationRejected('TASK_BUSY')
      if (turn.clientSurface !== 'api') throw new PolicyMutationRejected('INVALID_REQUEST')
      if (input.attachmentIds.length) {
        const store = this['deps'].attachmentStore?.()
        if (!store) throw new PolicyMutationRejected('INVALID_REQUEST')
        for (const id of input.attachmentIds) if (!await store.get(id)) throw new PolicyMutationRejected('INVALID_REQUEST')
      }
      const inherited = input.attachmentAliases ?? (turn.attachmentAliases !== undefined ? input.attachmentIds.map((id) =>
        turn.attachmentAliases!.find((alias) => alias.attachmentId === id) ?? { attachmentId: id, displayName: 'attachment.bin' }) : undefined)
      const attachmentAliases = validateAttachmentAliases(inherited, input.attachmentIds)
      const next = { ...thread, turns: thread.turns.map((row) => row.id === turn.id ? {
        ...row, queueEdit: { revision: row.queueEdit?.revision ?? 0, pending: {
          operationId: input.operationId, fingerprint, text: input.text, attachmentIds: input.attachmentIds, attachmentAliases } }
      } : row) }
      if (!(await this['commitThreadRecordCAS'](next, thread.revision ?? 0)).applied)
        throw new PolicyMutationRejected('REVISION_CONFLICT')
      const staged = await this['deps'].threadStore.get(thread.id)
      if (!staged) throw new Error('queued_edit_commit_uncertain')
      await finishEdit(this, staged, turn.id)
      return { threadId: thread.id, turnId: turn.id }
    })
  },
  async reconcileQueuedEdits(this: TurnService, threadId: string): Promise<void> {
    await this['withQueueDataMutation'](threadId, async () => {
      let thread = await this['deps'].threadStore.get(threadId)
      for (const row of thread?.turns ?? []) if (row.status === 'queued' && row.queueEdit?.pending) {
        await finishEdit(this, thread!, row.id)
        thread = await this['deps'].threadStore.get(threadId)
        if (!thread) return
      }
    })
  }
}
