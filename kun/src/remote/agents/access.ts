import type { Room, RoomMessage } from '../../contracts/rooms.js'
import type { AgentIdentity } from '../../contracts/agent-identities.js'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import { RemoteNoEffect } from '../requests/rejections.js'
import { cursorScope, readCursor, writeCursor } from '../cursor-codec.js'
export function publicAgent(agent: AgentIdentity) {
  const model = (ref: AgentIdentity['modelRef']) => ref ? { providerId: ref.providerId, model: ref.model } : undefined
  return { id: agent.id, name: agent.name, title: agent.title, instructions: agent.instructions,
    revision: agent.revision, archived: Boolean(agent.archivedAt), createdAt: agent.createdAt, updatedAt: agent.updatedAt,
    ...(agent.modelRef ? { modelRef: model(agent.modelRef) } : {}),
    ...(agent.fastModelRef ? { fastModelRef: model(agent.fastModelRef) } : {}) }
}
export async function requireAgent(rooms: RoomRuntime, id: string) {
  if (!await rooms.deps.store.get('agent_identity', id)) throw new RemoteNoEffect('NOT_FOUND')
  return rooms.agents.get(id)
}
export async function privateAgentSource(rooms: RoomRuntime, agentId: string, roomId: string, messageIds: string[] = [], userOnly = false, historical = false) {
  const row = await rooms.deps.store.get<Room>('room', roomId)
  if (!row || !historical && (row.value.deletedAt || row.value.archivedAt) || row.value.conversationKind !== 'user_agent' ||
    !row.value.members.some((member) => member.participantAgentId === agentId && (historical || member.enabled && !member.removedAt)))
    throw new RemoteNoEffect('INVALID_REQUEST')
  for (const id of messageIds) {
    const message = await rooms.deps.store.get<RoomMessage>('message', id)
    if (!message || message.roomId !== roomId || message.value.status !== 'final' || userOnly && message.value.authorKind !== 'user')
      throw new RemoteNoEffect('INVALID_REQUEST')
  }
  return row.value
}
export function pageInput(method: string, p: { cursor?: string; [key: string]: unknown }) {
  const { cursor: _cursor, limit: _limit, ...filter } = p, scope = cursorScope([method, filter])
  const position = readCursor<{ native?: string }>(p.cursor, scope, {})
  if (position.native !== undefined && (typeof position.native !== 'string' || position.native.length > 2048))
    throw new RemoteNoEffect('INVALID_REQUEST')
  return { scope, native: position.native }
}
export function pageOutput(scope: string, native: string | undefined) {
  return { hasMore: Boolean(native), ...(native ? { nextCursor: writeCursor(scope, { native }) } : {}) }
}
