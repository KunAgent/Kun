import { createHash } from 'node:crypto'
import type { Room } from '../contracts/rooms.js'
import { RoomStoreConflictError, type RoomStore, type RoomStoredDocument } from './room-store.js'

export const interactionFingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const interactionId = (kind: string, ...parts: unknown[]) => kind + '-' + interactionFingerprint(parts).slice(0, 40)
export async function retryRoomInteraction<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) try { return await operation() } catch (error) {
    if (!(error instanceof RoomStoreConflictError) || attempt >= 4) throw error
  }
}
export async function interactionReplay<T>(store: RoomStore, id: string, fingerprint: string): Promise<T | undefined> {
  const replay = await store.getRequest(id)
  if (replay && replay.fingerprint !== fingerprint) throw new RoomStoreConflictError('interaction identity reused with different input')
  return replay?.result as T | undefined
}
export async function interactionRoom(store: RoomStore, roomId: string): Promise<RoomStoredDocument<Room>> {
  const room = await store.get<Room>('room', roomId)
  if (!room) throw new Error('room not found')
  if (room.value.archivedAt) throw new RoomStoreConflictError('room is archived')
  return room
}
