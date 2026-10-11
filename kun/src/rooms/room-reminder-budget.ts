import { ROOM_REMINDER_LIMITS, type RoomReminder } from '../contracts/room-reminders.js'
import { RoomStoreConflictError, type RoomStore, type RoomStoreListOptions,
  type RoomStoredDocument } from './room-store.js'

const windowMs = 86400_000
type Budget = { fires: Array<{ id: string; at: string }> }
/** Paginate so a busy room or old reminder history cannot hide active work. */
export async function reminderRows(store: RoomStore, options: RoomStoreListOptions = {}) {
  const result: RoomStoredDocument<RoomReminder>[] = []
  let afterSeq: number | undefined
  for (;;) {
    const page = await store.list<RoomReminder>('room_reminder', { ...options, order: 'asc', limit: 1000, afterSeq })
    result.push(...page)
    if (page.length < 1000) return result
    afterSeq = page.at(-1)!.seq
  }
}
/** Every schedule mutation and fire checks/advances this per-agent CAS guard. */
export async function reminderBudget(store: RoomStore, participantAgentId: string, now: string) {
  const row = await store.get<Budget>('room_reminder_budget', participantAgentId)
  const cutoff = Date.parse(now) - windowMs
  const all = await reminderRows(store, { participantAgentId })
  const fires = new Map((row?.value.fires ?? []).filter((fire) => Date.parse(fire.at) > cutoff).map((fire) => [fire.id, fire]))
  // Seed legacy history, and tolerate older runtimes having written one-offs.
  for (const entry of all) if (entry.value.firedAt && Date.parse(entry.value.firedAt) > cutoff) {
    const id = entry.value.firedRequestId ?? 'reminder-fire:' + entry.id
    fires.set(id, { id, at: entry.value.firedAt })
  }
  const value: Budget = { fires: [...fires.values()].sort((a, b) => a.at.localeCompare(b.at)) }
  const active = all.filter((entry) => ['scheduled', 'paused'].includes(entry.value.status))
  return {
    active, value,
    check: { kind: 'room_reminder_budget' as const, id: participantAgentId, expectedRevision: row?.revision ?? null },
    put: { kind: 'room_reminder_budget' as const, id: participantAgentId, value },
    nextAvailable: value.fires.length >= ROOM_REMINDER_LIMITS.maxFiresPer24h
      ? new Date(Date.parse(value.fires[value.fires.length - ROOM_REMINDER_LIMITS.maxFiresPer24h].at) + windowMs).toISOString()
      : undefined
  }
}
export function assertReminderCapacity(budget: Awaited<ReturnType<typeof reminderBudget>>, candidate: RoomReminder, now: string) {
  const others = budget.active.filter((row) => row.id !== candidate.reminderId)
  if (others.length >= ROOM_REMINDER_LIMITS.maxScheduledPerAgent) throw new RoomStoreConflictError('scheduled reminder limit reached')
  if (candidate.dedupKey && others.some((row) => row.value.dedupKey === candidate.dedupKey)) {
    throw new RoomStoreConflictError('an active reminder already uses this dedupKey')
  }
  if (candidate.status !== 'scheduled') return
  const end = new Date(Date.parse(now) + windowMs).toISOString()
  if (Date.parse(candidate.fireAt) > Date.parse(end)) return
  const upcoming = others.filter((row) => row.value.status === 'scheduled' && Date.parse(row.value.fireAt) <= Date.parse(end)).length
  if (upcoming + budget.value.fires.length >= ROOM_REMINDER_LIMITS.maxFiresPer24h) {
    throw new RoomStoreConflictError('too many reminders firing within a 24 hour window')
  }
}
