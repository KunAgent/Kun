import type { RoomStore } from '../rooms/room-store.js'
import type { AgentImConnection } from '../rooms/room-im-connections.js'
import { GmailError } from './ports.js'

/** First-release Gmail conversations cannot be mirrored to external messaging services. */
export async function hasActiveImMirror(store: RoomStore, roomId: string): Promise<boolean> {
  let afterSeq = 0
  for (let page = 0; page < 10; page++) {
    const rows = await store.list<AgentImConnection>('agent_im_connection', { roomId, afterSeq, order: 'asc', limit: 100 })
    if (rows.some((row) => row.value.enabled)) return true
    if (rows.length < 100) return false
    afterSeq = rows.at(-1)!.seq
  }
  throw new GmailError('im_scope_unavailable', 'Kun could not verify this conversation’s messaging connections')
}

export async function assertGmailRoomNotMirrored(store: RoomStore, roomId: string): Promise<void> {
  if (await hasActiveImMirror(store, roomId)) {
    throw new GmailError('gmail_desktop_only', 'Use a separate Kun desktop conversation for Gmail. This conversation is connected to an external messaging service.')
  }
}
