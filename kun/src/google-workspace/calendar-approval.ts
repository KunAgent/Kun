import type { ToolHostContext } from '../ports/tool-host.js'
import type { ValidatedGoogleWorkspaceCall } from './catalog.js'
import type { GoogleWorkspaceToolService } from './google-workspace-tools.js'
import { ToolOperationJournal } from '../reliability/operation-journal.js'

type EventSnapshot = { etag: string; attendees: string[]; organizer?: string; summary: string; start: unknown; end: unknown }
function needsSnapshot(call: ValidatedGoogleWorkspaceCall): boolean {
  return call.method === 'calendar.events.patch' || call.method === 'calendar.events.delete'
}
function eventSnapshot(value: unknown): EventSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Cannot inspect the calendar event before approval')
  const event = value as Record<string, unknown>
  if (typeof event.etag !== 'string' || !event.etag || event.etag.length > 512 || event.attendeesOmitted === true) {
    throw new Error('Calendar event version or complete attendee list is unavailable; inspect it in Google Calendar')
  }
  const organizerData = event.organizer && typeof event.organizer === 'object' ? event.organizer as Record<string, unknown> : {}
  if (event.guestsCanSeeOtherGuests === false && organizerData.self !== true) {
    throw new Error('This calendar hides other guests; edit it in Google Calendar where recipient visibility can be checked')
  }
  const attendees: string[] = []
  if (event.attendees !== undefined && !Array.isArray(event.attendees)) throw new Error('Invalid calendar attendee list')
  for (const item of event.attendees as unknown[] ?? []) {
    const email = item && typeof item === 'object' ? (item as Record<string, unknown>).email : undefined
    if (typeof email !== 'string' || email.length > 254 || !/^[^\s<>@]+@[^\s<>@]+$/.test(email)) throw new Error('An existing calendar attendee cannot be safely shown')
    attendees.push(email)
  }
  if (attendees.length > 100) throw new Error('This event has too many attendees for complete approval; edit it in Google Calendar')
  const organizer = event.organizer && typeof event.organizer === 'object' ? (event.organizer as Record<string, unknown>).email : undefined
  const snapshot = { etag: event.etag, attendees: [...new Set(attendees)].sort(),
    ...(typeof organizer === 'string' && organizer.length <= 254 ? { organizer } : {}),
    summary: typeof event.summary === 'string' ? event.summary : '', start: event.start, end: event.end }
  if (Buffer.byteLength(JSON.stringify(snapshot)) > 24 * 1024) throw new Error('Calendar event preview is too large for complete approval')
  return snapshot
}

/** Existing recipient data is fetched by the host, never accepted from model arguments. */
export function createGoogleWorkspaceCalendarApproval(service: GoogleWorkspaceToolService) {
  const snapshots = new Map<string, { value: EventSnapshot; hash: string; expiresAt: number }>()
  const key = (context: ToolHostContext, callId: string): string => JSON.stringify([context.threadId, context.turnId, callId])
  const hash = (call: ValidatedGoogleWorkspaceCall): string => ToolOperationJournal.argsHash({ method: call.method, params: call.params, body: call.body })
  const read = async (call: ValidatedGoogleWorkspaceCall, context: ToolHostContext): Promise<EventSnapshot> => eventSnapshot(await service.call(
    'calendar.events.get', { calendarId: call.params.calendarId, eventId: call.params.eventId }, undefined, context.abortSignal
  ))
  return {
    async prepare(call: ValidatedGoogleWorkspaceCall, context: ToolHostContext, callId: string): Promise<Record<string, unknown> | undefined> {
      if (!needsSnapshot(call)) return undefined
      for (const [id, snapshot] of snapshots) if (snapshot.expiresAt <= Date.now()) snapshots.delete(id)
      if (snapshots.size >= 128) throw new Error('Too many pending calendar approvals')
      const value = await read(call, context)
      snapshots.set(key(context, callId), { value, hash: hash(call), expiresAt: Date.now() + 120_000 })
      return { existingEvent: { trust: 'untrusted-external-data', ...value },
        concurrencyNotice: 'The event version and recipients will be rechecked before execution. gws does not support an atomic If-Match write, so concurrent changes after that check remain possible.' }
    },
    async verify(call: ValidatedGoogleWorkspaceCall, context: ToolHostContext): Promise<void> {
      if (!needsSnapshot(call)) return
      const id = key(context, context.activeToolCallId ?? '')
      const snapshot = snapshots.get(id)
      snapshots.delete(id)
      if (!snapshot || snapshot.expiresAt <= Date.now() || snapshot.hash !== hash(call)) throw new Error('Calendar action requires a fresh event preview and approval')
      const current = await read(call, context)
      if (JSON.stringify(current) !== JSON.stringify(snapshot.value)) throw new Error('Calendar event or attendees changed. Request a new preview and approval before updating it.')
    }
  }
}
