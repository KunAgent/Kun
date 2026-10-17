import type { RoomStoreEvent } from '../../rooms/room-store.js'
import type { RemoteAuthority } from '../authorization/scopes.js'
const MESSAGE = new Set(['room.created', 'room.updated', 'room.archived', 'message.created', 'message.updated', 'message.deleted'])
const ID = /^[A-Za-z0-9_-]{1,128}$/
/** A group event is an invalidation hint; snapshots provide only fields the caller may read. */
export function projectRemoteGroupEvent(event: RoomStoreEvent, authority: RemoteAuthority): RoomStoreEvent | null {
  if (!authority.scopes?.includes('groups.read')) return null
  const collaboration = authority.scopes?.includes('collaboration.read') && /^(room_run|request|task)\./.test(event.kind)
  if (!MESSAGE.has(event.kind) && !collaboration) return null
  const source = event.payload && typeof event.payload === 'object' ? event.payload as Record<string, unknown> : {}
  const payload: Record<string, string> = {}
  for (const key of ['id', 'messageId', ...(collaboration ? ['requestId', 'taskId', 'runId'] : [])])
    if (typeof source[key] === 'string' && ID.test(source[key])) payload[key] = source[key]
  return { seq: event.seq, roomId: event.roomId, kind: event.kind, payload, createdAt: event.createdAt }
}
