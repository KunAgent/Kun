import type { ThreadStore } from '../ports/thread-store.js'
import type { RoomStore } from './room-store.js'

// Shared authority lookup must remain independent of tool definitions and their host.
const bindings = new WeakMap<ThreadStore, RoomStore>()
export function roomPeerStoreBinding(threads: ThreadStore) { return bindings.get(threads) }
export function bindRoomPeerStore(threads: ThreadStore, store: RoomStore) { bindings.set(threads, store) }
