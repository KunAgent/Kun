import { z } from 'zod'
import type { AgentDispatchIntent, AgentDispatchRecommendation } from '../contracts/agent-dispatch-intents.js'
import { kunToolPermissionModeFromSettings, kunToolPermissionModeSettings } from '../contracts/policy.js'
import type { RoomRequestState } from '../rooms/room-runtime-types.js'
import { WorkbenchRequestSchema, type WorkbenchLink, type WorkbenchRequest } from '../contracts/workbench-links.js'
import type { AgentDispatchService } from '../delegation/agent-dispatch-service.js'
import type { WorkbenchBridge } from './bridge.js'
import type { WorkbenchToolScope } from './tool-scope.js'
import { effectiveDispatchAuthority, sourceDispatchAuthority } from './dispatch-authority.js'
import { requestWorkbenchCancel } from './actions.js'
import { readWorkbenchLink, updateWorkbenchLink } from './link-store.js'
import { executionMode, validateExecution } from './execution.js'
import { replaceFailedWorkbenchDispatch } from './dispatch-replacement.js'
import { pathWithin } from './directory.js'
import { cancelWorkbenchParentReview } from './cancel-parent-review.js'
import { WorkbenchCapabilityCeilingSchema } from '../contracts/thread-workbench-origin.js'
import { narrowWorkbenchCapabilities } from './dispatch-capabilities.js'

const PayloadSchema = z.object({ roomId: z.string().min(1), linkId: z.string().min(1), memberId: z.string().min(1),
  request: WorkbenchRequestSchema, capabilityCeiling: WorkbenchCapabilityCeilingSchema.optional() }).strict()
const pending = ['pending_confirmation', 'reviewing', 'countdown', 'paused']
const rank = { 'ask-for-approval': 0, 'approve-for-me': 1, 'full-access': 2 }

export function usesWorkbenchDispatch(request: WorkbenchRequest): boolean {
  return !request.schedule && !(executionMode(request) === 'goal' && !request.execution?.goalTokenBudget)
}

function recommendationFor(request: WorkbenchRequest, permissionMode: AgentDispatchRecommendation['permissionMode'],
  agentSelection: AgentDispatchRecommendation['agentSelection']): AgentDispatchRecommendation {
  return { title: request.title, task: request.goal || request.title, agentId: request.execution?.model?.harnessId ?? 'kun',
    model: request.execution?.model?.model, workspace: request.workspaceRoot,
    ...(request.acceptance ? { acceptanceCriteria: [request.acceptance] } : {}), permissionMode, agentSelection }
}

/** The initial card shows the target's authority before any process exists. */
export async function prepareWorkbenchDispatchRequest(scope: WorkbenchToolScope, request: WorkbenchRequest): Promise<WorkbenchRequest> {
  const turn = scope.thread.turns.find((entry) => entry.id === scope.turnId)!
  const inherited = sourceDispatchAuthority(scope.thread, turn)
  const roomAuthority = await effectiveDispatchAuthority(scope.bridge, scope.roomId, scope.memberId, inherited)
  const effective = scope.bridge.harnesses?.permissionCeiling(request, roomAuthority) ?? roomAuthority
  return { ...request, execution: { ...request.execution, mode: executionMode(request), permission: kunToolPermissionModeFromSettings(effective) } }
}

async function intentLink(bridge: WorkbenchBridge, intent: AgentDispatchIntent) {
  const payload = PayloadSchema.parse(intent.payload)
  const link = await readWorkbenchLink(bridge.store, payload.roomId, payload.linkId)
  if (link.memberId !== payload.memberId || link.origin.kind !== 'tool' || link.origin.turnId !== intent.source.turnId ||
    link.origin.toolCallId !== intent.source.toolCallId) throw new Error('Dispatch source binding changed')
  return { payload, link }
}

async function authorityFor(bridge: WorkbenchBridge, intent: AgentDispatchIntent) {
  const { payload } = await intentLink(bridge, intent)
  let authority = await effectiveDispatchAuthority(bridge, payload.roomId, payload.memberId, intent.policySnapshot)
  const selected = payload.request.execution?.permission
  if (selected && rank[selected] < rank[kunToolPermissionModeFromSettings(authority)]) {
    authority = await effectiveDispatchAuthority(bridge, payload.roomId, payload.memberId, kunToolPermissionModeSettings(selected))
  }
  return bridge.harnesses?.permissionCeiling(payload.request, authority) ?? authority
}

async function requestFor(bridge: WorkbenchBridge, intent: AgentDispatchIntent): Promise<WorkbenchRequest> {
  const { payload } = await intentLink(bridge, intent)
  const authority = await authorityFor(bridge, intent)
  return validateExecution(bridge, payload.roomId, { ...payload.request, execution: {
    ...payload.request.execution, mode: executionMode(payload.request), permission: kunToolPermissionModeFromSettings(authority)
  } }, true)
}

/** Registers only host operations: the model cannot provide a scheduler or execution authority. */
export function attachWorkbenchDispatch(bridge: WorkbenchBridge, service: AgentDispatchService): void {
  service.registerHandler('workbench', {
    validate: async (intent) => {
      const { payload, link } = await intentLink(bridge, intent)
      if (link.cancelRequested || link.userTookOver || ['cancelled', 'dismissed'].includes(link.status)) {
        throw new Error('The task was cancelled or taken over')
      }
      const source = await bridge.deps.threadStore.getMetadata?.(intent.source.threadId) ??
        await bridge.deps.threadStore.get(intent.source.threadId)
      const turn = source?.turns.find((entry) => entry.id === intent.source.turnId)
      if (!turn || turn.status === 'aborted' || source?.roomContext?.roomId !== payload.roomId ||
        source.roomContext.memberId !== payload.memberId) throw new Error('The initiating conversation is no longer available')
      const scope = await bridge.agentScope(link.participantAgentId)
      if (scope.policy.code === 'off') throw new Error('This Agent is no longer allowed to start Code tasks')
      const root = await bridge.resolveDirectory(payload.request.workspaceRoot ?? '')
      if (!root || (scope.allowedRoots && !scope.allowedRoots.some((limit) => pathWithin(limit, root)))) {
        throw new Error('The Code project is unavailable or outside this Agent\'s allowed directories')
      }
      const request = await requestFor(bridge, intent)
      const capabilities = await narrowWorkbenchCapabilities(bridge, payload.roomId, payload.memberId, payload.capabilityCeiling)
      bridge.harnesses?.assertCapabilityCeiling(request, capabilities)
    },
    updatePayload: async (intent, recommendation, update) => {
      const { payload } = await intentLink(bridge, intent)
      const request = WorkbenchRequestSchema.parse({ ...payload.request, ...(update?.request as object | undefined),
        title: recommendation.title, goal: recommendation.task,
        ...(recommendation.acceptanceCriteria ? { acceptance: recommendation.acceptanceCriteria.join('\n') } : {}) })
      if (!usesWorkbenchDispatch(request)) throw new Error('Scheduling and unlimited goals require their own confirmation card')
      if (recommendation.agentId !== (request.execution?.model?.harnessId ?? 'kun') ||
        recommendation.model !== request.execution?.model?.model || recommendation.workspace !== request.workspaceRoot) {
        throw new Error('The edited Agent, model and workspace must match the task options')
      }
      await validateExecution(bridge, payload.roomId, request, true)
      return { ...payload, request }
    },
    start: async (intent) => {
      const { payload, link } = await intentLink(bridge, intent)
      const request = await requestFor(bridge, intent)
      const authority = await authorityFor(bridge, intent)
      const capabilities = await narrowWorkbenchCapabilities(bridge, payload.roomId, payload.memberId, payload.capabilityCeiling)
      await updateWorkbenchLink(bridge.store, payload.roomId, payload.linkId, (current) => {
        if (current.cancelRequested || current.userTookOver) throw new Error('The task was cancelled or taken over')
        if (current.threadId || current.admissionAttempted || current.status !== 'awaiting_confirmation') return null
        return { status: 'queued', request, dispatchIntentId: intent.intentId, dispatchAuthority: authority,
          dispatchCapabilities: capabilities,
          clientRequestId: intent.startRequestId, confirmedAt: new Date().toISOString() }
      })
      bridge.wake()
      return { taskId: link.id, ...(link.threadId ? { threadId: link.threadId } : {}), ...(link.turnId ? { turnId: link.turnId } : {}) }
    },
    cancel: async (intent) => {
      const { link } = await intentLink(bridge, intent)
      await cancelWorkbenchParentReview(bridge, link)
      if (!['completed', 'failed', 'cancelled', 'dismissed'].includes(link.status)) {
        await requestWorkbenchCancel(bridge, link.roomId, link.id, undefined, true)
      }
    },
    takeover: async (intent) => {
      const { link } = await intentLink(bridge, intent)
      await cancelWorkbenchParentReview(bridge, link)
      await updateWorkbenchLink(bridge.store, link.roomId, link.id, (current) => current.userTookOver ? null : { userTookOver: true })
      bridge.wake()
    },
    reconcile: async (intent) => {
      const { link } = await intentLink(bridge, intent)
      if (intent.takenOver && !link.userTookOver) {
        await cancelWorkbenchParentReview(bridge, link)
        await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ userTookOver: true }))
      }
      const target = { taskId: link.id, ...(link.threadId ? { threadId: link.threadId } : {}), ...(link.turnId ? { turnId: link.turnId } : {}) }
      if (link.cancelRequested) return { state: link.turnId && !['completed', 'failed', 'cancelled'].includes(link.status)
        ? 'stopping' : 'cancelled', target }
      if (link.status === 'awaiting_confirmation') return pending.includes(intent.state) ? null : { state: 'absent' }
      if (link.status === 'queued') return { state: 'queued', target }
      if (link.status === 'running' || link.status === 'needs_attention') return { state: 'running', target }
      if (link.status === 'recovery_required') return null
      if (link.status === 'completed') {
        const review = link.outcomeRequestId ? (await bridge.store.get<RoomRequestState>('request', link.outcomeRequestId))?.value : undefined
        if (review?.status === 'failed') return { state: 'failed', target,
          error: 'The Code task finished, but the parent Agent could not finish its review. Open the conversation to inspect the result.' }
        const awaiting = link.reported === false || Boolean(review && !['completed', 'cancelled'].includes(review.status))
        return { state: awaiting ? 'awaiting_parent' : 'completed', target,
          resultSummary: link.result?.finalExcerpt || link.result?.summary }
      }
      if (link.status === 'failed') return { state: 'failed', target, error: link.error }
      if (link.status === 'dismissed' || link.status === 'cancelled') return { state: 'cancelled', target }
      return null
    }
  })
}

export async function proposeWorkbenchDispatch(scope: WorkbenchToolScope, link: WorkbenchLink,
  selection: AgentDispatchRecommendation['agentSelection'] = 'user'): Promise<AgentDispatchIntent> {
  const service = scope.bridge.agentDispatch
  if (!service) throw new Error('Agent task dispatch is unavailable in this runtime')
  const turn = scope.thread.turns.find((entry) => entry.id === scope.turnId)!
  const authority = sourceDispatchAuthority(scope.thread, turn)
  const request = (await scope.store.get<RoomRequestState>('request', scope.requestId ?? ''))?.value
  const userIntent = (request?.message.body || request?.privateInput || turn.prompt).slice(0, 32_000)
  const harness = link.request.execution?.model?.harnessId
  // Even an automatic proposal cannot replace an Agent explicitly named by the user.
  const pinned = scope.bridge.harnesses?.isUserSelection?.(link.request, userIntent) ||
    Boolean(harness && new RegExp(`\\b${harness.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(userIntent))
  const actingModelRoute = turn.actingModelRoute ?? (turn.model
    ? { model: turn.model, providerId: turn.providerId, accountId: turn.accountId }
    : { model: scope.thread.model, providerId: scope.thread.providerId, accountId: scope.thread.accountId })
  const roomAuthority = await effectiveDispatchAuthority(scope.bridge, link.roomId, link.memberId, authority)
  const targetAuthority = scope.bridge.harnesses?.permissionCeiling(link.request, roomAuthority) ?? roomAuthority
  const intent = await service.propose({ kind: 'workbench', source: { threadId: scope.thread.id, turnId: turn.id,
    toolCallId: scope.toolCallId, actingModelRoute, userIntent },
    policySnapshot: authority,
    recommendation: { ...recommendationFor(link.request, kunToolPermissionModeFromSettings(authority), pinned ? 'user' : selection),
      effectivePermissionMode: kunToolPermissionModeFromSettings(targetAuthority) },
    payload: { roomId: link.roomId, linkId: link.id, memberId: link.memberId, request: link.request, capabilityCeiling: scope.capabilityCeiling } })
  await updateWorkbenchLink(scope.store, link.roomId, link.id, (current) => current.dispatchIntentId === intent.intentId ? null :
    { dispatchIntentId: intent.intentId, dispatchCapabilities: PayloadSchema.parse(intent.payload).capabilityCeiling,
      ...(!current.dispatchAuthority ? { dispatchAuthority: targetAuthority } : {}) })
  scope.bridge.wake()
  return intent
}

/** Public task-option editing keeps the private source envelope frozen. */
export async function updateWorkbenchDispatch(bridge: WorkbenchBridge, link: WorkbenchLink, request: WorkbenchRequest,
  requestId: string): Promise<void> {
  const service = bridge.agentDispatch
  const intent = link.dispatchIntentId && await service?.get(link.dispatchIntentId)
  if (!service || !intent) throw new Error('The dispatch decision is unavailable')
  if (intent.state !== 'paused') throw new Error('Pause the task before changing its options')
  const authority = await effectiveDispatchAuthority(bridge, link.roomId, link.memberId, intent.policySnapshot)
  const effective = bridge.harnesses?.permissionCeiling(request, authority) ?? authority
  const recommendation = { ...recommendationFor(request, kunToolPermissionModeFromSettings(intent.policySnapshot), 'user'),
    effectivePermissionMode: kunToolPermissionModeFromSettings(effective) }
  await service.act(intent.intentId, { action: 'update', expectedRevision: intent.revision, requestId,
    recommendation, payload: { request } })
  await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ request }))
  bridge.wake()
}

/** Review failures stay visible on the same card and use the ordinary outcome queue. */
export async function projectWorkbenchDispatches(bridge: WorkbenchBridge): Promise<boolean> {
  if (!bridge.agentDispatch) return false
  let waiting = false
  const rows = await bridge.store.list<WorkbenchLink>('workbench_link', { status: 'awaiting_confirmation', limit: 200 })
  for (const row of rows) {
    if (!row.value.dispatchIntentId) continue
    const intent = await bridge.agentDispatch.get(row.value.dispatchIntentId)
    if (!intent) continue
    waiting ||= ['reviewing', 'countdown'].includes(intent.state)
    if (intent.state === 'failed' || intent.state === 'cancelled') {
      const failed = intent.state === 'failed'
      const settled = await updateWorkbenchLink(bridge.store, row.value.roomId, row.id, () => ({ status: failed ? 'failed' : 'cancelled',
        ...(!failed ? { cancelRequested: true } : {}),
        ...(failed ? { error: (intent.error || intent.decision?.reason || 'The task was denied').slice(0, 2000), reported: false } : {}) }))
      // A reviewer refusal is final. Only a scheduler/executor failure may
      // select one replacement through the same permission decision.
      if (failed && intent.decision?.decision !== 'deny' && await replaceFailedWorkbenchDispatch(bridge, settled)) continue
      if (failed) bridge.reportPending.add(row.id)
    } else if (intent.state === 'paused' && JSON.stringify(intent.payload.request) !== JSON.stringify(row.value.request)) {
      await updateWorkbenchLink(bridge.store, row.value.roomId, row.id, () => ({ request: WorkbenchRequestSchema.parse(intent.payload.request) }))
    }
  }
  return waiting
}
