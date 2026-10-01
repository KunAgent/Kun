import { describe, expect, it, vi } from 'vitest'
import { createGoogleWorkspaceCalendarApproval } from './calendar-approval.js'
import { validateGoogleWorkspaceCall } from './catalog.js'
import type { ToolHostContext } from '../ports/tool-host.js'
const context = { threadId: 't', turnId: 'turn', activeToolCallId: 'call', abortSignal: new AbortController().signal } as ToolHostContext
const deletion = () => validateGoogleWorkspaceCall({ method: 'calendar.events.delete', params: { calendarId: 'primary', eventId: 'event', sendUpdates: 'all' } })
const event = { etag: 'v1', summary: 'Review', start: { date: '2026-09-30' }, end: { date: '2026-10-01' }, attendees: [{ email: 'hidden@example.com' }] }
describe('calendar host approval snapshot', () => {
  it('shows existing attendees and verifies the exact same event before write', async () => {
    const service = { call: vi.fn(async () => event) }
    const approval = createGoogleWorkspaceCalendarApproval(service)
    expect(await approval.prepare(deletion(), context, 'call')).toMatchObject({ existingEvent: { attendees: ['hidden@example.com'], etag: 'v1' } })
    await approval.verify(deletion(), context)
    await expect(approval.verify(deletion(), context)).rejects.toThrow(/fresh event/)
    expect(service.call).toHaveBeenCalledTimes(2)
  })
  it('rejects changed event and a forged/mismatching call', async () => {
    const service = { call: vi.fn().mockResolvedValueOnce(event).mockResolvedValue({ ...event, etag: 'v2' }) }
    const approval = createGoogleWorkspaceCalendarApproval(service)
    await approval.prepare(deletion(), context, 'call')
    await expect(approval.verify(deletion(), context)).rejects.toThrow(/changed/)
    await expect(approval.verify(deletion(), { ...context, activeToolCallId: 'fake' })).rejects.toThrow(/fresh event/)
  })
  it('fails closed for incomplete attendees or unavailable version', async () => {
    for (const value of [{ ...event, guestsCanSeeOtherGuests: false, organizer: { self: false } }, { ...event, attendeesOmitted: true }, { ...event, etag: '' }, { ...event, attendees: [{ email: 'bad\nname' }] }]) {
      const approval = createGoogleWorkspaceCalendarApproval({ call: async () => value })
      await expect(approval.prepare(deletion(), context, 'call')).rejects.toThrow()
    }
  })
})
