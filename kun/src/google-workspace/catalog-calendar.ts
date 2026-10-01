import { z } from 'zod'
import { email, headerText, id, pageToken, query, scopes, textBody, timestamp, type GoogleWorkspaceMethod } from './catalog-types.js'

const calendarId = z.string().min(1).max(256).regex(/^[a-zA-Z0-9_@.-]+$/).default('primary')
const calendar = { calendarId }
const event = { ...calendar, eventId: id }
const time = z.union([
  z.object({ date: z.iso.date() }).strict(),
  z.object({ dateTime: timestamp, timeZone: z.string().min(1).max(128).regex(/^[A-Za-z_+\-/0-9]+$/).optional() }).strict()
])
const eventShape = {
  summary: headerText,
  description: textBody.optional(),
  location: headerText.optional(),
  start: time,
  end: time,
  attendees: z.array(z.object({ email }).strict()).max(12).optional(),
  transparency: z.enum(['opaque', 'transparent']).optional(),
  visibility: z.enum(['default', 'public', 'private']).optional()
}
const dateValue = (value: z.infer<typeof time>): string => 'date' in value ? value.date : value.dateTime
const createBody = z.object(eventShape).strict().superRefine((body, ctx) => {
  if (('date' in body.start) !== ('date' in body.end)) ctx.addIssue({ code: 'custom', message: 'start and end must both be dates or both timestamps' })
  if (Date.parse(dateValue(body.end)) <= Date.parse(dateValue(body.start))) ctx.addIssue({ code: 'custom', message: 'end must be later than start' })
})
const updateBody = z.object(eventShape).partial().strict().superRefine((body, ctx) => {
  if (Object.keys(body).length === 0) ctx.addIssue({ code: 'custom', message: 'At least one update field is required' })
  if (Boolean(body.start) !== Boolean(body.end)) ctx.addIssue({ code: 'custom', message: 'Update start and end together' })
  if (body.start && body.end && (('date' in body.start) !== ('date' in body.end) || Date.parse(dateValue(body.end)) <= Date.parse(dateValue(body.start)))) {
    ctx.addIssue({ code: 'custom', message: 'start and end must match and end must be later' })
  }
})

export const calendarMethods: GoogleWorkspaceMethod[] = [
  {
    method: 'calendar.events.list', description: 'Read agenda, search events or inspect a day using explicit timeMin/timeMax (maximum 93 days), optional q, and one bounded page.',
    service: 'calendar', risk: 'read', scopes: scopes.calendarRead,
    params: z.object({
      ...calendar, timeMin: timestamp, timeMax: timestamp, q: query.optional(),
      maxResults: z.number().int().min(1).max(100).default(25), pageToken: pageToken.optional(),
      singleEvents: z.literal(true).default(true), orderBy: z.literal('startTime').default('startTime'),
      showDeleted: z.literal(false).default(false)
    }).strict().refine((p) => Date.parse(p.timeMax) > Date.parse(p.timeMin) && Date.parse(p.timeMax) - Date.parse(p.timeMin) <= 93 * 86400_000, 'Use a positive time range no longer than 93 days')
  },
  { method: 'calendar.events.get', description: 'Read one calendar event.', service: 'calendar', risk: 'read', scopes: scopes.calendarRead, params: z.object(event).strict() },
  {
    method: 'calendar.events.insert', description: 'Create a calendar event after confirmation. Explicit sendUpdates, every attendee, location and body are shown. Recurrence and attachments are not supported.',
    service: 'calendar', risk: 'write', scopes: scopes.calendarWrite,
    params: z.object({ ...calendar, sendUpdates: z.enum(['all', 'externalOnly', 'none']) }).strict(), body: createBody
  },
  {
    method: 'calendar.events.patch', description: 'Update explicitly provided calendar fields after confirmation. Explicit sendUpdates may notify existing attendees even when attendees is omitted.',
    service: 'calendar', risk: 'write', scopes: scopes.calendarWrite,
    params: z.object({ ...event, sendUpdates: z.enum(['all', 'externalOnly', 'none']) }).strict(), body: updateBody
  },
  {
    method: 'calendar.events.delete', description: 'Delete a calendar event after explicit human confirmation. sendUpdates may notify existing attendees.',
    service: 'calendar', risk: 'destructive', scopes: scopes.calendarWrite,
    params: z.object({ ...event, sendUpdates: z.enum(['all', 'externalOnly', 'none']) }).strict()
  }
]
