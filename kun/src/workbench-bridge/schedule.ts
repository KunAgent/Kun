import type { WorkbenchLink, WorkbenchSchedule } from '../contracts/workbench-links.js'
import type { WorkbenchBridge } from './bridge.js'
import { createWorkbenchLink, updateWorkbenchLink } from './link-store.js'

export const MISSED_GRACE_MS = 2 * 60 * 60 * 1000
const MIN_LEAD_MS = 60_000
const MAX_LEAD_MS = 30 * 24 * 60 * 60 * 1000

export async function seriesHasLiveChild(bridge: WorkbenchBridge, link: WorkbenchLink): Promise<boolean> {
  for (const id of link.recentRunIds ?? []) {
    const child = await bridge.store.get<WorkbenchLink>('workbench_link', id)
    if (child && ['queued', 'running', 'needs_attention', 'recovery_required'].includes(child.value.status)) return true
  }
  return false
}

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number }
const formatterCache = new Map<string, Intl.DateTimeFormat>()
function formatter(zone: string): Intl.DateTimeFormat {
  let value = formatterCache.get(zone)
  if (!value) {
    value = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit' })
    formatterCache.set(zone, value)
  }
  return value
}
function parts(ms: number, zone: string): LocalParts {
  const fields = Object.fromEntries(formatter(zone).formatToParts(ms).map((part) => [part.type, part.value]))
  return { year: Number(fields.year), month: Number(fields.month), day: Number(fields.day), hour: Number(fields.hour),
    minute: Number(fields.minute), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(fields.weekday) }
}

/** Find the first valid wall-clock occurrence after `after`, including DST gaps and repeated hours. */
export function nextRecurringAt(schedule: Extract<WorkbenchSchedule, { kind: 'recurring' }>, after: number): string | undefined {
  const [hour, minute] = schedule.time.split(':').map(Number)
  const today = parts(after, schedule.timeZone)
  const start = Date.UTC(today.year, today.month - 1, today.day)
  for (let day = 0; day <= 370; day++) {
    const date = new Date(start + day * 86_400_000)
    const weekday = date.getUTCDay()
    if (schedule.every === 'weekday' && (weekday === 0 || weekday === 6)) continue
    if (schedule.every === 'week' && !(schedule.weekdays ?? []).includes(weekday)) continue
    const wall = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute)
    // Offset can change inside this day; try both sides of the transition.
    const offsets = new Set([-12, 0, 12].map((h) => {
      const at = wall + h * 3_600_000
      const local = parts(at, schedule.timeZone)
      return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute) - at
    }))
    const candidates = [...offsets].map((offset) => wall - offset).sort((a, b) => a - b)
    for (const candidate of candidates) {
      const local = parts(candidate, schedule.timeZone)
      if (local.year === date.getUTCFullYear() && local.month === date.getUTCMonth() + 1 &&
        local.day === date.getUTCDate() && local.hour === hour && local.minute === minute) {
        // A repeated fall-back hour still represents one wall-clock run for this date.
        if (candidate > after && (!schedule.endsAt || candidate <= Date.parse(schedule.endsAt))) return new Date(candidate).toISOString()
        break
      }
    }
  }
  return undefined
}

export function firstScheduleAt(schedule: WorkbenchSchedule, now = Date.now()): string {
  // This validates IANA names for both schedule variants.
  formatter(schedule.timeZone)
  if (schedule.kind === 'once') {
    const when = Date.parse(schedule.runAt)
    if (when < now + MIN_LEAD_MS || when > now + MAX_LEAD_MS) throw new Error('Scheduled time must be 1 minute to 30 days from now')
    return schedule.runAt
  }
  if (schedule.every === 'week' && !schedule.weekdays?.length) throw new Error('Choose at least one weekday')
  const next = nextRecurringAt(schedule, now + MIN_LEAD_MS - 1)
  if (!next || Date.parse(next) > now + MAX_LEAD_MS) throw new Error('No run is scheduled in the next 30 days')
  return next
}

async function tickOnce(bridge: WorkbenchBridge, link: WorkbenchLink, now: number): Promise<void> {
  const due = Date.parse(link.scheduledFor ?? '')
  if (!Number.isFinite(due) || due > now) return
  const status = now - due > MISSED_GRACE_MS ? 'missed' : 'queued'
  await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ status, ...(status === 'missed'
    ? { error: 'Kun was not running when this task was scheduled.' } : {}) }))
}

async function tickSeries(bridge: WorkbenchBridge, link: WorkbenchLink, now: number): Promise<void> {
  const schedule = link.request.schedule
  if (schedule?.kind !== 'recurring' || !link.scheduledFor) return
  const due = Date.parse(link.scheduledFor)
  if (due > now) return
  const runCount = link.runCount ?? 0
  if (schedule.maxRuns && runCount >= schedule.maxRuns) {
    await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ status: 'ended', scheduledFor: undefined }))
    return
  }
  // A delayed restart executes only the most recent occurrence within the grace period.
  const latest = nextRecurringAt(schedule, now - MISSED_GRACE_MS - 1)
  const fireAt = latest && Date.parse(latest) <= now ? latest : now - due <= MISSED_GRACE_MS ? link.scheduledFor : undefined
  const next = nextRecurringAt(schedule, now)
  if (await seriesHasLiveChild(bridge, link)) {
    await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ scheduledFor: next, status: next ? 'active' : 'ended' }))
    return
  }
  if (fireAt) {
    const occurrence = runCount + 1
    let member
    try { member = await bridge.agentScope(link.participantAgentId) } catch {
      await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ status: 'ended', scheduledFor: undefined,
        error: 'The Agent is no longer available.' }))
      return
    }
    const child = await createWorkbenchLink(bridge.store, { roomId: link.roomId, participantAgentId: link.participantAgentId,
      memberId: link.memberId, memberLabel: member.name, kind: link.surface === 'code' ? 'code_task' : 'work_task', surface: link.surface,
      status: 'queued', origin: { kind: 'series', seriesId: link.id, occurrence }, seriesId: link.id, occurrence,
      request: { ...link.request, schedule: undefined } })
    await updateWorkbenchLink(bridge.store, link.roomId, link.id, (current) => ({ runCount: occurrence,
      recentRunIds: [child.link.id, ...(current.recentRunIds ?? []).filter((id) => id !== child.link.id)].slice(0, 50),
      scheduledFor: next, status: !next || schedule.maxRuns === occurrence ? 'ended' : 'active' }))
  } else {
    await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ scheduledFor: next, status: next ? 'active' : 'ended' }))
  }
}

/** Returns the next wake, even when there are no running links. */
export async function reconcileSchedules(bridge: WorkbenchBridge, now = Date.now()): Promise<number | undefined> {
  const rows = await bridge.store.list<WorkbenchLink>('workbench_link', { status: ['scheduled', 'active'], limit: 500, order: 'asc' })
  for (const row of rows) {
    try {
      if (row.value.status === 'scheduled') await tickOnce(bridge, row.value, now)
      else if (row.value.kind === 'schedule_series') await tickSeries(bridge, row.value, now)
    } catch (error) {
      console.warn('[kun] workbench schedule:', error instanceof Error ? error.message : String(error))
    }
  }
  const pending = await bridge.store.list<WorkbenchLink>('workbench_link', { status: ['scheduled', 'active'], limit: 500, order: 'asc' })
  return pending.reduce<number | undefined>((min, row) => {
    const at = Date.parse(row.value.scheduledFor ?? '')
    return Number.isFinite(at) ? Math.min(min ?? at, at) : min
  }, undefined)
}
