import { z } from 'zod'
import type { ThreadStore } from '../ports/thread-store.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import type { Room } from '../contracts/rooms.js'
import { AgentFeaturesSchema, type AgentIdentity } from '../contracts/agent-identities.js'
import { RoomProposalPayloadSchema } from '../contracts/room-proposals.js'
import type { RoomStore } from './room-store.js'
import { roomRunId } from './room-run-recording.js'
import { assertCurrentPeerActivation, roomPeerStoreBinding } from './room-peer-tools.js'
import { createRoomProposal, type CreateRoomProposal } from './room-proposals.js'
import { agentStableId } from '../agents/agent-identity-service.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import type { LocalTool } from '../adapters/tool/local-tool-host.js'
import { ROOM_AX_TOOL_DESCRIPTIONS } from './room-ax-surfaces.js'

export const PROPOSE_ROOM_ACTION_TOOL_NAME = 'propose_room_action'

const ProposeRoomActionInput = z.object({
  payload: RoomProposalPayloadSchema,
  rationale: z.string().trim().min(1).max(1000)
}).strict()

type ProposalBinding = {
  store: RoomStore
  roomId: string
  memberId: string
  runId: string
  requestId?: string
  rootRequestId?: string
}

async function proposalFeatures(store: RoomStore) {
  return AgentFeaturesSchema.parse((await store.get('agent_features', 'features'))?.value ?? {})
}

/** The run binding is host-derived; model arguments can never supply identity. */
async function conversationBinding(threads: ThreadStore, context: ToolHostContext): Promise<ProposalBinding> {
  const thread = await (threads.getMetadata?.(context.threadId) ?? threads.get(context.threadId))
  const room = thread?.roomContext, store = roomPeerStoreBinding(threads)
  if (!thread || !store || room?.kind !== 'conversation' || !room.participantAgentId) {
    throw new Error('agent conversation scope required')
  }
  const turn = thread.turns.find((item) => item.id === context.turnId)
  if (!turn || turn.status !== 'running' || !turn.clientRequestId) {
    throw new Error('propose_room_action requires the active agent conversation turn')
  }
  const runId = roomRunId(room.roomId, turn.clientRequestId)
  const run = await store.get<RoomRunRecord>('room_run', runId)
  if (!run || run.value.threadId !== thread.id || run.value.turnId !== turn.id || run.value.memberId !== room.memberId) {
    throw new Error('propose_room_action conversation run binding unavailable')
  }
  return { store, roomId: room.roomId, memberId: room.memberId, runId,
    requestId: run.value.requestId, rootRequestId: run.value.rootRequestId }
}

/** Peer activations reuse the shared freshness check; the run id follows the activation receipt. */
async function peerBinding(threads: ThreadStore, context: ToolHostContext): Promise<ProposalBinding> {
  const { room, store, topic, state } = await assertCurrentPeerActivation(threads, context)
  if (room.handoffId) throw new Error('proposals are only available in room discussions')
  return { store, roomId: room.roomId, memberId: room.memberId,
    runId: roomRunId(room.roomId, state.activation.clientRequestId),
    requestId: topic.value.requestId, rootRequestId: room.rootRequestId }
}

/** Legacy discussions bind to the running turn and a request that was not cancelled. */
async function discussionBinding(threads: ThreadStore, context: ToolHostContext): Promise<ProposalBinding> {
  const thread = await (threads.getMetadata?.(context.threadId) ?? threads.get(context.threadId))
  const room = thread?.roomContext, store = roomPeerStoreBinding(threads)
  if (!thread || !store || room?.kind !== 'discussion' || !room.participantAgentId) {
    throw new Error('room discussion scope required')
  }
  const turn = thread.turns.find((item) => item.id === context.turnId)
  if (!turn || turn.status !== 'running' || !turn.clientRequestId) {
    throw new Error('propose_room_action requires the active discussion turn')
  }
  if (room.requestId) {
    const request = await store.get<{ status?: string }>('request', room.requestId)
    if (!request || request.value.status === 'cancelled') throw new Error('the discussion request is no longer active')
  }
  const runId = roomRunId(room.roomId, turn.clientRequestId)
  const run = await store.get<RoomRunRecord>('room_run', runId)
  if (run && (run.value.threadId !== thread.id || run.value.memberId !== room.memberId)) {
    throw new Error('propose_room_action discussion run binding unavailable')
  }
  return { store, roomId: room.roomId, memberId: room.memberId, runId,
    requestId: run?.value.requestId ?? room.requestId, rootRequestId: run?.value.rootRequestId ?? room.rootRequestId }
}

async function assertProposalPayload(store: RoomStore, room: Room, input: CreateRoomProposal['payload']): Promise<void> {
  if (input.kind === 'execution_request') {
    const enabled = new Set(room.members.filter((member) => member.enabled && !member.removedAt).map((member) => member.id))
    if (input.memberIds.some((id) => !enabled.has(id))) throw new Error('proposal members must be enabled room members')
    if (input.repositoryId && !room.repositories.some((repository) => repository.id === input.repositoryId)) {
      throw new Error('proposal repository must belong to this room')
    }
  }
  if (input.kind === 'add_member') {
    const agent = await store.get<AgentIdentity>('agent_identity', input.participantAgentId)
    if (!agent || agent.value.archivedAt) throw new Error('the proposed agent does not exist')
    if (room.members.some((member) => member.participantAgentId === input.participantAgentId && !member.removedAt)) {
      throw new Error('the proposed agent is already a room member')
    }
  }
  if (input.kind === 'create_agent' && !(await proposalFeatures(store)).identities) {
    throw new Error('agent creation is disabled')
  }
}

function memberLabel(room: Room, memberId: string): string {
  return room.members.find((member) => member.id === memberId)?.displayName ?? memberId
}

/**
 * Drafts a structured proposal card. The tool is data-only: it never executes
 * the proposed action. Adoption is an explicit user route, not a tool call.
 */
export function roomProposalTool(threads: ThreadStore): LocalTool {
  return LocalToolHost.defineTool({
    name: PROPOSE_ROOM_ACTION_TOOL_NAME,
    description: ROOM_AX_TOOL_DESCRIPTIONS.propose_room_action,
    toolKind: 'tool_call',
    policy: 'auto',
    sideEffect: 'read-only',
    effects: { network: false, externalWrite: false, processExecution: false, guiAutomation: false },
    shouldAdvertise: (context) => context.roomAgent === true &&
      (context.roomStepKind === 'discussion' || context.roomStepKind === 'conversation'),
    inputSchema: z.toJSONSchema(ProposeRoomActionInput, { unrepresentable: 'any' }) as Record<string, unknown>,
    execute: async (args, context) => {
      try {
        const parsed = ProposeRoomActionInput.safeParse(args)
        if (!parsed.success) return { isError: true, output: { error: 'invalid proposal input', issues: parsed.error.issues } }
        if (!context.activeToolCallId) throw new Error('propose_room_action tool call identity unavailable')
        const scope = context.roomStepKind === 'conversation'
          ? await conversationBinding(threads, context)
          : context.roomStepKind === 'discussion' && context.roomPeer === true
            ? await peerBinding(threads, context)
            : await discussionBinding(threads, context)
        if (!(await proposalFeatures(scope.store)).proposals) throw new Error('room proposals are disabled')
        const roomDoc = await scope.store.get<Room>('room', scope.roomId)
        if (!roomDoc) throw new Error('room not found')
        await assertProposalPayload(scope.store, roomDoc.value, parsed.data.payload)
        const result = await createRoomProposal(scope.store, scope.roomId, {
          clientRequestId: agentStableId('proposal', scope.runId, context.activeToolCallId),
          payload: parsed.data.payload,
          rationale: parsed.data.rationale,
          authorMemberId: scope.memberId,
          authorLabelSnapshot: memberLabel(roomDoc.value, scope.memberId),
          authorAgentId: roomDoc.value.members.find((member) => member.id === scope.memberId)?.participantAgentId,
          originRunId: scope.runId,
          originItemId: context.activeToolCallId,
          rootRequestId: scope.rootRequestId,
          sourceRequestId: scope.requestId
        })
        return { output: { accepted: true, proposalId: result.proposal.proposalId, status: result.proposal.status,
          note: 'Submitted as a draft for the user to confirm. Nothing was executed.' } }
      } catch (error) {
        return { isError: true, output: { error: error instanceof Error ? error.message : String(error) } }
      }
    }
  })
}
