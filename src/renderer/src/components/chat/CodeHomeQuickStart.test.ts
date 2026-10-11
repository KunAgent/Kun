// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../../agent/types'
import type { RoomSidebarEntry } from '@shared/rooms-api'
import i18n from '../../i18n'
import { useChatStore } from '../../store/chat-store'
import { publishLatestPrivateConversation, useLatestPrivateConversation } from '../rooms/room-activity-counts'
import { CodeHomeQuickStart, continueTaskCandidate } from './CodeHomeQuickStart'

const mocks = vi.hoisted(() => ({ openRoom: vi.fn(), openDialog: vi.fn() }))
vi.mock('../rooms/agent-chat-navigation', () => ({ openAgentConversationRoom: mocks.openRoom }))
vi.mock('../rooms/agent-chat-picker', () => ({ openAgentChatDialog: mocks.openDialog }))

const thread = (id: string, updatedAt: string, extra: Partial<NormalizedThread> = {}): NormalizedThread => ({
  id, title: 'Task ' + id, updatedAt, model: 'deepseek-v4-pro', mode: 'agent', workspace: '/Users/me/projects/kun-site', ...extra
})
const entry = (id: string, createdAt: string, extra: Partial<RoomSidebarEntry> = {}): RoomSidebarEntry => ({
  id, roomId: 'room-' + id, agentId: 'agent-' + id, name: 'Agent ' + id, title: 'Agent ' + id, kind: 'user_agent', members: [],
  pinned: false, archived: false, deleted: false, latestMessageSeq: 1, readSeq: 1, runningCount: 0, attentionCount: 0,
  latestMessage: { preview: 'Last words of ' + id, authorKind: 'member', createdAt } as RoomSidebarEntry['latestMessage'], ...extra
})

let host: HTMLDivElement
let root: Root
beforeEach(async () => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  await i18n.changeLanguage('en')
  mocks.openRoom.mockReset()
  mocks.openDialog.mockReset()
  useLatestPrivateConversation.setState({ entry: null })
  useChatStore.setState({ activeThreadId: null, clawChannels: [], threads: [
    thread('older', '2026-10-01T08:00:00.000Z'),
    thread('newest', '2026-10-07T08:00:00.000Z'),
    thread('archived', '2026-10-07T09:00:00.000Z', { archived: true }),
    thread('side', '2026-10-07T10:00:00.000Z', { relation: 'side', parentThreadId: 'newest' })
  ] })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

const card = (kind: string): HTMLButtonElement | null => host.querySelector<HTMLButtonElement>(`[data-home-card="${kind}"]`)

describe('Code home cards', () => {
  it('resumes the newest Code task, skipping archived, side and the open blank task', async () => {
    const onOpenThread = vi.fn()
    await act(async () => root.render(createElement(CodeHomeQuickStart, { disabled: false, onOpenThread })))
    expect(card('continue-task')?.textContent).toContain('Task newest')
    expect(card('continue-task')?.textContent).toContain('kun-site')
    await act(async () => card('continue-task')!.click())
    expect(onOpenThread).toHaveBeenCalledWith('newest')

    const threads = useChatStore.getState().threads
    expect(continueTaskCandidate(threads, 'newest', () => true)?.id).toBe('older')
  })

  it('hides the resume card without a thread opener', async () => {
    await act(async () => root.render(createElement(CodeHomeQuickStart, { disabled: false })))
    expect(card('continue-task')).toBeNull()
    expect(host.querySelectorAll('[data-home-card]')).toHaveLength(2)
  })

  it('returns to the latest private chat, or opens the picker when there is none', async () => {
    await act(async () => root.render(createElement(CodeHomeQuickStart, { disabled: false })))
    expect(card('agent-chat')?.textContent).toContain('Message an Agent')
    await act(async () => card('agent-chat')!.click())
    expect(mocks.openDialog).toHaveBeenCalledWith('picker')

    await act(async () => publishLatestPrivateConversation([
      entry('a', '2026-10-06T08:00:00.000Z'),
      entry('b', '2026-10-07T08:00:00.000Z'),
      entry('group', '2026-10-07T09:00:00.000Z', { kind: 'group', agentId: undefined })
    ]))
    expect(card('agent-chat')?.textContent).toContain('Agent b')
    expect(card('agent-chat')?.textContent).toContain('Last words of b')
    await act(async () => card('agent-chat')!.click())
    expect(mocks.openRoom).toHaveBeenCalledWith('room-b')
  })

  it('starts a group from its own card', async () => {
    await act(async () => root.render(createElement(CodeHomeQuickStart, { disabled: false })))
    await act(async () => card('group-chat')!.click())
    expect(mocks.openDialog).toHaveBeenCalledWith('picker', { group: true })
  })
})
