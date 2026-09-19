import type { AgentIdentity } from '../contracts/agent-identities.js'
import { RoomMessageSchema, SendRoomMessageSchema, type Room, type RoomMessage } from '../contracts/rooms.js'
import { freezeAgentPermissions } from './agent-permission-snapshot.js'
import { AGENT_COLLABORATION_TOOLS } from './agent-handoff-tools.js'
import { COMMIT_AGENT_SETUP_TOOL } from './agent-setup-tools.js'
import { AGENT_SETUP_KICKOFF } from './agent-setup-prompt.js'
import { agentStableId, type AgentIdentityService } from './agent-identity-service.js'
import type { UserInputGate } from '../ports/user-input-gate.js'
import type { TurnService } from '../services/turn-service.js'
import type { RoomService } from '../rooms/room-service.js'
import type { RoomStore } from '../rooms/room-store.js'
import type { RoomRequestState } from '../rooms/room-runtime-types.js'
import { roomFingerprint, roomId } from '../rooms/room-service.js'
import { RoomStoreConflictError } from '../rooms/room-store.js'

export const AGENT_SETUP_ALLOWED_TOOLS = ['user_input', COMMIT_AGENT_SETUP_TOOL] as const
export const AGENT_SETUP_BLOCKED_TOOLS = [
  ...AGENT_COLLABORATION_TOOLS, 'read_room_rules', 'submit_room_plan', 'send_room_message', 'declare_room_checks'
] as const

export function agentSetupPending(agent: Pick<AgentIdentity, 'setup'> | null | undefined): boolean {
  return agent?.setup?.status === 'pending'
}

export function agentSetupConversationPolicy(
  pending: boolean,
  profile: { blockedTools?: string[]; allowedTools?: string[]; toolPolicy?: string } | null | undefined,
  limits: { blockedTools?: string[]; allowedTools?: string[]; skillsEnabled?: boolean } | null | undefined
) {
  const blocked = [...new Set([
    ...(profile?.blockedTools ?? []), ...(limits?.blockedTools ?? []),
    'submit_room_plan', 'send_room_message', 'declare_room_checks',
    ...(pending ? AGENT_SETUP_BLOCKED_TOOLS : [])
  ])]
  if (pending) {
    return { allowed: [...AGENT_SETUP_ALLOWED_TOOLS], blocked, sandboxMode: 'workspace-write' as const, skillsEnabled: false }
  }
  const allowed = profile?.allowedTools && limits?.allowedTools
    ? profile.allowedTools.filter((name) => limits.allowedTools!.includes(name))
    : profile?.allowedTools ?? limits?.allowedTools
  return { allowed, blocked, skillsEnabled: limits?.skillsEnabled !== false }
}

export async function startAgentSetupTurn(input: {
  service: RoomService; store: RoomStore; agents: AgentIdentityService; wake: () => void
  created: { agentId: string; roomId: string }; clientRequestId: string
}): Promise<void> {
  const key = agentStableId('setup-kickoff', input.created.agentId)
  const previous = await input.store.getRequest(key)
  if (previous) return
  const agent = await input.agents.active(input.created.agentId)
  if (!agentSetupPending(agent)) return
  const stored = await input.store.get<Room>('room', input.created.roomId)
  if (!stored) throw new Error('room not found')
  const room = await freezeAgentPermissions(input.agents, await input.agents.freeze({ ...stored.value, revision: stored.revision }))
  const requestId = roomId(), messageId = roomId(), now = new Date().toISOString()
  const body = SendRoomMessageSchema.parse({ clientRequestId: key, body: AGENT_SETUP_KICKOFF })
  const message = RoomMessageSchema.parse({
    id: messageId, roomId: room.id, messageSeq: 1, authorKind: 'system', authorLabelSnapshot: 'Kun',
    body: AGENT_SETUP_KICKOFF, bodyRevision: 0, mentionMemberIds: [], attachmentIds: [], presentationKind: 'setup',
    createdAt: now, status: 'final', rootRequestId: requestId, sourceRequestId: requestId, clientRequestId: key
  })
  const request: RoomRequestState = {
    privateProtocol: 'direct-v1', privateModel: await input.service.directBinding(room),
    id: requestId, roomId: room.id, status: 'pending', rootRequestId: requestId, collaborationProtocol: 'legacy',
    message: body, sourceMessageId: messageId, roomSnapshot: room, threadId: 'room-discussion-' + roomId()
  }
  await input.store.commit({
    requestId: key, fingerprint: roomFingerprint({ agentId: input.created.agentId, clientRequestId: input.clientRequestId }),
    checks: [{ kind: 'room', id: room.id, expectedRevision: room.revision },
      { kind: 'message', id: messageId, expectedRevision: null }, { kind: 'request', id: requestId, expectedRevision: null }],
    puts: [{ kind: 'message', id: messageId, roomId: room.id, value: message },
      { kind: 'request', id: requestId, roomId: room.id, value: request }],
    events: [{ roomId: room.id, kind: 'message.created', payload: { id: messageId } }]
  })
  input.wake()
}

export async function skipAgentSetup(input: {
  agents: AgentIdentityService; store: RoomStore; inputs: UserInputGate; turns: TurnService
  agentId: string; clientRequestId: string; wake: () => void
}): Promise<{ agent: AgentIdentity }> {
  const agent = await input.agents.active(input.agentId)
  if (!agentSetupPending(agent)) return { agent }
  const result = await input.agents.update(agent.id, {
    clientRequestId: input.clientRequestId, expectedRevision: agent.revision,
    setup: { status: 'skipped', startedAt: agent.setup!.startedAt, completedAt: new Date().toISOString() }
  })
  await cancelPendingAgentSetup({ store: input.store, inputs: input.inputs, turns: input.turns, agentId: agent.id })
  input.wake()
  return result
}

export async function cancelPendingAgentSetup(input: {
  store: RoomStore; inputs: UserInputGate; turns: TurnService; agentId: string
}): Promise<void> {
  const roomIdValue = agentStableId('agent-direct', input.agentId)
  const rows = await input.store.list<RoomRequestState>('request', {
    roomId: roomIdValue, status: ['pending', 'running', 'stopping', 'recovery_required'], limit: 50
  })
  for (const row of rows) {
    if (!row.value.privateProtocol) continue
    if (row.value.threadId) {
      for (const pending of input.inputs.pending(row.value.threadId)) {
        input.inputs.resolve(pending.id, { status: 'cancelled' })
      }
      if (row.value.turnId) {
        await input.turns.interruptTurn({ threadId: row.value.threadId, turnId: row.value.turnId }).catch(() => undefined)
      }
    }
    if (['completed', 'failed', 'cancelled'].includes(row.value.status)) continue
    await input.store.commit({
      requestId: agentStableId('setup-cancel', row.id),
      fingerprint: roomFingerprint({ id: row.id, action: 'cancel-setup' }),
      checks: [{ kind: 'request', id: row.id, expectedRevision: row.revision }],
      puts: [{ kind: 'request', id: row.id, roomId: row.roomId, value: { ...row.value, cancellationRequested: true, status: 'stopping' } }],
      events: [{ roomId: row.roomId ?? roomIdValue, kind: 'request.updated', payload: { id: row.id } }]
    })
  }
}

export function isHiddenAgentSetupMessage(message: Pick<RoomMessage, 'presentationKind'>): boolean {
  return message.presentationKind === 'setup'
}
