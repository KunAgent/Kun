import { RemoteHistoryRewind } from './rewind-commit.js'
import { createHash } from 'node:crypto'
import { canonical } from '@kun/remote-protocol'
import type { ServerRuntime } from '../../../server/routes/server-runtime.js'
import type { Envelope, RemoteScope } from '../../contracts.js'
import { receiptKey, type Receipt } from '../../requests/receipts.js'
import { CodeForkParams, CodeHistoryParamSchemas } from './contracts.js'
import { isRemoteCodeAllowed } from '../access.js'
import { RemoteCodeManagement, metadataRevision } from '../management.js'
import { RemoteNoEffect } from '../../requests/rejections.js'
import { PolicyMutationRejected } from '../../../domain/remote-policy-revision.js'
import { REMOTE_FORK, type RemoteForkOptions } from '../../../services/thread-service-remote-fork.js'
import { matchesRemoteFork, remoteForkId, remoteForkProofId, type RemoteForkProof } from './fork-proof.js'
import { remoteHistoryBusy } from '../../../services/remote-history-rewind.js'

export class RemoteCodeHistory {
  private code: RemoteCodeManagement
  private rewind: RemoteHistoryRewind
  private forkActive = 0
  constructor(private runtime: ServerRuntime) { this.code = new RemoteCodeManagement(runtime, async () => []); this.rewind = new RemoteHistoryRewind(runtime) }
  supports(method: string): method is keyof typeof CodeHistoryParamSchemas { return Object.hasOwn(CodeHistoryParamSchemas, method) }
  private async source(raw: unknown) {
    const p = CodeForkParams.parse(raw), thread = await this.runtime.threadService.getMetadata(p.threadId)
    if (!thread) throw new RemoteNoEffect('NOT_FOUND')
    if (!await isRemoteCodeAllowed(this.runtime, thread)) throw new RemoteNoEffect('NOT_A_CODE_TASK')
    if (metadataRevision(thread) !== p.expectedRevision ||
      (await this.runtime.sessionStore.itemHistoryVersion?.(thread.id) ?? 'legacy') !== p.historyVersion)
      throw new RemoteNoEffect('REVISION_CONFLICT')
    if (thread.remoteRewind?.phase === 'pending' || thread.goal?.status === 'active') throw new RemoteNoEffect('TASK_BUSY')
    if (await remoteHistoryBusy(this.runtime.turnService, thread)) throw new RemoteNoEffect('TASK_BUSY')
    if (thread.designProfile || !thread.turns.some(turn => turn.id === p.turnId)) throw new RemoteNoEffect('INVALID_REQUEST')
    return { p, thread }
  }
  async preflight(method: string, raw: unknown) {
    if (method.startsWith('code.rewind.')) return this.rewind.preflight(method, raw)
    await this.source(raw)
  }
  private async settle(proof: RemoteForkProof) {
    const thread = await this.runtime.threadService.get(proof.childId)
    if (!thread || !matchesRemoteFork(thread, proof)) return undefined
    if (proof.state !== 'applied') await this.runtime.rooms!.exclusive(async () => {
      const store = this.runtime.rooms!.deps.store, id = remoteForkProofId(proof.childId), row = await store.get<RemoteForkProof>('remote_history', id)
      if (!row || !matchesRemoteFork(thread, row.value)) throw new Error('REMOTE_FORK_CONFLICT')
      if (row.value.state !== 'applied') await store.commit({ requestId: id + '-applied',
        checks: [{ kind: 'remote_history', id, expectedRevision: row.revision }],
        puts: [{ kind: 'remote_history', id, value: { ...row.value, state: 'applied' } }] })
    })
    return { thread: await this.code.summary(thread), sourceThreadId: proof.provenance.sourceThreadId,
      sourceTurnId: proof.provenance.sourceTurnId, historyVersion: await this.runtime.sessionStore.itemHistoryVersion?.(thread.id) ?? 'legacy' }
  }
  async dispatch(method: string, raw: unknown, envelope: Envelope) {
    if (method === 'code.rewind.preview') return this.rewind.preview(raw, envelope)
    if (method === 'code.rewind.commit') return this.rewind.commit(raw, envelope)
    if (this.forkActive >= 2) throw new RemoteNoEffect('TASK_BUSY')
    this.forkActive++
    try { return await this.fork(raw, envelope) } finally { this.forkActive-- }
  }
  private async fork(raw: unknown, envelope: Envelope) {
    const { p, thread } = await this.source(raw), requestKey = receiptKey(envelope, envelope.call.requestId), childId = remoteForkId(requestKey)
    const proof: RemoteForkProof = { version: 1, kind: 'fork', state: 'prepared', accountId: envelope.accountId,
      deviceId: envelope.deviceId, requestId: envelope.call.requestId, requestKey, childId,
      fingerprint: createHash('sha256').update(canonical(p)).digest('hex'), provenance: {
        requestKey, sourceThreadId: thread.id, sourceTurnId: p.turnId, sourceRevision: thread.revision ?? 0,
        historyVersion: p.historyVersion, beforeTurn: p.beforeTurn } }
    await this.runtime.rooms!.exclusive(async () => {
      const store = this.runtime.rooms!.deps.store, id = remoteForkProofId(childId), old = await store.get<RemoteForkProof>('remote_history', id)
      if (old) { if (old.value.fingerprint !== proof.fingerprint) throw new Error('REQUEST_CONFLICT'); return }
      await store.commit({ requestId: id + '-prepare', checks: [{ kind: 'remote_history', id, expectedRevision: null }],
        puts: [{ kind: 'remote_history', id, value: proof }] })
    })
    try { await this.runtime.threadService.fork(thread.id, { turnId: p.turnId, beforeTurn: p.beforeTurn, title: p.title,
      [REMOTE_FORK]: { id: childId, provenance: proof.provenance, assertIdle: async () => {
        if (await remoteHistoryBusy(this.runtime.turnService, thread)) throw new PolicyMutationRejected('TASK_BUSY')
      } } } as RemoteForkOptions) }
    catch (error) { if (error instanceof PolicyMutationRejected) throw new RemoteNoEffect(error.code); throw error }
    const result = await this.settle(proof)
    if (!result) throw new Error('REMOTE_FORK_NOT_CONFIRMED')
    return result
  }
  reconcileThread(threadId: string) { return this.rewind.reconcileThread(threadId) }
  async recover(scope: RemoteScope, receipt: Receipt) {
    if (receipt.method.startsWith('code.rewind.')) return this.rewind.recover(scope, receipt)
    if (receipt.method !== 'code.fork') return undefined
    const id = remoteForkId(receiptKey(scope, receipt.requestId))
    const proof = await this.runtime.rooms!.deps.store.get<RemoteForkProof>('remote_history', remoteForkProofId(id))
    return proof && proof.value.accountId === scope.accountId && proof.value.deviceId === scope.deviceId &&
      proof.value.requestId === receipt.requestId ? this.settle(proof.value) : undefined
  }
}
