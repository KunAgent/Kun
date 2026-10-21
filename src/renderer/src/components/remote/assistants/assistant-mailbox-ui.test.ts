import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AssistantTaskView } from '@shared/assistant-mailbox'
import { AddAssistantDialog } from './AddAssistantDialog'
import { AssistantTaskRows } from './AssistantTaskRows'
import { JoinRequestCard } from './JoinRequestCard'
import { isOpenAssistantTask, recentlySeen, relativeTime, taskHeadline } from './assistant-mailbox-format'

const task = (status: AssistantTaskView['status'], body = 'Find a dentist near Shibuya\nOpen Saturday'): AssistantTaskView => ({
  id: `task-${status}`, assistantId: 'a1', assistantName: 'My Cue', title: '', body, createdAt: '2026-10-22T00:00:00Z',
  updatedAt: '2026-10-22T00:10:00Z', status, updates: status === 'done' ? [{ status: 'done', body: 'Booked Dr. Sato', at: '2026-10-22T00:10:00Z' }] : []
})

describe('assistant mailbox panel', () => {
  it('shows each task with its latest report and offers cancel only while it is open', () => {
    const html = renderToStaticMarkup(createElement(AssistantTaskRows, {
      tasks: [task('done'), task('working')],
      notes: [{ id: 'n1', assistantId: 'a1', assistantName: 'My Cue', body: 'Need your passport number', at: '2026-10-22T00:20:00Z' }],
      busy: false,
      onCancel: () => {}
    }))
    expect(html).toContain('Find a dentist near Shibuya')
    expect(html).toContain('Booked Dr. Sato')
    expect(html).toContain('Need your passport number')
    expect(html.match(/assistantMailboxCancelTask/g)).toHaveLength(1)
  })

  it('shows the verification code to compare and blocks approval without this computer\'s key', () => {
    const request = { requestId: 'r1', platform: 'linux-x64', agentVersion: '0.2.0', createdAt: '2026-10-22T00:00:00Z', verificationCode: '7KQ2M-X9CHD' }
    const html = renderToStaticMarkup(createElement(JoinRequestCard, { name: 'My Cue', request, busy: false, onApprove: () => {}, onReject: () => {} }))
    expect(html).toContain('7KQ2M-X9CHD')
    expect(html).toContain('assistantMailboxRequestHint')
    expect(html.match(/disabled=""/g)).toBeNull()
    const foreign = renderToStaticMarkup(createElement(JoinRequestCard, { name: 'My Cue', request: { ...request, verificationCode: null }, busy: false, onApprove: () => {}, onReject: () => {} }))
    expect(foreign).toContain('assistantMailboxNoKeyForRequest')
    expect(foreign.match(/disabled=""/g)).toHaveLength(1)
  })

  it('opens the add dialog on the assistant form, not on a prompt', () => {
    const html = renderToStaticMarkup(createElement(AddAssistantDialog, {
      busy: false, error: '', status: null, onCreate: async () => undefined, onApprove: async () => undefined,
      onReject: async () => undefined, onClose: () => {}
    }))
    expect(html).toContain('role="dialog"')
    expect(html.match(/<option/g)).toHaveLength(7)
    expect(html).not.toContain('<textarea')
  })

  it('formats times, headlines and open states', () => {
    const now = Date.parse('2026-10-22T01:00:00Z')
    expect(relativeTime('2026-10-22T00:55:00Z', 'en', now)).toBe('5 minutes ago')
    expect(relativeTime('2026-10-22T01:30:00Z', 'en', now)).toBe('in 30 minutes')
    expect(recentlySeen('2026-10-22T00:30:00Z', now)).toBe(true)
    expect(recentlySeen('2026-10-21T23:00:00Z', now)).toBe(false)
    expect(recentlySeen(null, now)).toBe(false)
    expect(taskHeadline('', 'First line\nsecond')).toBe('First line')
    expect(taskHeadline('Title', 'body')).toBe('Title')
    expect(['sent', 'blocked', 'done', 'cancelled'].map((status) => isOpenAssistantTask(status as AssistantTaskView['status']))).toEqual([true, true, false, false])
  })
})
