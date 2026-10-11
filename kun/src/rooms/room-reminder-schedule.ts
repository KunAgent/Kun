import { ROOM_REMINDER_LIMITS, RoomReminderOptionsSchema, type RoomReminder,
  type RoomReminderOptions } from '../contracts/room-reminders.js'
import { RoomStoreConflictError } from './room-store.js'

const dayMs = 86400_000
function localParts(at: number, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at)
  const get = (key: string) => Number(parts.find((part) => part.type === key)!.value)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') }
}
function localEpoch(at: number, timezone: string) {
  const p = localParts(at, timezone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
}
/** DST gaps skip that date; folds use only the first occurrence of a wall-clock time. */
function wallTime(date: Date, time: string, timezone: string): number | undefined {
  const [hour, minute] = time.split(':').map(Number)
  const wall = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute)
  const candidates = new Set<number>()
  for (const delta of [-dayMs, 0, dayMs]) {
    const probe = wall + delta
    const candidate = wall - (localEpoch(probe, timezone) - probe)
    if (localEpoch(candidate, timezone) === wall) candidates.add(candidate)
  }
  return [...candidates].sort((a, b) => a - b)[0]
}
export function validateReminderOptions(options: RoomReminderOptions): RoomReminderOptions {
  const parsed = RoomReminderOptionsSchema.parse(options)
  if ((parsed.recurrence || parsed.quietHours) && !parsed.timezone) {
    throw new RoomStoreConflictError('an explicit IANA timezone is required for recurrence or quiet hours')
  }
  return { ...parsed, timezone: parsed.timezone ?? 'UTC' }
}
export function nextReminderOccurrence(reminder: Pick<RoomReminder, 'recurrence' | 'timezone' | 'fireAt'>,
  after: string): string | undefined {
  const recurrence = reminder.recurrence
  if (!recurrence) return undefined
  const afterMs = Date.parse(after)
  if (recurrence.kind === 'interval') {
    const base = Date.parse(reminder.fireAt), step = recurrence.everySeconds * 1000
    return new Date(base + Math.max(1, Math.floor((afterMs - base) / step) + 1) * step).toISOString()
  }
  const timezone = reminder.timezone ?? 'UTC'
  const p = localParts(afterMs, timezone)
  for (let offset = 0; offset <= 8; offset++) {
    const date = new Date(Date.UTC(p.year, p.month - 1, p.day + offset))
    if (recurrence.kind === 'weekly' && !recurrence.weekdays.includes(date.getUTCDay())) continue
    const candidate = wallTime(date, recurrence.localTime, timezone)
    if (candidate !== undefined && candidate > afterMs) return new Date(candidate).toISOString()
  }
  throw new RoomStoreConflictError('no valid recurrence time in the next eight days')
}
/** Returns the first non-quiet minute, including through DST and overnight windows. */
export function quietHoursEnd(reminder: Pick<RoomReminder, 'quietHours' | 'timezone'>, now: string): string | undefined {
  if (!reminder.quietHours) return undefined
  const { start, end } = reminder.quietHours
  const quiet = (at: number) => {
    const p = localParts(at, reminder.timezone ?? 'UTC')
    const time = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
    return start < end ? time >= start && time < end : time >= start || time < end
  }
  const nowMs = Date.parse(now)
  if (!quiet(nowMs)) return undefined
  for (let at = Math.floor(nowMs / 60000) * 60000 + 60000; at <= nowMs + 2 * dayMs; at += 60000) {
    if (!quiet(at)) return new Date(at).toISOString()
  }
  throw new RoomStoreConflictError('quiet hours have no available time')
}
export function reminderFireAt(input: { delaySeconds?: number; fireAt?: string } & RoomReminderOptions, now: Date): string {
  if (input.trigger && input.delaySeconds === undefined && input.fireAt === undefined && !input.recurrence) {
    return new Date(now.getTime() + ROOM_REMINDER_LIMITS.minDelaySec * 1000).toISOString()
  }
  const hasDelay = input.delaySeconds !== undefined, hasTime = input.fireAt !== undefined
  if (!hasDelay && !hasTime && input.recurrence) {
    validateReminderOptions({ recurrence: input.recurrence, timezone: input.timezone })
    return nextReminderOccurrence({ ...input, fireAt: now.toISOString() },
      new Date(now.getTime() + ROOM_REMINDER_LIMITS.minDelaySec * 1000 - 1).toISOString())!
  }
  if (hasDelay === hasTime) throw new RoomStoreConflictError('exactly one of delaySeconds or fireAt is required')
  const at = hasDelay ? now.getTime() + input.delaySeconds! * 1000 : Date.parse(input.fireAt!)
  if (!Number.isFinite(at)) throw new RoomStoreConflictError('fireAt must be a valid timestamp')
  const delay = (at - now.getTime()) / 1000
  if (delay < ROOM_REMINDER_LIMITS.minDelaySec) {
    throw new RoomStoreConflictError(`reminders must be at least ${ROOM_REMINDER_LIMITS.minDelaySec} seconds out`)
  }
  if (delay > ROOM_REMINDER_LIMITS.maxDelaySec) throw new RoomStoreConflictError('reminders cannot be scheduled more than 30 days out')
  return new Date(at).toISOString()
}
