import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { queueRevision, PolicyMutationRejected, requirePolicyRevision } from '../../domain/remote-policy-revision.js'
import { RemoteNoEffect } from '../requests/rejections.js'
import { type LocalCall } from '../runtime/local-call.js'
import { requireCode } from '../code/access.js'
import { receiptKey, type Receipt } from '../requests/receipts.js'
import type { Envelope, RemoteScope } from '../contracts.js'
import { cursorScope, readCursor, writeCursor } from '../cursor-codec.js'
export class RemoteExecutionQueue {
  constructor(private runtime: ServerRuntime, private call: LocalCall) {}
  async preflight(method: string, p: any) {
    let thread
    try { thread = await requireCode(this.runtime, p.threadId) }
    catch (error) {
      if (error instanceof Error && ['NOT_FOUND', 'NOT_A_CODE_TASK'].includes(error.message))
        throw new RemoteNoEffect(error.message as 'NOT_FOUND' | 'NOT_A_CODE_TASK')
      throw error
    }
    if (p.expectedRevision) requirePolicyRevision(queueRevision(thread), p.expectedRevision)
    if (['execution.queue.update', 'execution.queue.remove', 'execution.steer'].includes(method)) {
      const turn = thread.turns.find((t) => t.id === p.turnId)
      if (!turn) throw new RemoteNoEffect('NOT_FOUND')
      if (method === 'execution.steer') {
        if (turn.clientSurface !== 'api') throw new RemoteNoEffect('INVALID_REQUEST')
        if (turn.status !== 'running' || !this.runtime.turnService.isTurnExecutionActive(turn.id)) throw new RemoteNoEffect('TASK_BUSY')
      } else {
        if (turn.status !== 'queued' || turn.admissionPending || turn.queueEdit?.pending) throw new RemoteNoEffect('TASK_BUSY')
        if (method === 'execution.queue.update' && turn.clientSurface !== 'api') throw new RemoteNoEffect('INVALID_REQUEST')
      }
    }
  }
  async queue(p: { threadId: string; cursor?: string; limit?: number }) {
    const thread = await requireCode(this.runtime, p.threadId), revision = queueRevision(thread)
    const scope = cursorScope([thread.id, revision]), offset = readCursor(p.cursor, scope, { offset: 0 }).offset
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('INVALID_CURSOR')
    const queued = thread.turns.filter((t) => t.status === 'queued'), limit = p.limit ?? 20
    const historyVersion = await this.runtime.sessionStore.itemHistoryVersion?.(thread.id) ?? '0'
    const items = []
    for (const turn of queued.slice(offset, offset + limit)) {
      const messageId = `item_${turn.id}_user`
      const page = await this.runtime.sessionStore.loadItemPage?.(thread.id, { turnId: turn.id,
        itemId: messageId, contentOffset: 0, maxItems: 1, maxBytes: 12000 })
      const item = page?.items.find((i) => i.id === messageId && i.kind === 'user_message')
      const text = page?.content?.text ?? (item && 'text' in item ? item.text : '')
      const pending = Boolean(turn.admissionPending || turn.queueEdit?.pending)
      items.push({ turnId: turn.id, position: queued.indexOf(turn) + 1, text,
        attachmentIds: turn.attachmentIds, createdAt: turn.createdAt, clientSurface: turn.clientSurface,
        editable: turn.clientSurface === 'api' && !pending, pending, messageId, historyVersion,
        textTruncated: Boolean(page?.content?.nextOffset),
        reason: turn.clientSurface !== 'api' ? 'DESKTOP_SURFACE' : pending ? 'PENDING' : undefined })
    }
    const active = thread.turns.find((t) => t.status === 'running')
    const canSteer = Boolean(active?.clientSurface === 'api' && this.runtime.turnService.isTurnExecutionActive(active.id))
    const hasMore = offset + items.length < queued.length
    return { threadId: thread.id, revision, paused: Boolean(thread.queueControl), pauseReason: thread.queueControl?.reason,
      items, hasMore, nextCursor: hasMore ? writeCursor(scope, { offset: offset + items.length }) : undefined,
      canSteer, activeTurnId: active?.id, steerReason: active && !canSteer ?
        active.clientSurface !== 'api' ? 'DESKTOP_SURFACE' : 'INACTIVE' : undefined }
  }
  async dispatch(method: string, p: any, envelope: Envelope): Promise<unknown> {
    const key = receiptKey(envelope, envelope.call.requestId), turns = this.runtime.turnService
    try {
      await this.preflight(method, p)
      switch (method) {
        case 'execution.queue.list': return this.queue(p)
        case 'execution.queue.enqueue':
          return this.call('/v1/threads/' + p.threadId + '/turns', 'POST', { prompt: p.text,
            attachmentIds: p.attachmentIds, clientRequestId: key, clientSurface: 'api', enqueueIfBusy: true })
        case 'execution.queue.update':
          await turns.editQueuedTurn({ ...p, operationId: key }); return this.queue(p)
        case 'execution.queue.remove':
          await turns.cancelQueuedTurn({ threadId: p.threadId, turnId: p.turnId, expectedQueueRevision: p.expectedRevision })
          return this.queue(p)
        case 'execution.resume': {
          await turns.resumeQueuedTurns(p.threadId, { expectedRevision: p.expectedRevision })
          const started = await turns.startNextQueuedTurn(p.threadId)
          turns.notifyTurnQueued(p.threadId)
          if (started) this.runtime.runTurn(p.threadId, started.turnId)
          return { threadId: p.threadId, started: Boolean(started), turnId: started?.turnId, queue: await this.queue(p) }
        }
        case 'execution.steer':
          await turns.steerTurn({ ...p, operationId: key, requiredClientSurface: 'api' })
          this.runtime.runTurn(p.threadId, p.turnId)
          return { ok: true, threadId: p.threadId, turnId: p.turnId }
        default: throw new RemoteNoEffect('INVALID_REQUEST')
      }
    } catch (error) {
      if (error instanceof PolicyMutationRejected) throw new RemoteNoEffect(error.code)
      throw error
    }
  }
  async recover(scope: RemoteScope, receipt: Receipt): Promise<unknown | undefined> {
    const p = receipt.params
    if (!p || typeof p.threadId !== 'string') return undefined
    const thread = await requireCode(this.runtime, p.threadId).catch(() => null)
    if (!thread) return undefined
    const key = receiptKey(scope, receipt.requestId)
    if (receipt.method === 'execution.queue.enqueue') {
      const turn = thread.turns.find((t) => t.clientRequestId === key && !t.admissionPending)
      if (turn) return { threadId: thread.id, turnId: turn.id, status: turn.status }
    }
    if (receipt.method === 'execution.queue.update' && typeof p.turnId === 'string') {
      const turn = thread.turns.find((t) => t.id === p.turnId)
      if (turn?.queueEdit?.lastOperationId === key) return this.queue({ threadId: thread.id })
    }
    if (receipt.method === 'execution.steer' && typeof p.turnId === 'string') {
      const turn = thread.turns.find((t) => t.id === p.turnId)
      if (turn?.steeringDeliveries?.some((d) => d.operationId === key)) return { ok: true, threadId: thread.id, turnId: turn.id }
    }
    return undefined
  }
}
