import type { ToolHostContext } from '../ports/tool-host.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { Room } from '../contracts/rooms.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import {
  WORKBENCH_LIMITS, type WorkbenchLink, type WorkbenchLinkKind, type WorkbenchRequest
} from '../contracts/workbench-links.js'
import { roomRunId } from '../rooms/room-run-recording.js'
import { roomPeerStoreBinding } from '../rooms/room-peer-tools.js'
import type { RoomStore } from '../rooms/room-store.js'
import { WorkbenchBridge, workbenchBridgeBinding, type WorkbenchAgentScope } from './bridge.js'
import {
  countActiveLinks, countOpenConfirmations, countRunLinks, createWorkbenchLink, workbenchLinkId, updateWorkbenchLink
} from './link-store.js'
import { prepareWorkbenchDispatchRequest, proposeWorkbenchDispatch, usesWorkbenchDispatch } from './dispatch.js'
import { workbenchDispatchCapabilities } from './dispatch-capabilities.js'
import type { WorkbenchCapabilityCeiling } from '../contracts/thread-workbench-origin.js'
import type { RoomRequestState } from '../rooms/room-runtime-types.js'
import { AGENT_SETUP_KICKOFF } from '../agents/agent-setup-prompt.js'

export const advertiseWorkbenchTool = (context: ToolHostContext) =>
  context.roomAgent === true && context.roomStepKind === 'conversation' &&
  (!context.harnessId || context.harnessId === 'kun' || context.managerToolBridgeAvailable === true)

export const workbenchToolMeta = {
  toolKind: 'tool_call' as const, policy: 'auto' as const, sideEffect: 'read-only' as const,
  effects: { network: false, externalWrite: false, processExecution: false, guiAutomation: false }
}
export const workbenchFail = (error: unknown) => ({ isError: true as const,
  output: { error: error instanceof Error ? error.message : String(error) } })

export type WorkbenchToolScope = {
  bridge: WorkbenchBridge
  store: RoomStore
  thread: ThreadRecord
  roomId: string
  memberId: string
  memberLabel: string
  agent: WorkbenchAgentScope
  runId: string
  turnId: string
  requestId?: string
  /** The run answers a fresh user message: the only trigger an `auto` policy may act on. */
  fresh: boolean
  toolCallId: string
  capabilityCeiling: WorkbenchCapabilityCeiling
}

/**
 * Host-derived identity for a workbench tool call. Room, member, agent and run
 * all come from the running turn and its recorded run; model arguments never
 * supply them, and a stale or forged turn is rejected.
 */
export async function workbenchToolScope(threads: ThreadStore, context: ToolHostContext,
  options: { needsToolCall?: boolean } = {}): Promise<WorkbenchToolScope> {
  const bridge = workbenchBridgeBinding(threads), store = roomPeerStoreBinding(threads)
  if (!bridge || !store) throw new Error('the workbench bridge is unavailable')
  const thread = await (threads.getMetadata?.(context.threadId) ?? threads.get(context.threadId))
  const room = thread?.roomContext
  if (!thread || room?.kind !== 'conversation' || !room.participantAgentId) throw new Error('private Agent conversation required')
  const turn = thread.turns.find((item) => item.id === context.turnId)
  if (!turn || turn.status !== 'running' || !turn.clientRequestId) throw new Error('active Agent turn required')
  const harness = turn.harnessId ?? thread.harnessId
  if (harness && harness !== 'kun' && context.managerToolBridgeAvailable !== true) throw new Error('This Agent has no active Kun tool bridge for Code dispatch')
  if (options.needsToolCall && !context.activeToolCallId) throw new Error('tool call identity unavailable')
  const runId = roomRunId(room.roomId, turn.clientRequestId)
  const run = await store.get<RoomRunRecord>('room_run', runId)
  if (!run || run.value.threadId !== thread.id || run.value.turnId !== turn.id || run.value.memberId !== room.memberId) {
    throw new Error('conversation run binding unavailable')
  }
  const roomDoc = await store.get<Room>('room', room.roomId)
  if (!roomDoc || roomDoc.value.archivedAt || roomDoc.value.conversationKind !== 'user_agent') throw new Error('private Agent room unavailable')
  const member = roomDoc.value.members.find((item) => item.id === room.memberId)
  if (!member || !member.enabled || member.removedAt || member.participantAgentId !== room.participantAgentId) {
    throw new Error('the Agent is not active in this room')
  }
  const request = run.value.requestId ? (await store.get<RoomRequestState>('request', run.value.requestId))?.value : undefined
  const trustedRequest = request?.threadId === thread.id && request.turnId === turn.id && request.roomId === room.roomId
  const externalFresh = trustedRequest && !request.privateContinuation && !request.privateReminder && !request.handoffReturnId &&
    request.message.body !== AGENT_SETUP_KICKOFF && !request.cancellationRequested && !['cancelled', 'stopping'].includes(request.status)
  return { bridge, store, thread, roomId: room.roomId, memberId: room.memberId, memberLabel: member.displayName,
    agent: await bridge.agentScope(room.participantAgentId), runId, turnId: turn.id, requestId: run.value.requestId,
    fresh: harness && harness !== 'kun' ? externalFresh : run.value.communicationRequired === true, toolCallId: context.activeToolCallId ?? '',
    capabilityCeiling: workbenchDispatchCapabilities(thread, context, request) }
}

export type WorkbenchCapability = 'code-read' | 'code-write' | 'work-read' | 'work-write'
/** Live policy check; the advertised tool set is only a frozen ceiling. */
export function assertWorkbenchCapability(scope: WorkbenchToolScope, capability: WorkbenchCapability): 'confirm' | 'auto' | 'read' {
  const { code, work } = scope.agent.policy
  if (capability === 'code-read' && code !== 'off') return 'read'
  if (capability === 'code-write' && code !== 'off') return code
  if (capability === 'work-read' && work !== 'off') return 'read'
  if (capability === 'work-write' && (work === 'confirm' || work === 'auto')) return work
  throw new Error(capability.startsWith('code') ? 'Code access is turned off for this Agent' : 'Work access is not enabled for this Agent')
}

/**
 * Shared path for every tool that puts a card in front of the user: idempotent
 * per tool call, bounded per run, and `auto` only starts for fresh user requests.
 */
export async function requestWorkbenchLink(scope: WorkbenchToolScope, input: {
  kind: WorkbenchLinkKind
  surface: WorkbenchLink['surface']
  request: WorkbenchRequest
  mode: 'confirm' | 'auto'
  agentSelection?: 'user' | 'auto'
}) {
  const sourceTurn = scope.thread.turns.find((turn) => turn.id === scope.turnId)
  const clientSurface = sourceTurn?.clientSurface === 'im' || sourceTurn?.imContext === true ? 'im' as const : 'gui' as const
  const origin = { kind: 'tool' as const, clientSurface, runId: scope.runId, toolCallId: scope.toolCallId, turnId: scope.turnId,
    ...(scope.requestId ? { requestId: scope.requestId } : {}), fresh: scope.fresh }
  const existing = await scope.store.get<WorkbenchLink>('workbench_link', workbenchLinkId(origin, scope.roomId))
  if (!existing) {
    if (await countRunLinks(scope.store, scope.roomId, scope.runId) >= WORKBENCH_LIMITS.maxRunLinks) {
      throw new Error('This turn already created the maximum number of tasks. Finish the turn and let the user review them.')
    }
  }
  const dispatch = input.kind === 'code_task' && usesWorkbenchDispatch(input.request) && Boolean(scope.bridge.agentDispatch)
  if (dispatch) input = { ...input, request: existing?.value.request ?? await prepareWorkbenchDispatchRequest(scope, input.request) }
  const auto = !dispatch && input.mode === 'auto' && scope.fresh && !input.request.schedule &&
    !(input.request.execution?.mode === 'goal' && !input.request.execution.goalTokenBudget)
  if (!existing) {
    if (auto && await countActiveLinks(scope.store, scope.roomId, scope.agent.agentId) >= scope.agent.policy.maxActiveTasks) {
      throw new Error(`Too many tasks are already in progress (limit ${scope.agent.policy.maxActiveTasks}). Wait for one to finish.`)
    }
    if (!auto && await countOpenConfirmations(scope.store, scope.roomId) >= WORKBENCH_LIMITS.maxOpenConfirmations) {
      throw new Error('Too many task cards are waiting for the user. Ask the user to review them first.')
    }
  }
  const created = await createWorkbenchLink(scope.store, {
    roomId: scope.roomId, participantAgentId: scope.agent.agentId, memberId: scope.memberId, memberLabel: scope.memberLabel,
    kind: input.kind, surface: input.surface, status: auto ? 'queued' : 'awaiting_confirmation', origin, request: input.request })
  if (dispatch) {
    try {
      const intent = await proposeWorkbenchDispatch(scope, created.link, input.agentSelection)
      return { output: { requested: true, linkId: created.link.id, messageId: created.message.id,
        dispatchIntentId: intent.intentId, status: intent.state,
        instruction: 'The task decision is durably saved and its card is visible. The host handles approval or the full-access countdown. ' +
          'Continue other independent work or finish this turn; the outcome will return to this conversation. Do not treat dispatch as completion.' } }
    } catch (error) {
      await updateWorkbenchLink(scope.store, scope.roomId, created.link.id, () => ({ status: 'failed',
        error: (error instanceof Error ? error.message : String(error)).slice(0, 2000) }))
      throw error
    }
  }
  if (created.link.status === 'queued') scope.bridge.wake()
  return { output: { requested: true, linkId: created.link.id, messageId: created.message.id, status: created.link.status,
    instruction: created.link.status === 'queued'
      ? 'The task started and its card is visible. Finish this turn; you will receive the outcome when it ends.'
      : 'A confirmation card is visible to the user. Finish this turn; nothing runs until they accept it.' } }
}
