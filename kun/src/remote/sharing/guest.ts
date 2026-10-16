import { StartTurnRequest } from '../../contracts/turns.js'
import { SharedTaskFiles } from './files.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { LocalCall } from '../runtime/local-call.js'
import { ParamSchemas, type Method } from '../contracts.js'
import { SharedTaskJournal } from './journal.js'
import { SharedTaskReceipts } from './receipts.js'
import { ShareGuestCallSchema, type ShareActor, type ShareGuestCall } from './contracts.js'
import { ownsSharedTurn, projectSharedHistory, sharedTurnKey, SHARED_ITEM_KINDS, visibleSharedTurn } from './projection.js'
import { RemoteMessages } from '../messages/service.js'
import { RemoteExecutionQueue } from '../execution/queue.js'
import { RemoteGoals } from '../goals/service.js'
import { versionedHistory } from '../messages/history-version.js'
import { RemoteNoEffect } from '../requests/rejections.js'
import { PolicyMutationRejected } from '../../domain/remote-policy-revision.js'
import { TurnConflictError } from '../../services/turn-service.js'
import { RemoteSourceContent } from '../messages/source/content.js'
const READ = new Set(['catalog.get', 'code.history', 'message.search', 'message.get', 'message.source.get', 'execution.queue.list', 'goal.get', 'request.get', 'artifact.list', 'attachment.export'])
const WRITE = ['code.turn.start', 'execution.queue.enqueue', 'execution.queue.update', 'execution.queue.remove', 'execution.stop', 'attachment.receive']
/** Independent guest boundary. It never accepts a personal Remote Envelope or advertises desktop/global authorities. */
export class SharedTaskFacade {
  readonly journal: SharedTaskJournal
  readonly files: SharedTaskFiles
  private receipts: SharedTaskReceipts
  private messages: RemoteMessages
  private execution: RemoteExecutionQueue
  private goals: RemoteGoals
  private source: RemoteSourceContent
  constructor(private runtime: ServerRuntime, private call: LocalCall) {
    this.journal = new SharedTaskJournal(runtime); this.receipts = new SharedTaskReceipts(runtime)
    this.files = new SharedTaskFiles(runtime, this.journal, this.receipts)
    this.messages = new RemoteMessages(runtime); this.execution = new RemoteExecutionQueue(runtime, call)
    this.goals = new RemoteGoals(runtime)
    this.source = new RemoteSourceContent(runtime)
  }
  async execute(rawActor: unknown, rawCall: unknown): Promise<unknown> {
    const { actor, resource } = await this.journal.authorize(rawActor), call = ShareGuestCallSchema.parse(rawCall)
    if (call.method.startsWith('attachment.')) throw new Error('FILE_TRANSFER_REQUIRED')
    const params = ParamSchemas[call.method as Method].parse(call.params) as any
    if (params.threadId !== undefined && params.threadId !== resource.threadId ||
        params.resource && (params.resource.kind !== 'code' || params.resource.id !== resource.threadId) ||
        params.agentId) throw new Error('SHARE_RESOURCE_NOT_ALLOWED')
    if (!READ.has(call.method) && actor.mode !== 'write') throw new Error('SHARE_READ_ONLY')
    if (call.method === 'request.get') return this.lookup(actor, params.requestId)
    if (READ.has(call.method)) return this.read(actor, call.method, params)
    return { receipt: await this.receipts.execute(actor, call, () => this.mutate(actor, call, params)) }
  }
  private async read(actor: ShareActor, method: string, p: any): Promise<unknown> {
    const { resource, thread } = await this.journal.authorize(actor)
    switch (method) {
      case 'catalog.get': return { threadId: thread.id, title: thread.title, status: thread.status,
        capabilities: [...READ].filter((method) => method !== 'message.source.get' || this.source.available).concat(actor.mode === 'write' ? WRITE : []),
        historyVersion: await this.runtime.sessionStore.itemHistoryVersion?.(thread.id),
        pendingOwnerAttention: { approvals: this.runtime.approvalGate.pending().filter((a) => a.threadId === thread.id).length,
          inputs: this.runtime.userInputGate.pending().filter((a) => a.threadId === thread.id).length } }
      case 'code.history': {
        const { history, historyVersion } = await versionedHistory(this.runtime.sessionStore, thread.id, () => this.call(
          '/v1/threads/' + thread.id + '/timeline?limit=12' + (p.cursor ? '&before=' + encodeURIComponent(p.cursor) : '')))
        return projectSharedHistory(history, actor, thread.turns, historyVersion, thread.historyRefId)
      }
      case 'execution.queue.list': {
        const queue = await this.execution.queue({ ...p, threadId: resource.threadId })
        return { ...queue, items: queue.items.filter((item) => {
          const turn = thread.turns.find((t) => t.id === item.turnId); return turn && ownsSharedTurn(actor, turn)
        }).map((item) => ({ ...item, editable: actor.mode === 'write' && item.editable })), totalQueuedCount: thread.turns.filter((t) => t.status === 'queued').length,
          canSteer: false, activeTurnId: thread.turns.find((t) => t.status === 'running' && ownsSharedTurn(actor, t))?.id,
          steerReason: 'SHARED_TASK' }
      }
      case 'artifact.list': return this.files.list(actor, p)
      case 'goal.get': return this.goals.goal(thread.id)
      case 'message.search': {
        const result = await this.messages.search(p, {
          scope: [actor.ownerAccountId, actor.hostDeviceId, actor.shareId, actor.memberId, actor.guestAccountId, actor.memberVersion],
          authorize: async () => {
            const current = await this.journal.authorize(actor)
            if (current.thread.id !== p.resource.id || current.thread.historyRefId !== thread.historyRefId) throw new Error('HISTORY_CHANGED')
          }
        })
        return { ...result, messages: result.messages.filter((message) => SHARED_ITEM_KINDS.has(message.kind) &&
          (message.sourceHistoryOrder ? Boolean(thread.historyRefId && message.sourceHistoryOrder.referenceId === thread.historyRefId)
            : thread.turns.some((turn) => turn.id === message.turnId && visibleSharedTurn(actor, turn)))) }
      }
      case 'message.get': {
        const turn = thread.turns.find((t) => t.id === p.turnId)
        if (!turn || !visibleSharedTurn(actor, turn)) throw new Error('NOT_FOUND')
        const page = await this.runtime.sessionStore.loadItemPage?.(thread.id, { turnId: p.turnId, itemId: p.messageId, maxItems: 1, maxBytes: 8192 })
        if (!page?.content || !['text', 'arguments', 'output'].includes(page.content.field)) throw new Error('NOT_FOUND')
        return this.messages.get(p)
      }
      case 'message.source.get': return this.source.get(p, {
        scope: [actor.ownerAccountId, actor.hostDeviceId, actor.shareId, actor.memberId, actor.guestAccountId, actor.memberVersion],
        authorize: async () => {
          const current = await this.journal.authorize(actor)
          if (current.thread.id !== p.resource.id || current.thread.historyRefId !== p.referenceId) throw new Error('HISTORY_CHANGED')
        }
      })
      default: throw new Error('UNSUPPORTED_OPERATION')
    }
  }
  private async mutate(actor: ShareActor, call: ShareGuestCall, p: any): Promise<unknown> {
    const { thread } = await this.journal.authorize(actor), turns = this.runtime.turnService, key = sharedTurnKey(actor, call.requestId)
    if (actor.mode !== 'write') throw new RemoteNoEffect('INVALID_REQUEST')
    try {
      await this.files.assertInputs(actor, thread.id, p.attachmentIds ?? [])
      if (call.method === 'code.turn.start' || call.method === 'execution.queue.enqueue') {
        if (!p.text.trim()) throw new RemoteNoEffect('INVALID_REQUEST')
        const attachmentAliases = await this.files.inputAliases(actor, thread.id, p.attachmentIds ?? [])
        const result = await turns.startTurn({ threadId: thread.id, request: StartTurnRequest.parse({ prompt: p.text,
          attachmentIds: p.attachmentIds, clientSurface: 'api', clientRequestId: key, enqueueIfBusy: true }) },
          { attachmentAliases, onAdmitted: (admitted) => { this.runtime.runTurn(admitted.threadId, admitted.turnId) } })
        return { threadId: thread.id, turnId: result.turnId, status: result.status ?? 'running' }
      }
      const turn = thread.turns.find((candidate) => candidate.id === p.turnId)
      if (!turn || !ownsSharedTurn(actor, turn) || turn.clientSurface !== 'api') throw new RemoteNoEffect('INVALID_REQUEST')
      if (call.method === 'execution.stop') {
        if (turn.status !== 'running') return { threadId: thread.id, turnId: turn.id, status: turn.status }
        if (!turns.isTurnExecutionActive(turn.id)) throw new RemoteNoEffect('TASK_BUSY')
        try { return { threadId: thread.id, turnId: turn.id, ...await turns.interruptTurn({ threadId: thread.id, turnId: turn.id, preserveQueue: true }) } }
        catch (error) {
          if (!(error instanceof TurnConflictError)) throw error
          const original = await turns.getTurn(thread.id, turn.id)
          if (!original || ['running', 'queued'].includes(original.status)) throw error
          return { threadId: thread.id, turnId: turn.id, status: original.status }
        }
      }
      if (turn.status !== 'queued' || turn.admissionPending || turn.queueEdit?.pending) throw new RemoteNoEffect('TASK_BUSY')
      if (call.method === 'execution.queue.update') await turns.editQueuedTurn({ ...p, threadId: thread.id, attachmentIds: p.attachmentIds,
        attachmentAliases: await this.files.inputAliases(actor, thread.id, p.attachmentIds ?? []), operationId: key })
      else if (call.method === 'execution.queue.remove') await turns.cancelQueuedTurn({ threadId: thread.id, turnId: turn.id, expectedQueueRevision: p.expectedRevision })
      else throw new RemoteNoEffect('INVALID_REQUEST')
      return this.read(actor, 'execution.queue.list', { threadId: thread.id })
    } catch (error) { if (error instanceof PolicyMutationRejected) throw new RemoteNoEffect(error.code); throw error }
  }
  private async lookup(actor: ShareActor, id: string) {
    const receipt = await this.receipts.get(actor, id)
    if (!receipt || receipt.status !== 'reconciliation_required') return { receipt }
    const { thread } = await this.journal.authorize(actor), key = sharedTurnKey(actor, id)
    if (['code.turn.start', 'execution.queue.enqueue'].includes(receipt.method)) {
      const turn = thread.turns.find((t) => t.clientRequestId === key && !t.admissionPending)
      if (turn) return { receipt: await this.receipts.recovered(actor, id, { threadId: thread.id, turnId: turn.id, status: turn.status }) }
    }
    if (receipt.method === 'execution.queue.update' && typeof receipt.params.turnId === 'string') {
      const turn = thread.turns.find((t) => t.id === receipt.params.turnId)
      if (turn?.queueEdit?.lastOperationId === key) return { receipt: await this.receipts.recovered(actor, id,
        await this.read(actor, 'execution.queue.list', { threadId: thread.id })) }
    }
    return { receipt }
  }
}
