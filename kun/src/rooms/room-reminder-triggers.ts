import type { RoomReminder } from '../contracts/room-reminders.js'
import type { RoomMessage } from '../contracts/rooms.js'
import type { RoomStore } from './room-store.js'

/** Only committed conversation messages are events; presentations cannot self-trigger. */
export async function checkReminderTrigger(store: RoomStore, reminder: RoomReminder, now: string):
  Promise<{ ready: boolean; cursor?: number }> {
  if (!reminder.trigger) return { ready: true }
  const trigger = reminder.trigger
  let beforeSeq: number | undefined
  let newestSeq = reminder.triggerCursor ?? 0
  for (;;) {
    const page = await store.list<RoomMessage>('message', { roomId: reminder.roomId, order: 'desc', limit: 1000, beforeSeq,
      ...(trigger.kind === 'message' ? { afterSeq: reminder.triggerCursor ?? 0 } : {}) })
    for (const row of page) {
      newestSeq = Math.max(newestSeq, row.seq)
      const message = row.value
      if (message.presentationKind || message.authorKind === 'system' ||
        (message.status && message.status !== 'final')) continue
      if (trigger.kind === 'room_idle') {
        return { ready: Date.parse(now) - Date.parse(message.createdAt) >= trigger.idleSeconds * 1000 }
      }
      const author = trigger.authorKind === 'agent' ? 'member' : 'user'
      if (message.authorKind === author && (!trigger.contains ||
        message.body.toLocaleLowerCase().includes(trigger.contains.toLocaleLowerCase()))) {
        // Coalesce all events already observed into this one wake.
        return { ready: true, cursor: newestSeq }
      }
    }
    if (page.length < 1000) break
    beforeSeq = page.at(-1)!.seq
  }
  return { ready: trigger.kind === 'room_idle' &&
    Date.parse(now) - Date.parse(reminder.createdAt) >= trigger.idleSeconds * 1000 }
}
