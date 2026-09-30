import type { Room } from '@shared/rooms-api'

export type RoomSelectionScope = 'all' | 'private' | 'rooms'

export function roomMatchesSelectionScope(room: Pick<Room, 'conversationKind'>, scope: RoomSelectionScope): boolean {
  if (scope === 'all') return true
  const privateChat = room.conversationKind === 'user_agent'
  return scope === 'private' ? privateChat : !privateChat
}

export function roomWorkbenchScopeKey(selectedId: string, room: Room | null): string | null {
  if (!selectedId) return null
  if (!room || room.id !== selectedId) return selectedId
  return JSON.stringify([selectedId, room.conversationKind === 'user_agent'
    ? [room.privateEpoch ?? 0, room.privateWorkspace ?? '']
    : room.repositories.filter((entry) => entry.availability !== 'missing').map((entry) => entry.canonicalRoot)])
}
