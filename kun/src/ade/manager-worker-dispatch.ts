import { replaceFailedWorkerDispatch } from './worker-dispatch-replacement.js'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { ToolHostContext } from '../ports/tool-host.js'
import { publicAgentDispatchIntent, type AgentDispatchIntent } from '../contracts/agent-dispatch-intents.js'
import { ChildSecuritySnapshot } from '../delegation/delegation-runtime-contracts.js'
import type { AgentDispatchReconciliation } from '../delegation/agent-dispatch-service.js'
import { childSecurity } from '../adapters/tool/delegation-tool-context.js'
import { checkHarnessAdmission } from '../harness/harness-admission.js'
import { authorityFromTurn, clampPermission } from './permission-clamp.js'
import { newManagerWorkRefusal } from './new-work-admission.js'
import { resolveManagerWorkerRoute } from './worker-route.js'
import { countRecentWorkerFailures } from './worker-selector.js'
import { WorkerCreateInputSchema, WorkerCreateBatchInputSchema, type WorkerCreateInput } from './manager-worker-inputs.js'
import { rebuildWorkerDispatchContext } from './worker-dispatch-security.js'
import type { ManagerRuntimeDeps, ManagerToolContext } from './manager-runtime-deps.js'
import type { ManagerRuntime, WorkerCreateResult } from './manager-runtime.js'

const SavedItemSchema = z.object({
  input: WorkerCreateInputSchema,
  selection: z.record(z.string(), z.unknown()).optional(),
  profileId: z.string().optional()
})
const PayloadSchema = z.object({
  items: z.array(SavedItemSchema).min(1).max(16),
  security: ChildSecuritySnapshot,
  threadPolicy: z.object({ approvalPolicy: z.string(), sandboxMode: z.string(), approvalReviewer: z.string() }),
  originalTitle: z.string(), originalTask: z.string(),
  originalAgentId: z.string(), originalModel: z.string().optional()
})

export function workerDispatchIds(intent: Pick<AgentDispatchIntent, 'startRequestId' | 'replacementCount'>, index: number) {
  const key = createHash('sha256').update(`${intent.startRequestId}:${intent.replacementCount}:${index}`).digest('hex').slice(0, 24)
  return { workerId: `child_dispatch_${key}`, dispatchId: `dsp_dispatch_${key}` }
}

/** Durable start decisions for ordinary model-initiated Code dispatch. */
export class ManagerWorkerDispatch {
  private readonly replacing = new Set<string>()
  constructor(private readonly deps: ManagerRuntimeDeps, private readonly runtime: ManagerRuntime) {
    deps.agentDispatchService?.registerHandler('worker', {
      validate: (intent, signal) => this.validate(intent, signal),
      ...(deps.reviewDispatch ? { review: deps.reviewDispatch } : {}),
      start: (intent, signal) => this.start(intent, signal),
      cancel: (intent) => this.cancel(intent),
      takeover: (intent) => this.takeover(intent),
      reconcile: (intent) => this.reconcile(intent)
    })
  }

  async create(ctx: ManagerToolContext, raw: unknown, context: ToolHostContext): Promise<WorkerCreateResult> {
    if (!this.deps.agentDispatchService || !context.activeToolCallId) {
      return this.runtime.createWorkerNow(ctx, raw, context)
    }
    const result = await this.propose(ctx, [WorkerCreateInputSchema.parse(raw)], context)
    return result
  }

  async createBatch(ctx: ManagerToolContext, raw: unknown, context: ToolHostContext) {
    const { items } = WorkerCreateBatchInputSchema.parse(raw)
    const result = await this.propose(ctx, items, context)
    return {
      ...result, pending: result.ok ? items.length : 0, requested: items.length, created: 0, failed: result.ok ? 0 : items.length,
      skipped: 0, dispatched: 0, items: items.map((item, index) => ({ index, label: item.label, result }))
    }
  }

  private async resolve(ctx: ManagerToolContext, input: WorkerCreateInput) {
    const isolation = input.workspace?.isolation ?? (input.agent?.harnessId
      ? this.deps.harnessDefaults?.(input.agent.harnessId)?.isolation : undefined) ?? 'worktree'
    const isolated = isolation === 'worktree'
    const resolved = await resolveManagerWorkerRoute(this.deps, ctx, input, isolated,
      (teamId, harnessId) => countRecentWorkerFailures(this.deps, teamId, harnessId))
    if ('error' in resolved) throw new Error(resolved.error)
    const route = resolved.route
    if (isolated && !this.deps.taskWorkspaces) throw new Error('Isolated task workspace service is unavailable.')
    const definition = this.deps.catalog.get(route.harnessId)
    if (!definition || this.deps.catalog.isDisabled(route.harnessId) || !this.deps.catalog.isProfileEnabled(route)) {
      throw new Error('The recommended Agent or credential profile is disabled.')
    }
    const permission = clampPermission(definition, input.permissionMode ??
      this.deps.harnessDefaults?.(route.harnessId)?.permissionMode, ctx.authority)
    const admission = checkHarnessAdmission({
      usage: 'manager-worker', credentialMode: route.credentialMode,
      harness: definition, effective: await this.deps.capabilitiesForRoute(route),
      status: await this.deps.detector.status(route.harnessId),
      workspace: { isolated }, requestedPermissionMode: permission.effective,
      unattended: !ctx.authority.interactive,
      allowUnattendedFullAccess: this.deps.allowUnattendedFullAccess?.() === true
    })
    if (!admission.ok) throw new Error(admission.message)
    return { ...resolved, permission: permission.effective, definition, isolation }
  }

  private async propose(ctx: ManagerToolContext, items: WorkerCreateInput[], context: ToolHostContext): Promise<WorkerCreateResult> {
    const refused = await newManagerWorkRefusal(this.deps, ctx.threadId, ctx.turnId)
    if (refused) return refused
    if (!this.deps.delegation) return { ok: false, refusal: 'admission', userReport: 'The delegation runtime is unavailable.' }
    try {
      const saved: Array<{ input: WorkerCreateInput & { agent: import('../contracts/harness.js').HarnessRoute };
        selection?: import('../contracts/ade.js').WorkerRecord['selection']; profileId?: string;
        definition: import('../contracts/harness.js').HarnessDefinition }> = []
      for (const input of items) {
        const resolved = await this.resolve(ctx, input)
        saved.push({ input: { ...input, agent: resolved.route, permissionMode: resolved.permission,
          workspace: { ...input.workspace, isolation: resolved.isolation } },
          selection: resolved.selection, profileId: resolved.profileId, definition: resolved.definition })
      }
      const first = saved[0]
      const title = items.length === 1 ? first.input.label : items.map((item) => item.label).join(' / ').slice(0, 512)
      const task = items.map((item) => items.length === 1 ? item.task : `${item.label}\n${item.task}`).join('\n\n').slice(0, 128_000)
      const thread = await this.deps.threads.get(ctx.threadId)
      const policySnapshot = {
        approvalPolicy: context.approvalPolicy, sandboxMode: context.sandboxMode ?? 'workspace-write',
        approvalReviewer: context.approvalReviewer ?? 'user'
      } as const
      const intent = await this.deps.agentDispatchService!.propose({
        kind: 'worker',
        source: {
          threadId: ctx.threadId, turnId: ctx.turnId, toolCallId: context.activeToolCallId!,
          ...(context.actingModelRoute ? { actingModelRoute: context.actingModelRoute } : {}),
          ...(context.approvalIntent ? { userIntent: context.approvalIntent.slice(0, 32_000) } : {})
        },
        policySnapshot,
        recommendation: {
          title, task, agentId: first.input.agent.harnessId, agentName: first.definition.displayName,
          model: first.input.agent.model, workspace: ctx.workspace,
          acceptanceCriteria: items.flatMap((item) => item.context?.constraints ?? []),
          permissionMode: ctx.authority.kunPermissionMode,
          effectivePermissionMode: first.definition.permissionModes.find((mode) => mode.id === first.input.permissionMode)?.kunPermissionMode ?? ctx.authority.kunPermissionMode,
          agentSelection: items.some((item, index) => item.agentSelection === 'user' ||
            userNamedAgent(context.approvalIntent, saved[index].input.agent.harnessId, saved[index].definition.displayName)) ? 'user' : 'auto'
        },
        payload: {
          items: saved.map(({ definition: _definition, ...entry }) => entry),
          security: childSecurity(context),
          threadPolicy: { approvalPolicy: thread?.approvalPolicy ?? policySnapshot.approvalPolicy,
            sandboxMode: thread?.sandboxMode ?? policySnapshot.sandboxMode,
            approvalReviewer: thread?.approvalReviewer ?? policySnapshot.approvalReviewer },
          originalTitle: title, originalTask: task, originalAgentId: first.input.agent.harnessId,
          originalModel: first.input.agent.model
        },
        ...(items.length > 1 ? { batchId: `worker_batch_${ctx.turnId}_${context.activeToolCallId}` } : {})
      })
      return {
        ok: !['failed', 'cancelled'].includes(intent.state),
        dispatchIntentId: intent.intentId, dispatchIntent: publicAgentDispatchIntent(intent),
        dispatched: intent.state === 'running',
        ...(intent.target?.workerIds?.[0] ? { workerId: intent.target.workerIds[0] } : {}),
        ...(intent.target?.dispatchIds?.[0] ? { dispatchId: intent.target.dispatchIds[0] } : {}),
        route: first.input.agent,
        userReport: intent.state === 'cancelled' ? 'Dispatch cancelled. No new work will start.'
          : intent.state === 'failed' ? intent.error ?? 'Automatic dispatch review failed.'
          : intent.state === 'pending_confirmation' ? 'Dispatch saved. Waiting for your confirmation.'
          : intent.state === 'countdown' ? 'Dispatch saved. It will start in 60 seconds unless you adjust or cancel it.'
          : intent.state === 'running' ? 'Dispatch started. The parent Agent will receive the result for review.'
          : 'Dispatch saved. Automatic review and task admission are managed by Kun.'
      }
    } catch (error) {
      return { ok: false, refusal: 'admission', userReport: error instanceof Error ? error.message : String(error) }
    }
  }

  private inputs(intent: AgentDispatchIntent): WorkerCreateInput[] {
    const payload = PayloadSchema.parse(intent.payload)
    if (intent.recommendation.workspace !== payload.security.sandboxRoot) {
      throw new Error('The source workspace is frozen; propose a new dispatch to change it.')
    }
    if (payload.items.length > 1) {
      if (intent.recommendation.agentId !== payload.originalAgentId || intent.recommendation.model !== payload.originalModel) {
        throw new Error('Batch Agent routes are fixed; propose a new batch to change the execution Agents.')
      }
      return payload.items.map(({ input }, index) => ({ ...input,
        ...(intent.recommendation.title !== payload.originalTitle ? { label: `${intent.recommendation.title} ${index + 1}`.slice(0, 64) } : {}),
        ...(intent.recommendation.task !== payload.originalTask
          ? { task: `${input.task}\n\nUser adjustment for this dispatch batch:\n${intent.recommendation.task}`.slice(0, 32_000) } : {})
      }))
    }
    const saved = payload.items[0].input
    const changedAgent = intent.recommendation.agentId !== payload.originalAgentId
    return [{ ...saved, label: intent.recommendation.title.slice(0, 64), task: intent.recommendation.task.slice(0, 32_000),
      agent: changedAgent
        ? { harnessId: intent.recommendation.agentId, ...(intent.recommendation.model ? { model: intent.recommendation.model } : {}) }
        : { ...saved.agent, model: intent.recommendation.model ?? saved.agent?.model }
    }]
  }

  private async context(intent: AgentDispatchIntent, signal: AbortSignal) {
    const context = await rebuildWorkerDispatchContext(this.deps, intent, signal)
    const thread = await this.deps.threads.get(context.threadId)
    const turn = await this.deps.turns.getTurn(context.threadId, context.turnId).catch(() => null)
    const authority = authorityFromTurn({
      approvalPolicy: context.approvalPolicy, sandboxMode: context.sandboxMode ?? 'workspace-write',
      approvalReviewer: context.approvalReviewer ?? 'user'
    }, turn ? { ...turn, approvalPolicy: context.approvalPolicy, sandboxMode: context.sandboxMode, approvalReviewer: context.approvalReviewer } : undefined)
    if (!thread) throw new Error('Source task is no longer available.')
    return { context, ctx: { threadId: context.threadId, turnId: context.turnId, workspace: context.workspace,
      authority, signal, awaitApproval: context.awaitApproval } as ManagerToolContext }
  }

  private async validate(intent: AgentDispatchIntent, signal: AbortSignal) {
    const sourceTurn = await this.deps.turns.getTurn(intent.source.threadId, intent.source.turnId).catch(() => null)
    if (sourceTurn?.status === 'aborted') throw new Error('The source turn was stopped; its pending dispatch cannot start.')
    const refused = await newManagerWorkRefusal(this.deps, intent.source.threadId, intent.source.turnId)
    if (refused) throw new Error(refused.userReport)
    const { ctx } = await this.context(intent, signal)
    if (intent.recommendation.workspace !== ctx.workspace) throw new Error('The dispatch workspace cannot differ from its source task.')
    for (const [index, input] of this.inputs(intent).entries()) {
      const resolved = await this.resolve(ctx, input)
      if (index === 0) {
        intent.recommendation.agentName = resolved.definition.displayName
        intent.recommendation.model = resolved.route.model
        intent.recommendation.effectivePermissionMode = resolved.definition.permissionModes
          .find((mode) => mode.id === resolved.permission)?.kunPermissionMode
      }
    }
  }

  private async start(intent: AgentDispatchIntent, signal: AbortSignal) {
    const { ctx, context } = await this.context(intent, signal)
    const inputs = this.inputs(intent)
    const workerIds: string[] = []
    const dispatchIds: string[] = []
    const payload = PayloadSchema.parse(intent.payload)
    for (let index = 0; index < inputs.length; index += 1) {
      const allocation = { ...workerDispatchIds(intent, index), intentId: intent.intentId,
        selection: payload.items[index]?.selection as import('../contracts/ade.js').WorkerRecord['selection'],
        profileId: payload.items[index]?.profileId }
      const current = await this.deps.agentDispatchService?.get(intent.intentId)
      if (current?.cancellationRequested || current?.takenOver || signal.aborted) break
      const result = await this.runtime.createWorkerNow(ctx, inputs[index], context, allocation)
      if (!result.ok || !result.workerId || !result.dispatchId) {
        for (let skipped = index; skipped < inputs.length; skipped += 1) {
          const skippedIds = workerDispatchIds(intent, skipped)
          await this.deps.dispatches.create({ ...skippedIds, teamId: ctx.threadId, parentTurnId: ctx.turnId,
            title: inputs[skipped].label, task: inputs[skipped].task, mode: 'queue', state: 'failed',
            failureReason: skipped === index ? result.userReport : `Skipped after dispatch refusal: ${result.userReport}`,
            createdAt: this.deps.nowIso(), updatedAt: this.deps.nowIso() })
        }
        break
      }
      workerIds.push(result.workerId)
      dispatchIds.push(result.dispatchId)
    }
    return { threadId: ctx.threadId, workerIds, dispatchIds }
  }

  private async cancel(intent: AgentDispatchIntent) {
    const payload = PayloadSchema.parse(intent.payload)
    for (let index = 0; index < payload.items.length; index += 1) {
      const { workerId, dispatchId } = workerDispatchIds(intent, index)
      const dispatch = await this.deps.dispatches.get(intent.source.threadId, dispatchId)
      if (dispatch?.state === 'pending') {
        await this.deps.dispatches.update(intent.source.threadId, dispatchId, { state: 'cancelled' }, { expect: ['pending'] })
      }
      await this.deps.deliverer.stopWorker(workerId)
    }
  }

  private async takeover(intent: AgentDispatchIntent) {
    for (const workerId of intent.target?.workerIds ?? []) {
      await this.runtime.teamControls.takeOverWorker(workerId)
    }
  }

  async cancelPendingSource(threadId: string, turnId: string): Promise<void> {
    const service = this.deps.agentDispatchService
    if (!service) return
    for (const intent of await service.list(threadId)) {
      if (intent.kind !== 'worker' || intent.source.turnId !== turnId ||
          !['pending_confirmation', 'reviewing', 'countdown', 'paused', 'queued', 'starting'].includes(intent.state)) continue
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const current = attempt === 0 ? intent : await service.get(intent.intentId)
        if (!current || current.cancellationRequested || current.takenOver ||
            ['completed', 'failed', 'cancelled'].includes(current.state)) break
        try {
          await service.act(intent.intentId, { action: 'cancel', requestId: `source-abort:${turnId}`,
            expectedRevision: current.revision })
          break
        } catch {
          // A simultaneous host start may claim the next revision; reconcile once with that claim.
        }
      }
    }
  }

  async reportPrelaunchFailure(intentId: string): Promise<void> {
    const intent = await this.deps.agentDispatchService?.get(intentId)
    if (!intent || intent.kind !== 'worker' || intent.state !== 'failed' || intent.target?.workerIds?.length ||
      intent.cancellationRequested || intent.takenOver) return
    const source = await this.deps.threads.get(intent.source.threadId).catch(() => null)
    if (!source || source.status === 'archived' || source.status === 'deleted') return
    const turn = source.turns.find((entry) => entry.id === intent.source.turnId) ??
      await this.deps.turns.getTurn(intent.source.threadId, intent.source.turnId).catch(() => null)
    if (!turn || turn.status === 'aborted') return
    const team = await this.deps.teams.get(intent.source.threadId)
    if (team?.workers.some((worker) => worker.dispatchIntentId === intent.intentId)) return
    await this.deps.teams.ensure(intent.source.threadId)
    await this.deps.notices.enqueue({ noticeId: `${intent.intentId}:failed:${intent.replacementCount}`,
      teamId: intent.source.threadId, workerId: workerDispatchIds(intent, 0).workerId,
      kind: 'dispatch_failed', dispatchIntentId: intent.intentId, parentTurnId: intent.source.turnId,
      title: intent.recommendation.title.slice(0, 240), createdAt: this.deps.nowIso(), attempts: 0,
      detail: (`Inspect dispatch_intent_status with intentId=${intent.intentId}; report the cause without widening permissions. ` +
        `No worker was started. ${intent.error ?? intent.decision?.reason ?? 'Dispatch was rejected.'}`).slice(0, 4000) })
  }

  async refreshForWorker(workerId: string): Promise<void> {
    const service = this.deps.agentDispatchService
    const thread = await this.deps.threads.get(workerId).catch(() => null)
    const teamId = thread?.executionUnit?.kind === 'worker' ? thread.executionUnit.teamId : undefined
    if (!service || !teamId) return
    for (const intent of await service.list(teamId)) {
      if (intent.kind !== 'worker') continue
      const reconciliation = await this.reconcile(intent)
      if (reconciliation && reconciliation.state !== 'absent' && reconciliation.state !== 'resume') await service.updateTarget(intent.intentId, reconciliation)
    }
  }

  async reconcile(intent: AgentDispatchIntent): Promise<AgentDispatchReconciliation | null> {
    const inputs = PayloadSchema.parse(intent.payload).items
    const records = await Promise.all(inputs.map((_item, index) =>
      this.deps.dispatches.get(intent.source.threadId, workerDispatchIds(intent, index).dispatchId)))
    if (!records.some(Boolean)) return { state: 'absent' }
    const live = records.filter((record): record is NonNullable<typeof record> => Boolean(record))
    const target = { threadId: intent.source.threadId, workerIds: live.map((record) => record.workerId), dispatchIds: live.map((record) => record.dispatchId) }
    if (intent.cancellationRequested || intent.takenOver) {
      const busy = await Promise.all(live.map(async (record) => {
        const run = await this.deps.childRuns.get(record.workerId).catch(() => null)
        return await this.deps.deliverer.workerBusy(record.workerId) || run?.status === 'running' || run?.status === 'queued'
      }))
      return { state: intent.cancellationRequested
        ? busy.some(Boolean) ? 'stopping' : 'cancelled'
        : busy.some(Boolean) ? 'running' : 'completed', target }
    }
    if (live.length < inputs.length) return { state: 'resume' }
    if (live.some((record) => record.state === 'uncertain' || record.state === 'delivering')) {
      return { state: 'starting', target }
    }
    const failed = live.find((record) => record.state === 'failed')
    if (failed && live.some((record) => record.state === 'accepted' || record.state === 'pending')) {
      return { state: live.some((record) => record.state === 'accepted') ? 'running' : 'queued', target,
        error: failed.failureReason ?? 'Some assignments could not start; admitted work is still running.' }
    }
    if (failed) {
      if (inputs.length === 1 && !this.replacing.has(intent.intentId)) {
        this.replacing.add(intent.intentId)
        try {
          if (await replaceFailedWorkerDispatch(this.deps, intent, failed, inputs[0].input)) return null
        } finally { this.replacing.delete(intent.intentId) }
      }
      return { state: 'failed', target, error: failed.failureReason ?? 'Worker execution failed.' }
    }
    if (live.every((record) => record.state === 'cancelled')) return { state: 'cancelled', target }
    if (live.every((record) => record.state === 'completed')) {
      const reviewed = live.every((record) => (record.verdict?.status ?? 'pending') !== 'pending')
      return { state: reviewed ? 'completed' : 'awaiting_parent', target,
        resultSummary: live.map((record) => record.resultExcerpt ?? record.title).join('\n').slice(0, 32_000) }
    }
    return { state: live.some((record) => record.state === 'accepted') ? 'running' : 'queued', target }
  }
}

function userNamedAgent(intent: string | undefined, id: string, name: string): boolean {
  if (!intent) return false
  const text = intent.toLowerCase()
  const labels = [id, name].map((value) => value.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return labels.some((label) => new RegExp(`(?:use|using|with|assign to|delegate to|用|使用|调用|派给|交给)\\s*(?:the\\s+)?${label}(?:\\b|$|[\\s，。])`, 'i').test(text))
}
