import type { AgentIdentity, Room, RoomAvatarReference, RoomMember, RoomSidebarEntry } from '@shared/rooms-api'
import { agentPath } from './agent-client'
import { roomRequestId, roomsClient, roomsRequest } from './rooms-client'

/**
 * What a destructive conversation action removes. Every removal is recoverable
 * from Recently deleted: rooms are soft-deleted and Agents are archived.
 */
export type ConversationRemoval = 'conversation' | 'group' | 'agent'

/** The identity a removal dialog presents, built from a sidebar row or an open room. */
export type ConversationRemovalTarget = {
  roomId: string
  name: string
  kind: RoomSidebarEntry['kind']
  agentId?: string
  avatar?: RoomAvatarReference
  members: RoomMember[]
}

export function removalTargetFromEntry(entry: RoomSidebarEntry): ConversationRemovalTarget | null {
  if (!entry.roomId) return null
  return { roomId: entry.roomId, name: entry.name, kind: entry.kind,
    agentId: entry.kind === 'user_agent' ? entry.agentId : undefined, avatar: entry.avatar, members: entry.members }
}

export function removalTargetFromRoom(room: Room): ConversationRemovalTarget {
  const kind = room.conversationKind ?? 'group'
  const member = kind === 'user_agent' ? room.members[0] : undefined
  return { roomId: room.id, name: member?.displayName ?? room.name, kind,
    agentId: member?.participantAgentId, avatar: member ? member.avatar : room.avatar,
    members: room.members.filter((item) => !item.removedAt) }
}

/** Removals the target supports, in menu order. Agent pair transcripts are read-only history. */
export function removalsFor(target: Pick<ConversationRemovalTarget, 'kind' | 'agentId'>): ConversationRemoval[] {
  if (target.kind === 'group') return ['group']
  if (target.kind === 'user_agent') return target.agentId ? ['conversation', 'agent'] : ['conversation']
  return []
}

async function setRoomDeleted(roomId: string, deleted: boolean): Promise<void> {
  const { room } = await roomsClient.get(roomId)
  if (Boolean(room.deletedAt) === deleted) return
  await roomsClient.update(room, { deleted })
}

async function setAgentArchived(agentId: string, archived: boolean): Promise<void> {
  const { agent } = await roomsRequest<{ agent: AgentIdentity }>(agentPath(agentId))
  if (Boolean(agent.archivedAt) === archived) return
  await roomsRequest(agentPath(agentId), 'PATCH', { clientRequestId: roomRequestId(), expectedRevision: agent.revision, archived })
}

/**
 * The conversation goes first: the runtime refuses to delete one with active
 * work, which leaves the Agent untouched. If archiving the Agent then fails,
 * the conversation is restored so the two never drift apart.
 */
export async function removeConversation(target: ConversationRemovalTarget, removal: ConversationRemoval): Promise<void> {
  await setRoomDeleted(target.roomId, true)
  if (removal !== 'agent' || !target.agentId) return
  try {
    await setAgentArchived(target.agentId, true)
  } catch (cause) {
    await setRoomDeleted(target.roomId, false).catch(() => undefined)
    throw cause
  }
}

/** A deleted Agent is restored before its private chat so the chat accepts messages again. */
export async function restoreConversation(entry: Pick<RoomSidebarEntry, 'roomId' | 'agentId' | 'agentArchived'>): Promise<void> {
  if (!entry.roomId) throw new Error('Conversation not found')
  if (entry.agentId && entry.agentArchived) await setAgentArchived(entry.agentId, false)
  await setRoomDeleted(entry.roomId, false)
}

/** Runtime conflicts that users can resolve get product copy; anything else keeps its detail. */
export function conversationRemovalError(cause: unknown, t: (key: string) => string): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  if (message.includes('stop or reconcile active work')) return t('roomsDeleteActiveWork')
  return message
}
