import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import { MessageBubble } from './message-timeline-bubbles'
import { FloatingComposerApprovalPanel } from './FloatingComposerApprovalPanel'
import { RoomApprovalCard } from '../rooms/RoomApprovalCard'
import { MobilePendingActions } from '../../mobile/chat/MobilePendingActions'
import { roomApprovalPresentation } from '@shared/room-approval-presentation'
import { buildGoogleWorkspaceApprovalAction, buildGoogleWorkspaceApprovalSummary } from '../../../../../kun/src/google-workspace/approval'

vi.mock('../../store/chat-store', () => ({
  useChatStore: (selector: (state: unknown) => unknown) => selector({ resolveApproval: vi.fn(), interrupt: vi.fn() })
}))
vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } })
}))

const fixtures = [
  {
    name: 'all email recipients and the entire long plain-text body',
    arguments: {
      method: 'gmail.users.messages.send',
      body: { to: ['one@example.com', 'two@example.com', 'three@example.com'], cc: ['copy@example.com'], bcc: ['hidden@example.com'], subject: 'Exact approved subject', text: 'Body begins.\n' + 'Long reviewed content. '.repeat(650) + '\nBODY END MUST BE VISIBLE' }
    },
    expected: ['one@example.com', 'two@example.com', 'three@example.com', 'copy@example.com', 'hidden@example.com', 'Exact approved subject', 'Body begins.', 'BODY END MUST BE VISIBLE', '&quot;bcc&quot;']
  },
  {
    name: 'all calendar fields and notification policy',
    arguments: {
      method: 'calendar.events.insert',
      params: { calendarId: 'primary', sendUpdates: 'all' },
      body: { summary: 'Project review', description: 'Complete event notes', location: 'Room 42', start: { dateTime: '2026-10-01T10:00:00Z', timeZone: 'Etc/UTC' }, end: { dateTime: '2026-10-01T11:00:00Z', timeZone: 'Etc/UTC' }, attendees: [{ email: 'attendee@example.com' }], visibility: 'private' }
    },
    expected: ['sendUpdates', '&quot;all&quot;', 'Project review', 'Complete event notes', 'Room 42', '2026-10-01T10:00:00Z', '2026-10-01T11:00:00Z', 'Etc/UTC', 'attendee@example.com', 'private', 'existing attendees']
  }
]

describe('complete Google Workspace approval presentation', () => {
  it.each(fixtures)('renders $name in composer, rooms, mobile and native-dialog payload', ({ arguments: args, expected }) => {
    const action = buildGoogleWorkspaceApprovalAction({ id: 'call-1', name: 'google_workspace_call', arguments: args } as never, { workspace: '/test' } as never)
    const summary = buildGoogleWorkspaceApprovalSummary(action)
    const block: Extract<ChatBlock, { kind: 'approval' }> = {
      id: 'approval-1', approvalId: 'approval-1', kind: 'approval', status: 'pending',
      toolName: 'google_workspace_call', summary, action
    }
    const room = { id: block.id, toolName: block.toolName!, summary, action }
    const composerHtml = renderToStaticMarkup(createElement(FloatingComposerApprovalPanel, { approvals: [block], t: (key) => key }))
    const compactHtml = renderToStaticMarkup(createElement(FloatingComposerApprovalPanel, { approvals: [block], t: (key) => key, variant: 'compact' }))
    const roomHtml = renderToStaticMarkup(createElement(RoomApprovalCard, { approval: room, onUpdated: async () => undefined }))
    const timelineHtml = renderToStaticMarkup(createElement(MessageBubble, { block }))
    const mobileHtml = renderToStaticMarkup(createElement(MobilePendingActions, { blocks: [block], resolveApproval: vi.fn(), resolveUserInput: vi.fn() }))
    for (const html of [composerHtml, compactHtml, roomHtml, timelineHtml, mobileHtml]) {
      for (const text of expected) expect(html).toContain(text)
    }
    expect(roomApprovalPresentation(room).content).toBe(summary)
    expect(composerHtml).toContain('tabindex="0"')
  })
})
