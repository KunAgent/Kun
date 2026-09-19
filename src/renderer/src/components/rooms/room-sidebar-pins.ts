import type { RoomSidebarEntry } from '@shared/rooms-api'
import { roomRequestId, roomsClient, roomsRequest } from './rooms-client'
import type { Room } from '@shared/rooms-api'

export function orderSidebarEntries(entries: RoomSidebarEntry[]) {
  return [...entries].sort((a, b) => Number(b.pinned) - Number(a.pinned) ||
    (b.activitySeq ?? b.latestMessageSeq ?? 0) - (a.activitySeq ?? a.latestMessageSeq ?? 0) ||
    (a.activitySeq === undefined || b.activitySeq === undefined ? 0 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
}
/** One writer per entry; repeated clicks coalesce to the last desired state. */
export class RoomSidebarPins {
  private pending = new Map<string, { entry: RoomSidebarEntry; desired: boolean; confirmed: boolean; room?: Room; saved: boolean }>()
  constructor(private changed: () => void, private refresh: () => void, private failed: (error: string) => void) {}
  project(entries: RoomSidebarEntry[]) {
    return orderSidebarEntries(entries.map((entry) => {
      const change = this.pending.get(entry.id)
      return change ? { ...entry, pinned: change.desired } : entry
    }))
  }
  // Only a query started after save may retire its optimistic projection.
  checkpoint() { return new Map([...this.pending].filter(([, value]) => value.saved)) }
  received(checkpoint: ReturnType<RoomSidebarPins['checkpoint']>) {
    for (const [id, value] of checkpoint) if (this.pending.get(id) === value && value.saved) this.pending.delete(id)
  }
  toggle(entry: RoomSidebarEntry) {
    const old = this.pending.get(entry.id)
    if (old && !old.saved) { old.desired = !old.desired; this.changed(); return }
    const change = { entry, desired: !entry.pinned, confirmed: entry.pinned, saved: false }
    this.pending.set(entry.id, change); this.failed(''); this.changed()
    void this.save(entry.id, change)
  }
  private async save(id: string, change: { entry: RoomSidebarEntry; desired: boolean; confirmed: boolean; room?: Room; saved: boolean }) {
    try {
      change.room = change.entry.roomId ? (await roomsClient.get(change.entry.roomId)).room :
        (await roomsRequest<{ room: Room }>('/v1/agents/' + encodeURIComponent(change.entry.agentId!) + '/conversation', 'POST', {})).room
      do {
        const desired = change.desired
        if (change.room.pinned !== desired) change.room = (await roomsClient.update(change.room, { pinned: desired }, roomRequestId())).room
        change.confirmed = desired
      } while (change.desired !== change.confirmed)
      change.saved = true
    } catch (error) {
      // A failed older operation must never revert another entry or a newer intent.
      if (this.pending.get(id) === change) { change.desired = change.confirmed; change.saved = true }
      this.failed(String(error))
    } finally { this.changed(); this.refresh() }
  }
}
