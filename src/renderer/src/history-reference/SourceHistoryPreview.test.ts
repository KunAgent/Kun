import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SourceHistoryPreview } from './SourceHistoryPreview'
import type { HistoryPage } from './history-reference-api'

const views = vi.hoisted(() => ({ calls: [] as any[] }))
vi.mock('react-i18next', () => ({ initReactI18next: { type: '3rdParty', init: vi.fn() }, useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../components/chat/message-timeline-conversation-turn', () => ({
  ConversationTurn: (props: any) => { views.calls.push(props); return createElement('p', null, props.turn.user?.text) }
}))
vi.mock('./SourceHistoryAttachments', () => ({ SourceHistoryAttachments: () => null }))

it('renders old messages with native cards while disabling every continuation action', () => {
  views.calls.length = 0
  const page: HistoryPage = { hasMore: true, status: 'available', warnings: [], turns: [{
    id: 'codex:s:t', threadId: 'preview', prompt: 'old', status: 'completed', createdAt: '2026-01-01',
    items: [{ id: 'codex:s:i', turnId: 'codex:s:t', threadId: 'preview', role: 'user', kind: 'user_message', status: 'completed', createdAt: '2026-01-01', text: 'Old prompt' }]
  }] }
  const html = renderToStaticMarkup(createElement(SourceHistoryPreview, { page, workspace: '/project', loading: false, onMore: vi.fn() }))
  expect(html).toContain('Old prompt')
  expect(html).toContain('codexHistoryMore')
  expect(views.calls[0]).toMatchObject({ isProcessing: false, allowMainThreadActions: false, allowRecoveryContinue: false, live: '', liveReasoning: '' })
  expect(views.calls[0].onCancelToolCall).toBeUndefined()
})
