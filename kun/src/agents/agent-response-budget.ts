import type { RoomRuntimeDeps, RoomRequestState } from '../rooms/room-runtime-types.js'
import type { RoomPeerTopic } from '../rooms/room-peer-types.js'
import type { RoomStoreCommit } from '../rooms/room-store.js'
import { RoomStoreConflictError } from '../rooms/room-store.js'
import { agentStableId } from './agent-identity-service.js'

type Budget = { rootRequestId: string; generation: number; responseCount: number; memberResponses: Record<string, number> }
/** Native peer responses already debit peer_topic. Handoffs debit the same ledger, atomically with admission intent. */
export async function appendAgentResponseBudget(deps: RoomRuntimeDeps, commit: RoomStoreCommit,
  input: { sourceRoomId: string; rootRequestId: string; agentId: string; generation?: number; clientRequestId: string }) {
  const claimId = agentStableId('agent-budget-claim', input.rootRequestId, String(input.generation ?? 0), input.clientRequestId)
  if (await deps.store.get('agent_budget_claim', claimId)) return
  const request = await deps.store.get<RoomRequestState>('request', input.rootRequestId)
  if (!request || request.roomId !== input.sourceRoomId || request.value.cancellationRequested ||
    ['cancelled', 'stopping'].includes(request.value.status)) throw new RoomStoreConflictError('source discussion stopped')
  const topic = await deps.store.get<RoomPeerTopic>('peer_topic', input.rootRequestId)
  const id = topic?.id ?? agentStableId('agent-budget', input.rootRequestId, String(input.generation ?? 0))
  const old = topic ?? await deps.store.get<Budget>('agent_budget', id)
  const budget: Budget = old?.value ?? { rootRequestId: input.rootRequestId, generation: input.generation ?? 0, responseCount: 0, memberResponses: {} }
  if (topic && (topic.value.generation !== input.generation || ['stopped', 'stopping', 'paused'].includes(topic.value.status))) {
    throw new RoomStoreConflictError(topic.value.pauseReason === 'budget_exhausted' ? 'response budget exhausted' : 'source discussion stopped')
  }
  if (budget.responseCount >= 32 || (budget.memberResponses[input.agentId] ?? 0) >= 8) throw new RoomStoreConflictError('response budget exhausted')
  const value = { ...budget, responseCount: budget.responseCount + 1,
    memberResponses: { ...budget.memberResponses, [input.agentId]: (budget.memberResponses[input.agentId] ?? 0) + 1 },
    ...(topic ? { status: budget.responseCount + 1 >= 32 ? 'paused' : topic.value.status,
      ...(budget.responseCount + 1 >= 32 ? { pauseReason: 'budget_exhausted' } : {}) } : {}) }
  commit.checks ??= []; commit.puts ??= []; commit.events ??= []
  commit.checks.push({ kind: topic ? 'peer_topic' : 'agent_budget', id, expectedRevision: old?.revision ?? null },
    { kind: 'request', id: request.id, expectedRevision: request.revision },
    { kind: 'agent_budget_claim', id: claimId, expectedRevision: null })
  commit.puts.push({ kind: topic ? 'peer_topic' : 'agent_budget', id, roomId: input.sourceRoomId, value },
    { kind: 'agent_budget_claim', id: claimId, roomId: input.sourceRoomId,
      value: { rootRequestId: input.rootRequestId, participantAgentId: input.agentId, generation: input.generation ?? 0 } })
  commit.events.push({ roomId: input.sourceRoomId, kind: 'peer.topic.updated', payload: { rootRequestId: input.rootRequestId } })
}
