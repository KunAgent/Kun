import { createHash } from 'node:crypto'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { RemoteScope } from '../contracts.js'
import type { Receipt } from '../requests/receipts.js'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { RoomMessage } from '../../contracts/rooms.js'
import { currentAgentConversation } from '../../agents/agent-conversations.js'
import { isPublicTurnItem } from '../../contracts/items.js'
import { requireCode } from '../code/access.js'
import { receiptKey } from '../requests/receipts.js'
import { RemoteNoEffect } from '../requests/rejections.js'
export type AttachmentAdmission = { attachmentId: string; sourceDeviceId: string; receiptId?: string; confirmedAt: number }
/** Account-wide confirmation is local to this desktop, never a cloud attachment ownership claim. */
export function attachmentAdmissionKey(scope: Pick<RemoteScope, 'accountId'>, attachmentId: string) {
  return 'remote-attachment-' + createHash('sha256').update(scope.accountId + ':' + attachmentId).digest('hex')
}
export function receivedAttachmentId(result: unknown): string | undefined {
  const value = result as { attachment?: { id?: unknown } } | undefined
  return typeof value?.attachment?.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value.attachment.id)
    ? value.attachment.id : undefined
}
export const ATTACHMENT_INPUT_METHODS = new Set([
  'agent.message.send', 'code.turn.start', 'execution.queue.enqueue', 'execution.queue.update', 'execution.steer'
])
export class RemoteAttachmentAdmissions {
  constructor(private runtime: ServerRuntime) {}
  private get rooms(): RoomRuntime { return this.runtime.rooms! }
  private async oldReceipt(scope: RemoteScope, ids: Set<string>) {
    const proofs = new Map<string, AttachmentAdmission>()
    let beforeSeq: number | undefined
    // Old receipts lack an owner column. Recomputing the scoped key proves ownership;
    // a matching attachment result alone never authorizes another account/device.
    while (ids.size) {
      const rows = await this.rooms.deps.store.list<Receipt>('remote_receipt', { limit: 200, beforeSeq })
      for (const row of rows) {
        const receipt = row.value
        if (receipt.method !== 'attachment.receive' || receipt.status !== 'applied' ||
          receiptKey(scope, receipt.requestId) !== row.id) continue
        const attachmentId = receivedAttachmentId(receipt.result)
        if (attachmentId && ids.delete(attachmentId)) proofs.set(attachmentId, {
          attachmentId, sourceDeviceId: scope.deviceId, receiptId: receipt.requestId, confirmedAt: receipt.createdAt })
      }
      if (rows.length < 200) break
      const next = Math.min(...rows.map((row) => row.seq))
      if (beforeSeq !== undefined && next >= beforeSeq) throw new Error('ATTACHMENT_PROOF_UNAVAILABLE')
      beforeSeq = next
    }
    return proofs
  }
  private async referenced(p: { threadId?: string; agentId?: string }, id: string) {
    if (p.agentId) {
      const room = await currentAgentConversation(this.rooms.agents, p.agentId)
      if (!room || room.value.conversationKind !== 'user_agent') return false
      let beforeSeq: number | undefined
      for (;;) {
        const page = await this.rooms.deps.store.list<RoomMessage>('message', { roomId: room.id, beforeSeq, limit: 200 })
        if (page.some((row) => row.value.attachmentIds?.includes(id))) return true
        if (page.length < 200) return false
        const next = Math.min(...page.map((row) => row.seq))
        if (beforeSeq !== undefined && next >= beforeSeq) throw new Error('ATTACHMENT_PROOF_UNAVAILABLE')
        beforeSeq = next
      }
    }
    if (!p.threadId || !this.runtime.sessionStore.loadItemPage) return false
    await requireCode(this.runtime, p.threadId)
    let before: string | undefined
    const seen = new Set<string>()
    for (;;) {
      const page = await this.runtime.sessionStore.loadItemPage(p.threadId, { before, maxItems: 200, maxBytes: 512 * 1024 })
      if (page.items.some((item) => isPublicTurnItem(item) && 'attachmentIds' in item && item.attachmentIds?.includes(id))) return true
      if (!page.hasMore) return false
      if (!page.nextCursor || seen.has(page.nextCursor)) throw new Error('ATTACHMENT_PROOF_UNAVAILABLE')
      before = page.nextCursor; seen.add(before)
    }
  }
  async assert(scope: RemoteScope, method: string, p: { attachmentIds?: string[]; threadId?: string; agentId?: string }) {
    if (!ATTACHMENT_INPUT_METHODS.has(method) || !p.attachmentIds?.length) return
    const ids = [...new Set(p.attachmentIds)], missing = new Set<string>()
    for (const id of ids) {
      if (!await this.runtime.attachmentStore?.get(id)) throw new RemoteNoEffect('ATTACHMENT_NOT_CONFIRMED')
      const proof = await this.rooms.deps.store.get<AttachmentAdmission>('remote_attachment_admission', attachmentAdmissionKey(scope, id))
      if (!proof || proof.value.attachmentId !== id) missing.add(id)
    }
    if (!missing.size) return
    const recovered = await this.oldReceipt(scope, missing)
    for (const id of missing) {
      if (!await this.referenced(p, id)) throw new RemoteNoEffect('ATTACHMENT_NOT_CONFIRMED')
      recovered.set(id, { attachmentId: id, sourceDeviceId: scope.deviceId, confirmedAt: Date.now() })
    }
    // No migration writes occur until every proposed attachment has a proof.
    await this.rooms.exclusive(async () => {
      const checks = [], puts = []
      for (const [id, value] of recovered) {
        const key = attachmentAdmissionKey(scope, id)
        if (await this.rooms.deps.store.get('remote_attachment_admission', key)) continue
        checks.push({ kind: 'remote_attachment_admission' as const, id: key, expectedRevision: null })
        puts.push({ kind: 'remote_attachment_admission' as const, id: key, value })
      }
      if (puts.length) await this.rooms.deps.store.commit({ requestId: 'remote-proof-' + createHash('sha256')
        .update(JSON.stringify(puts.map((p) => p.id).sort())).digest('hex'), checks, puts })
    })
  }
}
