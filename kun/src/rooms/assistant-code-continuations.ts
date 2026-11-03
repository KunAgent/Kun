import { createHash, randomUUID } from 'node:crypto'
import { sourceDispatchAuthority } from '../workbench-bridge/dispatch-authority.js'
import { assistantSourceEvidence } from './assistant-continuation-source.js'
import type { RoomContinuation } from './room-continuation-dispatch.js'
import type { RoomRuntimeDeps } from './room-runtime-types.js'
import type { RoomStoredDocument } from './room-store.js'

type Handoff = { id: string; status: 'pending' | 'waiting' | 'admitted' | 'revoked'; input: RoomContinuation; resultHash: string; createdAt: string; turnId?: string }
const digest = (s: string) => createHash('sha256').update(s).digest('hex')
const handoffId = (input: RoomContinuation) => `kun-assistant-handoff-${digest(JSON.stringify([input.assistantTaskId, input.assistantResultId, input.threadId, input.sourceTurnId]))}`

/** Durable Code-thread handoffs use the existing owner scheduler and idempotent turn admission. */
export class AssistantCodeContinuations {
  private cursor = 0
  constructor(private readonly deps: RoomRuntimeDeps) {}
  async enqueue(input: RoomContinuation, body: string): Promise<'queued' | 'ignored'> {
    const authority = await this.deps.assistantContinuationAuthority?.(input)
    if (authority?.unavailable) throw new Error('assistant authority temporarily unavailable')
    const evidence = await assistantSourceEvidence(this.deps, input)
    if (!authority?.authorized || !authority.result || authority.result.body !== body || !evidence || evidence.thread.roomContext) return 'ignored'
    const id = handoffId(input), existing = await this.deps.store.get<Handoff>('assistant_continuation', id)
    if (existing) {
      if (existing.value.resultHash !== digest(body)) throw new Error('assistant result identity changed')
      return existing.value.status === 'revoked' ? 'ignored' : 'queued'
    }
    const value: Handoff = { id, status: 'pending', input, resultHash: digest(body), createdAt: new Date().toISOString() }
    await this.deps.store.commit({ requestId: id, checks: [{ kind: 'assistant_continuation', id, expectedRevision: null }],
      puts: [{ kind: 'assistant_continuation', id, value }], events: [] })
    return 'queued'
  }
  private async set(row: RoomStoredDocument<Handoff>, status: Handoff['status'], turnId?: string): Promise<void> {
    await this.deps.store.commit({ requestId: randomUUID(), checks: [{ kind: 'assistant_continuation', id: row.id, expectedRevision: row.revision }],
      puts: [{ kind: 'assistant_continuation', id: row.id, value: { ...row.value, status, ...(turnId ? { turnId } : {}) } }], events: [] })
  }
  private async revoke(row: RoomStoredDocument<Handoff>): Promise<boolean> {
    if (row.value.status === 'waiting' && row.value.turnId) {
      try { await this.deps.turns.cancelQueuedTurn({ threadId: row.value.input.threadId, turnId: row.value.turnId }) }
      catch {
        const thread = await this.deps.threads.getMetadata(row.value.input.threadId)
        const turn = thread?.turns.find(item => item.id === row.value.turnId)
        if (turn && turn.status !== 'queued') { await this.set(row, 'admitted', turn.id); return true }
        if (turn) return false
      }
    }
    await this.set(row, 'revoked')
    return true
  }
  async status(input: RoomContinuation): Promise<'queued' | 'completed' | 'failed' | 'revoked'> {
    const row = await this.deps.store.get<Handoff>('assistant_continuation', handoffId(input))
    if (!row || row.value.input.assistantOwnerId !== input.assistantOwnerId || row.value.input.sourceFingerprint !== input.sourceFingerprint) throw new Error('assistant continuation not found')
    if (row.value.status === 'revoked') return 'revoked'
    if (row.value.status === 'pending' || row.value.status === 'waiting' || !row.value.turnId) return 'queued'
    const thread = await this.deps.threads.getMetadata(input.threadId)
    const turn = thread?.turns.find(item => item.id === row.value.turnId)
    if (!turn) return 'revoked'
    return turn.status === 'completed' ? 'completed' : ['failed', 'aborted'].includes(turn.status) ? 'failed' : 'queued'
  }
  async queuedTurnAllowed(threadId: string, clientRequestId: string): Promise<boolean> {
    const row = await this.deps.store.get<Handoff>('assistant_continuation', clientRequestId)
    if (!row || row.value.input.threadId !== threadId || row.value.status === 'revoked') return false
    const authority = await this.deps.assistantContinuationAuthority?.(row.value.input)
    if (authority?.unavailable) throw new Error('assistant authority temporarily unavailable')
    return Boolean(authority?.authorized && authority.result && digest(authority.result.body) === row.value.resultHash && await assistantSourceEvidence(this.deps, row.value.input))
  }
  async tick(): Promise<boolean> {
    const rows = await this.deps.store.list<Handoff>('assistant_continuation', { status: ['pending', 'waiting'], order: 'asc', afterSeq: this.cursor, limit: 100 })
    if (!rows.length) { this.cursor = 0; return false }
    this.cursor = rows.at(-1)!.seq
    let progressed = false
    for (const row of rows) {
      const input = row.value.input
      if (row.value.status === 'waiting' && row.value.turnId) {
        const thread = await this.deps.threads.getMetadata(input.threadId)
        const turn = thread?.turns.find(item => item.id === row.value.turnId)
        if (!turn) { await this.set(row, 'revoked'); progressed = true; continue }
        if (turn.status !== 'queued') { await this.set(row, 'admitted', turn.id); progressed = true; continue }
      }
      const authority = await this.deps.assistantContinuationAuthority?.(input)
      if (authority?.unavailable) continue
      if (!authority?.authorized || !authority.result || digest(authority.result.body) !== row.value.resultHash) {
        progressed = await this.revoke(row) || progressed; continue
      }
      const evidence = await assistantSourceEvidence(this.deps, input)
      if (!evidence || evidence.thread.roomContext) {
        progressed = await this.revoke(row) || progressed; continue
      }
      if (row.value.status === 'waiting') continue
      const { thread, source } = evidence
      const existing = thread.turns.find(turn => turn.clientRequestId === row.id)
      if (!existing && thread.turns.some(turn => ['running', 'queued'].includes(turn.status))) continue
      const policy = sourceDispatchAuthority(thread, source)
      try {
        const started = await this.deps.turns.enqueueTurn({ threadId: thread.id, request: {
          prompt: input.prompt, displayText: 'Personal assistant result', messageSource: 'background_subagent', clientRequestId: row.id,
          ...(source.clientSurface ? { clientSurface: source.clientSurface } : {}),
          ...(source.model ? { model: source.model } : {}), ...(source.providerId ? { providerId: source.providerId } : {}),
          ...(source.accountId ? { accountId: source.accountId } : {}), ...(source.harnessId ? { harnessId: source.harnessId } : {}),
          ...(source.credentialMode ? { credentialMode: source.credentialMode } : {}), ...(source.gatewayBinding ? { gatewayBinding: source.gatewayBinding } : {}),
          ...(source.reasoningEffort ? { reasoningEffort: source.reasoningEffort } : {}), ...(source.serviceTier ? { serviceTier: source.serviceTier } : {}),
          ...(source.harnessAgentId ? { harnessAgentId: source.harnessAgentId } : {}), ...(source.harnessSettings ? { harnessSettings: source.harnessSettings } : {}),
          ...(source.mode ? { mode: source.mode } : {}), ...(source.agentSurface ? { agentSurface: source.agentSurface } : {}),
          ...(source.designProfile ? { designProfile: source.designProfile } : {}), ...(source.designDocumentTarget ? { designDocumentTarget: source.designDocumentTarget } : {}),
          ...(source.disableUserInput !== undefined ? { disableUserInput: source.disableUserInput } : {}),
          approvalPolicy: policy.approvalPolicy, sandboxMode: policy.sandboxMode, approvalReviewer: policy.approvalReviewer
        } })
        await this.set(row, 'waiting', started.turnId); progressed = true
      } catch { /* Busy threads and transient admission failures remain pending. */ }
    }
    return progressed
  }
}
