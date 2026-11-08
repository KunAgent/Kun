import { AgentDispatchPreparationError } from '../../delegation/agent-dispatch-preparation.js'
import { canonical } from '@kun/remote-protocol'
import type { DispatchIntent, DispatchParams, DispatchRoute } from '@kun/remote-protocol'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { AgentDispatchIntent } from '../../contracts/agent-dispatch-intents.js'
import { AgentDispatchConflictError } from '../../delegation/agent-dispatch-service.js'
import { requireCode } from '../code/access.js'
import { codeAgents } from '../code/model-catalog.js'
import type { Envelope } from '../contracts.js'
import { receiptKey, type Receipt } from '../requests/receipts.js'
import { RemoteNoEffect } from '../requests/rejections.js'

type Action = DispatchParams['dispatch.act']
const pending = new Set(['pending_confirmation', 'countdown', 'paused'])
const terminal = new Set(['completed', 'failed', 'cancelled'])
const route = ({ agentId, profileId, model, providerId, credentialMode, reasoningEffort }: DispatchRoute) =>
  [agentId, profileId ?? null, model ?? null, providerId ?? null, credentialMode ?? null, reasoningEffort ?? null]

/** Explicit projection: internal execution data must never be returned to a phone. */
export function dispatchView(intent: AgentDispatchIntent): DispatchIntent {
  const { intentId, kind, state, revision, deadline, updatedAt, recommendation: r, source } = intent
  return { intentId, kind, state, revision, deadline, updatedAt,
    source: { threadId: source.threadId, turnId: source.turnId, toolCallId: source.toolCallId },
    recommendation: { title: r.title, agentId: r.agentId, agentName: r.agentName, model: r.model,
      permissionMode: r.permissionMode, assignments: r.assignments },
    ...(intent.target ? { target: { threadId: intent.target.threadId, workerIds: intent.target.workerIds } } : {}),
    ...(intent.error ? { error: intent.error.slice(0, 2000) } : {}),
    ...(intent.resultSummary ? { resultSummary: intent.resultSummary.slice(0, 2000) } : {}) }
}

/** Remote controls share the desktop state machine and both durable idempotency ledgers. */
export class RemoteDispatch {
  constructor(private runtime: ServerRuntime, private models: () => Promise<string[]>) {}
  private service() {
    if (!this.runtime.agentDispatchService) throw new Error('UNSUPPORTED_OPERATION')
    return this.runtime.agentDispatchService
  }
  private async owned(threadId: string, intentId?: string) {
    await requireCode(this.runtime, threadId)
    const service = this.service()
    if (!intentId) return undefined
    const intent = await service.get(intentId)
    if (!intent || intent.source.threadId !== threadId) throw new RemoteNoEffect('NOT_FOUND')
    return intent
  }
  async list(threadId: string) {
    await this.owned(threadId)
    const all = (await this.service().list(threadId)).filter(i => i.source.threadId === threadId)
      .sort((a, b) => Number(terminal.has(a.state)) - Number(terminal.has(b.state)) || b.updatedAt.localeCompare(a.updatedAt))
    const intents: DispatchIntent[] = []
    let bytes = 0
    for (const intent of all) {
      const view = dispatchView(intent), size = Buffer.byteLength(JSON.stringify(view))
      if (intents.length >= 30 || bytes + size > 190_000) break
      intents.push(view); bytes += size
    }
    return { intents, serverNow: Date.now(), hasMore: intents.length < all.length }
  }
  async catalog(threadId: string) {
    await this.owned(threadId)
    const agents = await codeAgents(this.runtime, await this.models())
    // Dispatch routes cannot represent opaque gateway bindings. Never silently strip routeKey.
    return { agents: agents.map(agent => ({ ...agent,
      routes: agent.routes.filter(r => !r.routeKey && r.credentialMode !== 'kun-gateway')
    })).filter(agent => agent.routes.length) }
  }
  async preflight(p: Action) {
    const intent = (await this.owned(p.threadId, p.intentId))!
    if (intent.revision !== p.expectedRevision) throw new RemoteNoEffect('REVISION_CONFLICT')
    if (terminal.has(intent.state) || intent.state === 'stopping') throw new RemoteNoEffect('REVISION_CONFLICT')
    if (p.action === 'pause' && !pending.has(intent.state) ||
        p.action === 'resume' && intent.state !== 'paused' ||
        p.action === 'start_now' && !['pending_confirmation', 'countdown'].includes(intent.state) ||
        p.action === 'update' && intent.state !== 'paused') throw new RemoteNoEffect('REVISION_CONFLICT')
    if (p.action === 'update') {
      // Legacy cards without assignments remain readable; their batch size is not public.
      const current = intent.recommendation.assignments
      if (!current || current.length !== p.assignments?.length) throw new RemoteNoEffect('INVALID_REQUEST')
      const { agents } = await this.catalog(p.threadId)
      for (const [index, next] of p.assignments.entries()) {
        if (canonical(route(next)) === canonical(route(current[index]))) continue
        if (next.profileId !== current[index].profileId) throw new RemoteNoEffect('INVALID_REQUEST')
        const offered = agents.find(a => a.id === next.agentId)?.routes.some(r =>
          r.providerId === next.providerId && r.credentialMode === next.credentialMode && r.models.includes(next.model ?? ''))
        if (!offered) throw new RemoteNoEffect('INVALID_REQUEST')
      }
    }
  }
  async act(scope: Envelope, p: Action) {
    await this.preflight(p)
    try {
      const intent = await this.service().act(p.intentId, {
        action: p.action, expectedRevision: p.expectedRevision, requestId: receiptKey(scope, scope.call.requestId),
        ...(p.action === 'update' ? { recommendation: { assignments: p.assignments } } : {})
      })
      return { intent: dispatchView(intent), serverNow: Date.now() }
    } catch (error) {
      if (error instanceof AgentDispatchConflictError) throw new RemoteNoEffect('REVISION_CONFLICT')
      if (error instanceof AgentDispatchPreparationError) throw new RemoteNoEffect('INVALID_REQUEST')
      // An emit/admission failure may occur after persistence. The receipt must stay uncertain.
      throw error
    }
  }
  async recover(scope: Envelope, receipt: Receipt) {
    const p = receipt.params as Action | undefined
    if (!p) return undefined
    const intent = (await this.owned(p.threadId, p.intentId))!
    if (!Object.hasOwn(intent.requestLedger, receiptKey(scope, receipt.requestId))) return undefined
    return { intent: dispatchView(intent), serverNow: Date.now() }
  }
}
