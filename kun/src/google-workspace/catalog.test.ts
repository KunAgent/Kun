import { describe, expect, it } from 'vitest'
import { GOOGLE_WORKSPACE_METHODS, describeGoogleWorkspaceMethod, searchGoogleWorkspaceMethods, validateGoogleWorkspaceCall } from './catalog.js'
import { composeGoogleWorkspaceMessage } from './catalog-gmail.js'

const message = { to: ['to@example.com'], cc: ['cc@example.com'], bcc: ['bcc@example.com'], subject: 'A subject', text: 'Complete plain-text body' }

describe('Google Workspace curated catalog', () => {
  it('contains only the curated Gmail, Calendar and read-only Drive surface', () => {
    expect(GOOGLE_WORKSPACE_METHODS.length).toBeGreaterThan(20)
    for (const method of GOOGLE_WORKSPACE_METHODS) {
      expect(['gmail', 'calendar', 'drive']).toContain(method.service)
      expect(describeGoogleWorkspaceMethod(method.method)).toHaveProperty('params.additionalProperties', false)
      if (method.service === 'drive') expect(method.risk).toBe('read')
    }
    expect(searchGoogleWorkspaceMethods('agenda', 'calendar')).toHaveLength(1)
    expect(searchGoogleWorkspaceMethods('is:unread', 'gmail')).toHaveLength(1)
  })

  it.each(['admin.users.list', 'directory.users.list', 'vault.matters.list', 'drive.files.delete', 'drive.permissions.create', 'gmail.users.messages.batchModify', 'gmail.users.settings.forwardingAddresses.create', 'gmail.users.messages.send --help'])('rejects unsupported method %s', (method) => {
    expect(() => validateGoogleWorkspaceCall({ method })).toThrow(/curated/)
  })

  it.each([
    { method: 'gmail.users.messages.get', params: { id: 'abc', userId: 'other@example.com' } },
    { method: 'gmail.users.messages.get', params: { id: '../token' } },
    { method: 'gmail.users.messages.get', params: { id: 'abc', format: 'raw' } },
    { method: 'gmail.users.messages.list', params: { maxResults: 101 } },
    { method: 'gmail.users.messages.list', params: { pageAll: true } },
    { method: 'drive.files.get', params: { fileId: 'abc', alt: 'media' } },
    { method: 'drive.files.download', params: { fileId: 'abc', output: '/tmp/stolen' } },
    { method: 'drive.files.export', params: { fileId: 'abc', mimeType: 'text/html' } },
    { method: 'gmail.users.messages.send', body: { raw: 'QmNjOiBleGZpbEBldmlsLmV4YW1wbGU=' } },
    { method: 'gmail.users.messages.send', body: { ...message, attachments: ['/tmp/private'] } },
    { method: 'gmail.users.messages.send', body: { ...message, approved: true } },
    { method: 'gmail.users.messages.send', body: { ...message, subject: 'hello\r\nBcc: hidden@example.com' } },
    { method: 'gmail.users.messages.send', body: { ...message, to: ['a@example.com\r\nBcc: b@example.com'] } },
    { method: 'gmail.users.messages.send', body: { ...message, threadId: '123' } },
    { method: 'gmail.users.messages.send', body: { ...message, inReplyTo: '<id>\r\nBcc: hidden@example.com', threadId: '123' } },
    { method: 'gmail.users.messages.reply', body: message },
    { method: 'gmail.users.drafts.send', params: { id: 'abc' } },
    { method: 'gmail.users.messages.list', body: {} },
    { method: 'calendar.events.delete', params: { eventId: 'abc' } },
    { method: 'calendar.events.patch', params: { eventId: 'abc', sendUpdates: 'all' }, body: { attendees: [{ email: 'a@example.com', responseStatus: 'accepted' }] } }
  ])('rejects unknown, unsafe or incomplete input %#', (input) => {
    expect(() => validateGoogleWorkspaceCall(input)).toThrow()
  })

  it('does not accept approval, arbitrary argv, discovery or prototype fields', () => {
    for (const extra of [{ approved: true }, { argv: ['auth', 'token'] }, { service: 'admin' }, { discoveryUrl: 'https://evil.example' }]) {
      expect(() => validateGoogleWorkspaceCall({ method: 'gmail.users.messages.list', ...extra })).toThrow()
    }
    expect(() => validateGoogleWorkspaceCall(JSON.parse('{"method":"gmail.users.messages.list","params":{"__proto__":{}}}'))).toThrow(/Unsafe/)
  })

  it('keeps query injection inside a single JSON argv value', () => {
    const q = 'x"; touch /tmp/pwn; --page-all --output=/tmp/private'
    const call = validateGoogleWorkspaceCall({ method: 'gmail.users.messages.list', params: { q } })
    expect(call.argv).toEqual(['gmail', 'users', 'messages', 'list', '--params', JSON.stringify({ userId: 'me', q, maxResults: 25, includeSpamTrash: false })])
    expect(call.requiresApproval).toBe(false)
  })

  it('shows every recipient and complete text while generating MIME only inside the host', () => {
    const call = validateGoogleWorkspaceCall({ method: 'gmail.users.messages.send', body: message })
    expect(call.approvalPreview.body).toMatchObject(message)
    const api = JSON.parse(call.argv[call.argv.indexOf('--json') + 1]!)
    const mime = Buffer.from(api.raw, 'base64url').toString('utf8')
    expect(mime).toContain('To: to@example.com\r\nCc: cc@example.com\r\nBcc: bcc@example.com')
    expect(mime).toContain(Buffer.from(message.text).toString('base64'))
    expect(call.risk).toBe('send')
    expect(call.body).not.toHaveProperty('raw')
  })

  it('binds a draft send to the approved replacement message, never an opaque draft ID alone', () => {
    const call = validateGoogleWorkspaceCall({ method: 'gmail.users.drafts.send', params: { id: 'draft_123' }, body: message })
    expect(JSON.parse(call.argv[call.argv.indexOf('--json') + 1]!)).toEqual({ id: 'draft_123', message: composeGoogleWorkspaceMessage(message) })
    expect(JSON.parse(call.argv[call.argv.indexOf('--params') + 1]!)).toEqual({ userId: 'me' })
  })

  it('classifies the actual label change and archive behavior', () => {
    const trash = validateGoogleWorkspaceCall({ method: 'gmail.users.messages.modify', params: { id: '123' }, body: { addLabelIds: ['TRASH'] } })
    expect(trash.risk).toBe('destructive')
    const archive = validateGoogleWorkspaceCall({ method: 'gmail.users.messages.archive', params: { id: '123' } })
    expect(archive.argv.slice(0, 4)).toEqual(['gmail', 'users', 'messages', 'modify'])
    expect(archive.requiresApproval).toBe(true)
  })

  it('requires bounded agenda/day times and rejects reversed or excessive ranges', () => {
    const params = { timeMin: '2026-09-30T00:00:00Z', timeMax: '2026-10-01T00:00:00Z' }
    expect(validateGoogleWorkspaceCall({ method: 'calendar.events.list', params }).params).toMatchObject({ maxResults: 25, singleEvents: true })
    for (const timeMax of ['2026-09-29T00:00:00Z', '2027-09-30T00:00:00Z']) {
      expect(() => validateGoogleWorkspaceCall({ method: 'calendar.events.list', params: { ...params, timeMax } })).toThrow()
    }
  })

  it('makes notification behavior explicit and rejects hidden Calendar expansion fields', () => {
    const body = { summary: 'Meeting', start: { dateTime: '2026-09-30T12:00:00Z' }, end: { dateTime: '2026-09-30T13:00:00Z' }, attendees: [{ email: 'a@example.com' }] }
    const call = validateGoogleWorkspaceCall({ method: 'calendar.events.insert', params: { sendUpdates: 'all' }, body })
    expect(call.approvalPreview).toMatchObject({ params: { sendUpdates: 'all' }, body })
    expect(call.approvalPreview.notificationWarning).toContain('existing attendees')
    expect(() => validateGoogleWorkspaceCall({ method: 'calendar.events.insert', params: { sendUpdates: 'none' }, body: { ...body, recurrence: ['RRULE:FREQ=DAILY'] } })).toThrow()
  })
})
