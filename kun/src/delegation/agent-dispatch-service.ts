import { createHash } from 'node:crypto'
import {
  AgentDispatchIntentSchema,
  AgentDispatchRecommendationSchema,
  type AgentDispatchAction,
  type AgentDispatchIntent,
  type AgentDispatchKind,
  type AgentDispatchPolicySnapshot,
  type AgentDispatchRecommendation,
  type AgentDispatchSource,
  type AgentDispatchState,
  type AgentDispatchTarget
} from '../contracts/agent-dispatch-intents.js'
import { kunToolPermissionModeFromSettings } from '../contracts/policy.js'
import type { ApprovalResolution } from '../domain/approval.js'
import type { ThreadStore } from '../ports/thread-store.js'
import { runWithoutTurnMutationFence } from '../manager/turn-mutation-context.js'
import type { AgentDispatchIntentStore } from './agent-dispatch-intent-store.js'

export const AGENT_DISPATCH_COUNTDOWN_MS = 60_000
const terminal = new Set<AgentDispatchState>(['completed', 'failed', 'cancelled'])
const editable = new Set<AgentDispatchState>(['pending_confirmation', 'reviewing', 'countdown', 'paused'])
const active = new Set<AgentDispatchState>(['starting', 'uncertain', 'running', 'awaiting_parent', 'stopping'])

export type AgentDispatchReconciliation = {
  state: 'queued' | 'starting' | 'running' | 'awaiting_parent' | 'completed' | 'failed' | 'cancelled' | 'stopping'
  target?: AgentDispatchTarget
  error?: string
  resultSummary?: string
} | { state: 'absent' } | { state: 'resume' }

export type AgentDispatchHandler = {
  validate(intent: AgentDispatchIntent, signal: AbortSignal): Promise<void>
  review?(intent: AgentDispatchIntent, signal: AbortSignal): Promise<ApprovalResolution>
  start(intent: AgentDispatchIntent, signal: AbortSignal): Promise<AgentDispatchTarget>
  cancel?(intent: AgentDispatchIntent, signal: AbortSignal): Promise<void>
  takeover?(intent: AgentDispatchIntent, signal: AbortSignal): Promise<void>
  reconcile?(intent: AgentDispatchIntent, signal: AbortSignal): Promise<AgentDispatchReconciliation | null>
  updatePayload?(
    intent: AgentDispatchIntent, recommendation: AgentDispatchRecommendation,
    payload?: Record<string, unknown>
  ): Promise<Record<string, unknown>> | Record<string, unknown>
}

export type AgentDispatchProposal = {
  kind: AgentDispatchKind
  source: Omit<AgentDispatchSource, 'applicationSessionId'>
  policySnapshot: AgentDispatchPolicySnapshot
  recommendation: AgentDispatchRecommendation
  payload: Record<string, unknown>
  batchId?: string
}

export type AgentDispatchServiceOptions = {
  store: AgentDispatchIntentStore
  applicationSessionId: string
  onUpdated?(intent: AgentDispatchIntent): void | Promise<void>
  review?(intent: AgentDispatchIntent, signal: AbortSignal): Promise<ApprovalResolution>
  now?: () => number
}

export class AgentDispatchConflictError extends Error {
  readonly code = 'AGENT_DISPATCH_REVISION_CONFLICT'
  constructor(readonly currentRevision: number) {
    super(`Dispatch card changed; reload revision ${currentRevision}`)
    this.name = 'AgentDispatchConflictError'
  }
}

export class AgentDispatchService {
  private readonly handlers = new Map<AgentDispatchKind, AgentDispatchHandler>()
  private readonly inFlight = new Map<string, Promise<void>>()
  private readonly takeoverOperations = new Map<string, Promise<void>>()
  private readonly commands = new Set<Promise<unknown>>()
  private readonly controller = new AbortController()
  private timer?: ReturnType<typeof setTimeout>
  private accepting = true
  private started = false
  private readonly now: () => number

  constructor(private readonly options: AgentDispatchServiceOptions) {
    this.now = options.now ?? Date.now
  }

  registerHandler(kind: AgentDispatchKind, handler: AgentDispatchHandler): void {
    if (this.handlers.has(kind)) throw new Error(`Dispatch handler already registered: ${kind}`)
    this.handlers.set(kind, handler)
  }

  get(intentId: string): Promise<AgentDispatchIntent | null> { return this.options.store.get(intentId) }
  list(threadId?: string): Promise<AgentDispatchIntent[]> { return this.options.store.list(threadId) }

  propose(proposal: AgentDispatchProposal): Promise<AgentDispatchIntent> {
    return this.command(() => this.proposeNow(proposal))
  }

  private async proposeNow(proposal: AgentDispatchProposal): Promise<AgentDispatchIntent> {
    this.assertAdmission()
    const intentId = stableAgentDispatchIntentId(proposal)
    const existing = await this.get(intentId)
    if (existing) return existing
    const now = this.nowIso()
    const permissionMode = kunToolPermissionModeFromSettings(proposal.policySnapshot)
    const intent = AgentDispatchIntentSchema.parse({
      ...proposal, intentId,
      source: { ...proposal.source, applicationSessionId: this.options.applicationSessionId },
      recommendation: { ...proposal.recommendation, permissionMode },
      state: stateForMode(permissionMode), revision: 1,
      startRequestId: `${intentId}:start`,
      deadline: permissionMode === 'full-access' ? this.deadline() : undefined,
      createdAt: now, updatedAt: now
    })
    await this.handler(intent).validate(intent, this.controller.signal)
    const persisted = await this.options.store.transaction((file) => {
      const repeated = file.intents.find((entry) => entry.intentId === intentId)
      if (repeated) return repeated
      if (intent.batchId && intent.state === 'countdown') {
        const batch = file.intents.find((entry) => entry.batchId === intent.batchId &&
          entry.source.threadId === intent.source.threadId && entry.source.turnId === intent.source.turnId &&
          entry.state === 'countdown' && entry.source.applicationSessionId === intent.source.applicationSessionId)
        if (batch?.deadline) intent.deadline = batch.deadline
      }
      file.intents.push(intent)
      return intent
    })
    await this.emit(persisted)
    this.launch(persisted.intentId)
    return persisted
  }

  /** Public HTTP excludes payload. User-bound host adapters may supply validated edits. */
  act(intentId: string, input: AgentDispatchAction & { payload?: Record<string, unknown> }): Promise<AgentDispatchIntent> {
    return this.command(() => this.actNow(intentId, input))
  }

  private async actNow(intentId: string, input: AgentDispatchAction & { payload?: Record<string, unknown> }): Promise<AgentDispatchIntent> {
    this.assertAdmission()
    const requestHash = hash(JSON.stringify(input))
    // Readiness/model checks may take seconds; never hold the canonical store
    // mutex while waiting on them and block unrelated card cancellations.
    const preparedEdit = input.action === 'update'
      ? await this.prepareEdit(intentId, input, requestHash) : undefined
    let changedByAction = false
    const changed = await this.options.store.transaction((file) => {
      const intent = required(file.intents.find((entry) => entry.intentId === intentId))
      const replay = intent.requestLedger[input.requestId]
      if (replay) {
        if (replay !== requestHash) throw new Error('Dispatch request ID was reused with different input')
        return intent
      }
      if (intent.revision !== input.expectedRevision) throw new AgentDispatchConflictError(intent.revision)
      if (terminal.has(intent.state)) throw new Error(`Dispatch is already ${intent.state}`)
      switch (input.action) {
        case 'pause':
          if (!editable.has(intent.state)) throw new Error('Only a pending dispatch can be adjusted')
          intent.state = 'paused'; delete intent.deadline
          break
        case 'update': {
          if (intent.state !== 'paused') throw new Error('Pause dispatch before editing')
          if (!preparedEdit) throw new Error('Dispatch edit was not prepared')
          intent.recommendation = preparedEdit.recommendation; intent.payload = preparedEdit.payload
          this.resetDecision(intent)
          break
        }
        case 'resume':
          if (intent.state !== 'paused') throw new Error('Dispatch is not paused')
          this.resetDecision(intent)
          break
        case 'start_now':
          if (!['pending_confirmation', 'countdown'].includes(intent.state)) {
            throw new Error('Dispatch cannot start before its approval decision')
          }
          intent.state = 'queued'; delete intent.deadline
          intent.decision = { decision: 'allow', reason: 'User requested immediate dispatch', decidedAt: this.nowIso() }
          break
        case 'cancel':
          intent.cancellationRequested = true; delete intent.deadline
          intent.state = active.has(intent.state) || intent.target ? 'stopping' : 'cancelled'
          break
        case 'takeover':
          if (!intent.target || !['queued', 'running', 'awaiting_parent'].includes(intent.state)) {
            throw new Error('Only an admitted task can be taken over')
          }
          if (!this.handler(intent).takeover) throw new Error('This task does not support takeover')
          intent.takenOver = true; delete intent.deadline
          break
      }
      intent.requestLedger[input.requestId] = requestHash
      // Bound replay metadata per card without retaining arbitrary request bodies.
      const requests = Object.keys(intent.requestLedger)
      for (const key of requests.slice(0, Math.max(0, requests.length - 256))) delete intent.requestLedger[key]
      intent.revision += 1; intent.updatedAt = this.nowIso()
      changedByAction = true
      return intent
    })
    if (changed.takenOver && !changed.takeoverApplied) await this.applyTakeover(intentId)
    else if (changedByAction) await this.emit(changed)
    this.launch(intentId)
    return (await this.get(intentId)) ?? changed
  }

  async updateTarget(intentId: string, update: Exclude<AgentDispatchReconciliation, { state: 'absent' | 'resume' }>): Promise<AgentDispatchIntent | null> {
    return this.mutate(intentId, (intent) => {
      if (terminal.has(intent.state)) return false
      // Outcome hooks cannot revive a paused/unapproved card.
      if (!active.has(intent.state) && intent.state !== 'queued') return false
      const next = intent.cancellationRequested && !terminal.has(update.state) ? 'stopping' : update.state
      if (intent.state === next && (!update.target || JSON.stringify(intent.target) === JSON.stringify(update.target)) &&
          (update.error === undefined || intent.error === update.error) &&
          (update.resultSummary === undefined || intent.resultSummary === update.resultSummary)) return false
      intent.state = next
      if (update.target) intent.target = { ...intent.target, ...update.target }
      if (update.error) intent.error = update.error
      if (update.resultSummary) intent.resultSummary = update.resultSummary
      return true
    })
  }

  /** Host-only replacement after the adapter verified settlement and inspected edits. */
  replace(intentId: string, input: {
    recommendation: AgentDispatchRecommendation
    payload: Record<string, unknown>
    reason?: string
    expectedRevision?: number
  }): Promise<AgentDispatchIntent> {
    return this.command(() => this.replaceNow(intentId, input))
  }

  private async replaceNow(intentId: string, input: {
    recommendation: AgentDispatchRecommendation
    payload: Record<string, unknown>
    reason?: string
    expectedRevision?: number
  }): Promise<AgentDispatchIntent> {
    this.assertAdmission()
    const snapshot = required((await this.get(intentId)) ?? undefined)
    const candidate = AgentDispatchIntentSchema.parse({
      ...snapshot, payload: input.payload, recommendation: { ...input.recommendation, agentSelection: 'auto',
        permissionMode: kunToolPermissionModeFromSettings(snapshot.policySnapshot) },
      replacementCount: 1, target: undefined,
      startRequestId: `${intentId}:start:replacement:1`
    })
    await this.handler(candidate).validate(candidate, this.controller.signal)
    const replaced = await this.options.store.transaction((file) => {
      const current = required(file.intents.find((entry) => entry.intentId === intentId))
      if (current.revision !== (input.expectedRevision ?? snapshot.revision)) {
        throw new AgentDispatchConflictError(current.revision)
      }
      if (current.state !== 'failed' || current.recommendation.agentSelection !== 'auto' ||
          current.replacementCount !== 0 || current.cancellationRequested || current.takenOver) {
        throw new Error('Dispatch does not permit another automatic replacement')
      }
      current.previousTarget = current.target
      current.replacementReason = input.reason ?? current.error ?? 'The selected Agent failed after verified settlement'
      current.replacementCount = 1; current.payload = candidate.payload
      current.recommendation = candidate.recommendation; current.startRequestId = candidate.startRequestId
      delete current.target; delete current.resultSummary
      this.resetDecision(current)
      current.revision += 1; current.updatedAt = this.nowIso()
      return current
    })
    await this.emit(replaced); this.launch(intentId)
    return replaced
  }

  async start(): Promise<void> {
    if (this.started) return
    this.assertAdmission(); this.started = true
    const reset = await this.options.store.transaction((file) => {
      const updated: AgentDispatchIntent[] = []
      const batchDeadlines = new Map<string, string>()
      for (const intent of file.intents) {
        if (terminal.has(intent.state)) continue
        if (intent.source.applicationSessionId !== this.options.applicationSessionId) {
          intent.source.applicationSessionId = this.options.applicationSessionId
          if (intent.state === 'countdown') {
            const key = `${intent.source.threadId}:${intent.source.turnId}:${intent.batchId ?? intent.intentId}`
            const deadline = batchDeadlines.get(key) ?? this.deadline()
            batchDeadlines.set(key, deadline); intent.deadline = deadline
          }
          intent.revision += 1; intent.updatedAt = this.nowIso(); updated.push(intent)
        }
        // An interrupted start is unknown until its adapter confirms existing work.
        if (intent.state === 'starting') {
          intent.state = 'uncertain'; intent.revision += 1; intent.updatedAt = this.nowIso(); updated.push(intent)
        }
      }
      return updated
    })
    for (const intent of reset) await this.emit(intent)
    await this.reconcile()
    this.schedule()
  }

  /** Close admission before aborting/draining callbacks. No timer survives app exit. */
  async stop(): Promise<void> {
    this.accepting = false; this.started = false
    if (this.timer) clearTimeout(this.timer)
    this.controller.abort(new Error('Dispatch service is stopping'))
    await Promise.allSettled([...this.inFlight.values(), ...this.takeoverOperations.values(), ...this.commands])
  }

  async reconcile(): Promise<void> {
    if (!this.accepting) return
    const intents = await this.list()
    await Promise.all(intents.filter((intent) => !terminal.has(intent.state) && intent.state !== 'paused' &&
      intent.state !== 'pending_confirmation').map((intent) => this.launch(intent.intentId)))
  }

  private launch(intentId: string): Promise<void> {
    if (!this.accepting || !this.started) return Promise.resolve()
    const existing = this.inFlight.get(intentId)
    if (existing) return existing
    const operation = runWithoutTurnMutationFence(() => this.drive(intentId)).catch((error) => {
      console.warn(`[kun] dispatch reconciliation failed intent=${intentId}: ${message(error)}`)
    }).finally(() => this.inFlight.delete(intentId))
    this.inFlight.set(intentId, operation)
    return operation
  }

  private async drive(intentId: string): Promise<void> {
    let intent = await this.get(intentId)
    if (!intent || !this.accepting || terminal.has(intent.state)) return
    if (intent.takenOver && !intent.takeoverApplied) {
      await this.applyTakeover(intentId)
      intent = await this.get(intentId)
      if (!intent) return
    }
    if (intent.takenOver && !active.has(intent.state) && !intent.target) return
    const handler = this.handlers.get(intent.kind)
    if (!handler) return // Registration completes before lifecycle start.
    if (intent.state === 'countdown') {
      if (!intent.deadline || Date.parse(intent.deadline) > this.now()) return
      intent = await this.mutate(intentId, (current) => {
        if (current.state !== 'countdown' || !current.deadline || Date.parse(current.deadline) > this.now()) return false
        current.state = 'queued'; delete current.deadline
        return true
      })
    }
    if (!intent) return
    if (intent.state === 'reviewing') {
      const revision = intent.revision
      try {
        await handler.validate(intent, this.controller.signal)
        const review = handler.review ?? this.options.review
        const result: ApprovalResolution = review
          ? await review(intent, this.controller.signal)
          : { decision: 'deny', reason: 'Automatic dispatch review is unavailable' }
        if (!this.accepting) return
        intent = await this.mutate(intentId, (current) => {
          if (current.state !== 'reviewing' || current.revision !== revision) return false
          current.decision = {
            decision: result.decision, reason: result.reason || (result.decision === 'allow' ? 'Automatic review allowed dispatch' : 'Automatic review rejected dispatch'),
            decidedAt: this.nowIso()
          }
          current.state = result.decision === 'allow' ? 'queued' : 'failed'
          if (result.decision === 'deny') current.error = current.decision.reason
          return true
        })
      } catch (error) {
        if (!this.accepting) return
        intent = await this.mutate(intentId, (current) => {
          if (current.state !== 'reviewing' || current.revision !== revision) return false
          current.state = 'failed'; current.error = `Automatic dispatch review failed: ${message(error)}`
          current.decision = { decision: 'deny', reason: current.error, decidedAt: this.nowIso() }
          return true
        })
      }
    }
    if (!intent || !this.accepting) return
    if (intent.state === 'uncertain') {
      const reconciled = await handler.reconcile?.(intent, this.controller.signal)
      if (!reconciled) return
      if (reconciled.state === 'absent' || reconciled.state === 'resume') {
        intent = await this.mutate(intentId, (current) => {
          if (current.state !== 'uncertain') return false
          current.state = current.cancellationRequested ? 'cancelled' : 'queued'
          if (reconciled.state === 'resume') delete current.target
          return true
        })
      } else { await this.updateTarget(intentId, reconciled); return }
    }
    if (intent?.state === 'queued' && !intent.target) { await this.admit(intent, handler); return }
    if (intent && (active.has(intent.state) || (intent.state === 'queued' && intent.target))) {
      const revision = intent.revision
      if (intent.cancellationRequested) await handler.cancel?.(intent, this.controller.signal)
      const result = await handler.reconcile?.(intent, this.controller.signal)
      if (result?.state === 'resume') {
        await this.mutate(intentId, (current) => {
          if (current.state !== 'starting' || current.revision !== revision || current.cancellationRequested) return false
          current.state = 'queued'; delete current.target
          return true
        })
      } else if (result?.state === 'absent' && intent.cancellationRequested) {
        await this.updateTarget(intentId, { state: 'cancelled' })
      } else if (result && result.state !== 'absent') await this.updateTarget(intentId, result)
    }
  }

  private async admit(snapshot: AgentDispatchIntent, handler: AgentDispatchHandler): Promise<void> {
    try { await handler.validate(snapshot, this.controller.signal) } catch (error) {
      if (!this.accepting) return
      await this.mutate(snapshot.intentId, (intent) => {
        if (intent.state !== 'queued' || intent.revision !== snapshot.revision) return false
        intent.state = 'failed'; intent.error = `Dispatch admission failed: ${message(error)}`
        return true
      })
      return
    }
    if (!this.accepting) return
    let claimed = false
    const intent = await this.mutate(snapshot.intentId, (current) => {
      if (current.state !== 'queued' || current.revision !== snapshot.revision || current.cancellationRequested) return false
      current.recommendation = AgentDispatchRecommendationSchema.parse(snapshot.recommendation)
      current.state = 'starting'; claimed = true
      return true
    })
    if (!claimed || !intent || !this.accepting) return
    try {
      const target = await handler.start(intent, this.controller.signal)
      const admitted = await this.mutate(intent.intentId, (current) => {
        if (!['starting', 'stopping', 'uncertain'].includes(current.state)) return false
        current.target = { ...current.target, ...target }
        current.state = current.cancellationRequested ? 'stopping' : handler.reconcile ? 'queued' : 'running'
        delete current.error
        return true
      })
      if (admitted?.cancellationRequested && this.accepting) await handler.cancel?.(admitted, this.controller.signal)
      if (admitted && this.accepting && handler.reconcile) {
        const status = await handler.reconcile(admitted, this.controller.signal)
        if (status?.state === 'resume') {
          await this.mutate(intent.intentId, (current) => {
            if (current.revision !== admitted.revision || current.cancellationRequested) return false
            current.state = 'uncertain'
            return true
          })
        } else if (status && status.state !== 'absent') await this.updateTarget(intent.intentId, status)
      }
    } catch (error) {
      // A transport error cannot prove that the scheduler did not accept work.
      // Recovery must query the stable startRequestId before it ever retries.
      await this.mutate(intent.intentId, (current) => {
        if (!['starting', 'stopping'].includes(current.state)) return false
        current.state = 'uncertain'; current.error = `Dispatch startup needs reconciliation: ${message(error)}`
        return true
      })
    }
  }

  private async mutate(intentId: string, change: (intent: AgentDispatchIntent) => boolean): Promise<AgentDispatchIntent | null> {
    let changed = false
    const intent = await this.options.store.transaction((file) => {
      const current = file.intents.find((entry) => entry.intentId === intentId)
      if (!current) return null
      if (change(current)) {
        current.revision += 1; current.updatedAt = this.nowIso(); changed = true
      }
      return current
    })
    if (intent && changed) await this.emit(intent)
    return intent
  }

  private applyTakeover(intentId: string): Promise<void> {
    const existing = this.takeoverOperations.get(intentId)
    if (existing) return existing
    const operation = runWithoutTurnMutationFence(async () => {
      const intent = await this.get(intentId)
      if (!intent?.takenOver || intent.takeoverApplied) return
      const handler = this.handler(intent)
      if (!handler.takeover) throw new Error('This task does not support takeover')
      this.controller.signal.throwIfAborted()
      await handler.takeover(intent, this.controller.signal)
      await this.mutate(intentId, (current) => {
        if (!current.takenOver || current.takeoverApplied) return false
        current.takeoverApplied = true
        return true
      })
    }).finally(() => this.takeoverOperations.delete(intentId))
    this.takeoverOperations.set(intentId, operation)
    return operation
  }

  private async prepareEdit(intentId: string,
    input: AgentDispatchAction & { payload?: Record<string, unknown> }, requestHash: string
  ): Promise<Pick<AgentDispatchIntent, 'recommendation' | 'payload'> | undefined> {
    const intent = required((await this.get(intentId)) ?? undefined)
    const replay = intent.requestLedger[input.requestId]
    if (replay) {
      if (replay !== requestHash) throw new Error('Dispatch request ID was reused with different input')
      return undefined
    }
    if (intent.revision !== input.expectedRevision) throw new AgentDispatchConflictError(intent.revision)
    if (intent.state !== 'paused') throw new Error('Pause dispatch before editing')
    const recommendation = AgentDispatchRecommendationSchema.parse({
      ...intent.recommendation, ...input.recommendation,
      permissionMode: kunToolPermissionModeFromSettings(intent.policySnapshot),
      ...(input.recommendation?.agentId && input.recommendation.agentId !== intent.recommendation.agentId
        ? { agentName: undefined } : {}),
      // Explicit user edits pin the selected route; model retry must not override it.
      ...(input.recommendation?.agentId ? { agentSelection: 'user' } : {})
    })
    const handler = this.handler(intent)
    const payload = handler.updatePayload
      ? await handler.updatePayload(intent, recommendation, input.payload) : input.payload ?? intent.payload
    await handler.validate({ ...intent, recommendation, payload }, this.controller.signal)
    this.controller.signal.throwIfAborted()
    return { recommendation, payload }
  }

  private resetDecision(intent: AgentDispatchIntent): void {
    const mode = kunToolPermissionModeFromSettings(intent.policySnapshot)
    intent.state = stateForMode(mode)
    if (mode === 'full-access') intent.deadline = this.deadline()
    else delete intent.deadline
    delete intent.decision; delete intent.error
  }

  private command<T>(operation: () => Promise<T>): Promise<T> {
    const result = operation().finally(() => this.commands.delete(result))
    this.commands.add(result)
    return result
  }

  private schedule(): void {
    if (!this.started || !this.accepting) return
    this.timer = runWithoutTurnMutationFence(() => setTimeout(() => {
      void this.reconcile().catch((error) => {
        console.warn(`[kun] dispatch timer failed: ${message(error)}`)
      }).finally(() => this.schedule())
    }, 1000))
    this.timer.unref?.()
  }

  private handler(intent: AgentDispatchIntent): AgentDispatchHandler {
    const handler = this.handlers.get(intent.kind)
    if (!handler) throw new Error(`Dispatch handler is unavailable: ${intent.kind}`)
    return handler
  }
  private assertAdmission(): void { if (!this.accepting) throw new Error('Dispatch service is stopping') }
  private nowIso(): string { return new Date(this.now()).toISOString() }
  private deadline(): string { return new Date(this.now() + AGENT_DISPATCH_COUNTDOWN_MS).toISOString() }
  private async emit(intent: AgentDispatchIntent): Promise<void> {
    // Audit delivery failure must never reverse a durable scheduler admission.
    try { await this.options.onUpdated?.(structuredClone(intent)) } catch (error) {
      console.warn(`[kun] dispatch event delivery failed intent=${intent.intentId}: ${message(error)}`)
    }
  }
}

const services = new WeakMap<ThreadStore, AgentDispatchService>()
export function bindAgentDispatchService(threadStore: ThreadStore, service: AgentDispatchService): void {
  services.set(threadStore, service)
}
export function getAgentDispatchService(threadStore: ThreadStore): AgentDispatchService | undefined {
  return services.get(threadStore)
}
export function stableAgentDispatchIntentId(proposal: Pick<AgentDispatchProposal, 'kind' | 'source'>): string {
  return `dispatch_${hash(JSON.stringify([proposal.kind, proposal.source.threadId, proposal.source.turnId, proposal.source.toolCallId])).slice(0, 32)}`
}
function hash(value: string): string { return createHash('sha256').update(value).digest('hex') }
function message(error: unknown): string { return (error instanceof Error ? error.message : String(error)).slice(0, 7000) }
function required<T>(value: T | undefined): T { if (value === undefined) throw new Error('Dispatch intent not found'); return value }
function stateForMode(mode: AgentDispatchRecommendation['permissionMode']): AgentDispatchState {
  return mode === 'full-access' ? 'countdown' : mode === 'approve-for-me' ? 'reviewing' : 'pending_confirmation'
}
