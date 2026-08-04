import type { GraphRunV1, GraphSupervisionObligationV1 } from '../contracts/graph.js'
import { redactSecretText } from '../config/secret-redaction.js'
import type { GraphLeadDeliveryResult, GraphSupervisionPort } from './graph-scheduler-types.js'
import { GraphRunConflictError, type GraphRunStore } from './graph-run-store.js'
import {
  graphLatestSemanticProgressSeq,
  graphSupervisionObligationForSignal,
  graphSupervisionObligationIsActionable,
  graphSupervisionRetryDelayMs
} from './graph-supervision-obligation.js'

const DELIVERY_LEASE_MS = 30_000
const MAX_NO_PROGRESS_EPISODES = 3
type Signal = Parameters<GraphSupervisionPort['signal']>[0]
type ObligationUpdate = (run: GraphRunV1, obligation: GraphSupervisionObligationV1) => GraphSupervisionObligationV1 | null

export class GraphSupervisionObligationManager {
  constructor(private readonly options: {
    store: GraphRunStore
    nowIso: () => string
    nowMs: () => number
    nextId: (prefix: string) => string
    isLeadTurnActive?: (run: GraphRunV1) => boolean
  }) {}

  async persistSignal(input: Signal, recordRequest: boolean): Promise<GraphSupervisionObligationV1 | null> {
    for (let retry = 0; retry < 5; retry += 1) {
      let run = await this.options.store.get(input.runId)
      if (!run) return null
      const candidate = graphSupervisionObligationForSignal(run, input, this.options.nowIso())
      let obligation = run.supervisionObligations.find((entry) => entry.id === candidate.id)
      try {
        if (!obligation) {
          run = (await this.options.store.append(run.id, {
            expectedSeq: run.lastEventSeq, graphRevision: run.currentRevision,
            commandId: this.options.nextId('graph_supervision'), idempotencyKey: `supervision-obligation:${candidate.id}`,
            event: { type: 'supervision_obligation_opened', payload: { obligation: candidate } }
          })).state
          obligation = run.supervisionObligations.find((entry) => entry.id === candidate.id)
        }
        if (recordRequest) {
          run = (await this.options.store.append(run.id, {
            expectedSeq: run.lastEventSeq, graphRevision: run.currentRevision,
            commandId: this.options.nextId('graph_supervision'), idempotencyKey: `supervision:${run.id}:${candidate.id}`,
            event: { type: 'supervision_requested', payload: {
              signalId: this.options.nextId('graph_signal'), reason: input.reason,
              nodeIds: input.nodeIds, digest: input.digest.slice(0, 4_096)
            } }
          })).state
          obligation = run.supervisionObligations.find((entry) => entry.id === candidate.id)
        }
        return obligation ?? null
      } catch (error) {
        if (!(error instanceof GraphRunConflictError) || retry === 4) throw error
      }
    }
    return null
  }

  canQueue(obligation: GraphSupervisionObligationV1): boolean {
    if (obligation.state === 'resolved' || obligation.state === 'needs_attention') return false
    const now = this.options.nowMs()
    if (obligation.state === 'delivering' && future(obligation.leaseUntil, now)) return false
    return !((obligation.state === 'retry_scheduled' || obligation.state === 'awaiting_action') && future(obligation.nextWakeAt, now))
  }

  async claim(runId: string, obligationIds: readonly string[]): Promise<{ run: GraphRunV1; obligations: GraphSupervisionObligationV1[] } | null> {
    const claimed: GraphSupervisionObligationV1[] = []
    for (const obligationId of obligationIds) {
      const result = await this.update(runId, obligationId, (run, current) => {
        // Terminal / already-settled obligations must no-op. Never re-emit resolved
        // for a non-actionable obligation that is already resolved (#1082).
        if (current.state === 'resolved' || current.state === 'needs_attention') return null
        if (!graphSupervisionObligationIsActionable(run, current)) {
          return resolved(current, this.options.nowIso())
        }
        if (current.state === 'delivering' && future(current.leaseUntil, this.options.nowMs())) return null
        if ((current.state === 'retry_scheduled' || current.state === 'awaiting_action') && future(current.nextWakeAt, this.options.nowMs())) return null
        if (current.state === 'awaiting_action' && this.options.isLeadTurnActive?.(run)) return null
        const next = { ...current, state: 'delivering' as const, deliveryAttempts: current.deliveryAttempts + 1, leaseUntil: this.timestampAfter(DELIVERY_LEASE_MS), updatedAt: this.options.nowIso() }
        delete next.nextWakeAt
        delete next.lastError
        return next
      }, 'claim')
      if (result?.changed && result.obligation.state === 'delivering') claimed.push(result.obligation)
    }
    const run = await this.options.store.get(runId)
    return run ? { run, obligations: claimed } : null
  }

  async recordDelivered(runId: string, obligations: readonly GraphSupervisionObligationV1[], delivery: Extract<GraphLeadDeliveryResult, { status: 'delivered' }>): Promise<void> {
    for (const obligation of obligations) {
      await this.update(runId, obligation.id, (run, current) => {
        if (current.state === 'resolved' || current.state === 'needs_attention') return null
        if (!graphSupervisionObligationIsActionable(run, current) || isTerminal(run.status)) {
          return resolved(current, this.options.nowIso())
        }
        const next = {
          ...current, state: 'awaiting_action' as const,
          lastDeliveredSeq: Math.max(current.lastDeliveredSeq ?? 0, delivery.deliveredSeq),
          lastDeliveredAt: this.options.nowIso(),
          nextWakeAt: this.timestampAfter(graphSupervisionRetryDelayMs(current.noProgressCount)),
          updatedAt: this.options.nowIso()
        }
        delete next.leaseUntil
        delete next.lastError
        return next
      }, `delivered-${obligation.deliveryAttempts}`)
    }
  }

  async scheduleRetry(runId: string, obligations: readonly GraphSupervisionObligationV1[], error: string): Promise<void> {
    for (const obligation of obligations) {
      await this.update(runId, obligation.id, (run, current) => {
        if (current.state === 'resolved' || current.state === 'needs_attention') return null
        if (!graphSupervisionObligationIsActionable(run, current)) {
          return resolved(current, this.options.nowIso())
        }
        const next = {
          ...current, state: 'retry_scheduled' as const,
          nextWakeAt: this.timestampAfter(graphSupervisionRetryDelayMs(Math.max(0, current.deliveryAttempts - 1))),
          lastError: sanitizeError(error), updatedAt: this.options.nowIso()
        }
        delete next.leaseUntil
        return next
      }, `delivery-retry-${obligation.deliveryAttempts}`)
    }
  }

  async rearmAfterNoProgress(runId: string, obligationIds: readonly string[]): Promise<GraphSupervisionObligationV1[]> {
    const attention: GraphSupervisionObligationV1[] = []
    for (const obligationId of obligationIds) {
      const before = await this.options.store.get(runId)
      const current = before?.supervisionObligations.find((entry) => entry.id === obligationId)
      const latestProgress = current ? graphLatestSemanticProgressSeq(await this.options.store.events(runId, current.lastProgressSeq), current.lastProgressSeq) : undefined
      const result = await this.update(runId, obligationId, (run, obligation) => {
        // Already terminal lifecycle states are durable no-ops (#1082).
        if (obligation.state === 'resolved' || obligation.state === 'needs_attention') return null
        if (!graphSupervisionObligationIsActionable(run, obligation)) {
          return resolved(obligation, this.options.nowIso())
        }
        if (obligation.state !== 'awaiting_action') return null
        if (latestProgress !== undefined && latestProgress > obligation.lastProgressSeq) {
          const next = { ...obligation, state: 'retry_scheduled' as const, noProgressCount: 0, lastProgressSeq: latestProgress, nextWakeAt: this.timestampAfter(graphSupervisionRetryDelayMs(0)), updatedAt: this.options.nowIso() }
          delete next.leaseUntil
          return next
        }
        const noProgressCount = obligation.noProgressCount + 1
        if (noProgressCount >= MAX_NO_PROGRESS_EPISODES) {
          const next = { ...obligation, state: 'needs_attention' as const, noProgressCount, attentionReason: 'The source Lead completed three supervision episodes without resolving the required action.', updatedAt: this.options.nowIso() }
          delete next.nextWakeAt
          delete next.leaseUntil
          return next
        }
        const next = { ...obligation, state: 'retry_scheduled' as const, noProgressCount, nextWakeAt: this.timestampAfter(graphSupervisionRetryDelayMs(noProgressCount - 1)), updatedAt: this.options.nowIso() }
        delete next.leaseUntil
        return next
      }, `no-progress-${obligationId}`)
      if (result?.obligation.state === 'needs_attention') attention.push(result.obligation)
    }
    return attention
  }

  async markNeedsAttention(runId: string, obligations: readonly GraphSupervisionObligationV1[], reason: string): Promise<void> {
    for (const obligation of obligations) {
      await this.update(runId, obligation.id, (_run, current) => {
        if (current.state === 'resolved') return null
        const next = { ...current, state: 'needs_attention' as const, attentionReason: sanitizeError(reason), updatedAt: this.options.nowIso() }
        delete next.nextWakeAt
        delete next.leaseUntil
        return next
      }, 'attention')
    }
    await this.transitionRunToHuman(runId, reason)
  }

  async resolve(runId: string, obligations: readonly GraphSupervisionObligationV1[]): Promise<void> {
    for (const obligation of obligations) {
      await this.update(runId, obligation.id, (_run, current) => current.state === 'resolved' ? null : resolved(current, this.options.nowIso()), 'resolved')
    }
  }

  async update(runId: string, obligationId: string, update: ObligationUpdate, operation: string, stableIdempotencyKey?: string): Promise<{ run: GraphRunV1; obligation: GraphSupervisionObligationV1; changed: boolean } | null> {
    for (let retry = 0; retry < 5; retry += 1) {
      const run = await this.options.store.get(runId)
      if (!run) return null
      const current = run.supervisionObligations.find((entry) => entry.id === obligationId)
      if (!current) return null
      const next = update(run, current)
      if (!next) return { run, obligation: current, changed: false }
      // Semantic no-op: do not append resolved→resolved noise even if a caller
      // forgets the early return (defense in depth for #1082).
      if (current.state === 'resolved' && next.state === 'resolved') {
        return { run, obligation: current, changed: false }
      }
      try {
        // Resolve transitions use a stable per-obligation key so concurrent
        // force-resolve paths collapse to one durable event. Other operations
        // keep seq-scoped keys for legitimate multi-step progress.
        const idempotencyKey = stableIdempotencyKey ?? (
          next.state === 'resolved'
            ? `supervision-obligation:${obligationId}:resolved`
            : ['supervision-obligation', obligationId, operation, String(run.lastEventSeq)].join(':').slice(0, 256)
        )
        const appended = await this.options.store.append(run.id, {
          expectedSeq: run.lastEventSeq, graphRevision: run.currentRevision,
          commandId: this.options.nextId('graph_supervision'),
          idempotencyKey,
          event: { type: obligationEventType(next.state), payload: { obligation: next } }
        })
        const obligation = appended.state.supervisionObligations.find((entry) => entry.id === obligationId)!
        return { run: appended.state, obligation, changed: !appended.duplicate }
      } catch (error) {
        if (!(error instanceof GraphRunConflictError) || retry === 4) throw error
      }
    }
    return null
  }

  async transitionRunToHuman(runId: string, reason: string): Promise<void> {
    for (let retry = 0; retry < 5; retry += 1) {
      const run = await this.options.store.get(runId)
      if (!run || run.status === 'awaiting_human' || isTerminal(run.status) || !['running', 'paused', 'pausing', 'awaiting_supervision', 'completing'].includes(run.status)) return
      try {
        await this.options.store.append(run.id, {
          expectedSeq: run.lastEventSeq, graphRevision: run.currentRevision,
          commandId: this.options.nextId('graph_supervision'), idempotencyKey: `supervision-attention:${run.id}:${run.currentRevision}`,
          event: { type: 'run_status_changed', payload: { from: run.status, to: 'awaiting_human', reason: sanitizeError(reason) } }
        })
        return
      } catch (error) {
        if (!(error instanceof GraphRunConflictError) || retry === 4) throw error
      }
    }
  }

  private timestampAfter(delayMs: number): string { return new Date(this.options.nowMs() + Math.max(0, delayMs)).toISOString() }
}

function future(value: string | undefined, nowMs: number): boolean {
  const parsed = value ? Date.parse(value) : NaN
  return Number.isFinite(parsed) && parsed > nowMs
}
function resolved(current: GraphSupervisionObligationV1, nowIso: string): GraphSupervisionObligationV1 {
  const next = { ...current, state: 'resolved' as const, updatedAt: nowIso, resolvedAt: nowIso }
  delete next.leaseUntil; delete next.nextWakeAt; delete next.lastError; delete next.attentionReason
  return next
}
function sanitizeError(value: string): string {
  return redactSecretText(value).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4_096) || 'Graph supervision failed without a diagnostic.'
}
function obligationEventType(state: GraphSupervisionObligationV1['state']): 'supervision_delivery_started' | 'supervision_retry_scheduled' | 'supervision_obligation_resolved' | 'supervision_attention_required' | 'supervision_obligation_updated' {
  switch (state) {
    case 'delivering': return 'supervision_delivery_started'
    case 'retry_scheduled': return 'supervision_retry_scheduled'
    case 'resolved': return 'supervision_obligation_resolved'
    case 'needs_attention': return 'supervision_attention_required'
    default: return 'supervision_obligation_updated'
  }
}
function isTerminal(status: GraphRunV1['status']): boolean { return status === 'completed' || status === 'failed' || status === 'cancelled' }
