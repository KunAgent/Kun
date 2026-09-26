// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Room, RoomSidebarEntry } from '@shared/rooms-api'
import { RoomSidebarRow } from './RoomSidebarRow'
import { RoomComposerToolbar } from './RoomComposerToolbar'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }),
  initReactI18next: { type: '3rdParty', init: () => undefined }
}))
vi.mock('./RoomAvatar', () => ({
  RoomAvatar: ({ label }: { label: string }) => createElement('span', { className: 'avatar' }, label),
  RoomAvatarGroup: ({ label }: { label: string }) => createElement('span', { className: 'avatar-group' }, label)
}))
vi.mock('./RoomEmojiPicker', () => ({ RoomEmojiPicker: () => createElement('button', { type: 'button', 'aria-label': 'emoji' }) }))
vi.mock('./RoomPopover', () => ({
  RoomPopover: ({ label, children }: { label: string; children: (close: () => void) => ReactNode }) =>
    createElement('div', { 'data-popover': label }, children(() => undefined))
}))

const group = {
  id: 'g', roomId: 'room', name: 'Build team', title: 'Build team', kind: 'group', pinned: true, archived: false,
  runningCount: 1, members: [], attentionCount: 1, latestMessageSeq: 400, readSeq: 1,
  latestMessage: { id: 'm', authorKind: 'agent', authorLabelSnapshot: 'Kun', preview: 'Done', attachmentCount: 0, createdAt: new Date().toISOString() }
} as unknown as RoomSidebarEntry
const agent = {
  id: 'a', agentId: 'dev', name: 'Dev', title: 'Builds and ships', kind: 'user_agent', pinned: false, archived: false,
  runningCount: 0, members: [], attentionCount: 0, latestMessageSeq: 0, readSeq: 0
} as unknown as RoomSidebarEntry

let root: Root
let host: HTMLDivElement
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('RoomSidebarRow', () => {
  it('shows attention, author, pin, running dot and a capped unread count', () => {
    act(() => root.render(createElement(RoomSidebarRow, { entry: group, selected: true, onOpen: vi.fn(), menu: null })))
    expect(host.querySelector('.rooms-im-sidebar-preview')?.textContent).toBe('[roomsAttention]Kun: Done99+')
    expect(host.querySelector('.rooms-im-sidebar-running')).not.toBeNull()
    expect(host.querySelector('[aria-label="roomsPin"]')).not.toBeNull()
    expect(host.querySelector('[aria-current="page"]')).not.toBeNull()
  })

  it('falls back to the agent title before the first message', () => {
    act(() => root.render(createElement(RoomSidebarRow, { entry: agent, selected: false, onOpen: vi.fn(), menu: null })))
    expect(host.querySelector('.rooms-im-sidebar-preview small')?.textContent).toBe('Builds and ships')
    expect(host.querySelector('time')).toBeNull()
    expect(host.querySelector('.rooms-im-sidebar-badge')).toBeNull()
  })
})

describe('RoomComposerToolbar quick tools', () => {
  const room = { id: 'r', conversationKind: 'group', repositories: [] } as unknown as Room
  const render = (quickTools: boolean) => act(() => root.render(createElement(RoomComposerToolbar, {
    room, tasks: [], taskId: '', repositoryId: '', topicChoices: [], showTopic: false, intent: 'auto',
    busy: false, uploading: false, disabled: false, attachmentLimit: false, canSend: true,
    onAttach: vi.fn(), onMention: vi.fn(), onEmoji: vi.fn(), onPoll: vi.fn(), onTask: vi.fn(),
    onRepository: vi.fn(), onTopic: vi.fn(), onIntent: vi.fn(), quickTools
  })))
  const menuText = () => host.querySelector('[data-popover="roomsAddContext"]')?.textContent ?? ''

  it('moves emoji, mention, attach and poll out of the "+" menu into the toolbar', () => {
    render(true)
    const quick = host.querySelector('.rooms-composer-quick-tools')!
    expect([...quick.querySelectorAll('button')].map((button) => button.getAttribute('aria-label')))
      .toEqual(['emoji', 'roomsMention', 'roomsAttach', 'roomsCreatePoll'])
    expect(menuText()).not.toContain('roomsAttach')
    expect(menuText()).not.toContain('roomsCreatePoll')
  })

  it('keeps everything inside the "+" menu in the compact layout', () => {
    render(false)
    expect(host.querySelector('.rooms-composer-quick-tools')).toBeNull()
    expect(menuText()).toContain('roomsAttach')
    expect(menuText()).toContain('roomsCreatePoll')
  })
})
