// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoomSidebarEntry } from '@shared/rooms-api'
import { SidebarAgentChatsSection } from './SidebarAgentChatsSection'
import { AGENT_CHATS_HEIGHT_KEY } from './sidebar-agent-chats'

const mocks = vi.hoisted(() => ({
  route: 'chat',
  activeThreadId: 'thread' as string | null,
  chatListener: undefined as undefined | ((state: { route: string; activeThreadId: string | null }, previous: { route: string; activeThreadId: string | null }) => void),
  navigation: { roomId: 'dm-alpha' as string | null, pending: false, error: '' },
  page: { entries: [] as RoomSidebarEntry[], busy: false, error: '', nextCursor: undefined as string | undefined },
  request: vi.fn(), refresh: vi.fn(), more: vi.fn(), query: vi.fn(), openRoom: vi.fn(), openAgent: vi.fn(),
  pin: vi.fn(), archive: vi.fn(), deleted: vi.fn(), setRoute: vi.fn(), setNavigation: vi.fn()
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }),
  initReactI18next: { type: '3rdParty', init: () => undefined }
}))
vi.mock('../../store/chat-store', () => ({
  useChatStore: Object.assign((selector: (state: { route: string }) => unknown) => selector({ route: mocks.route }), {
    getState: () => ({ route: mocks.route, activeThreadId: mocks.activeThreadId, setRoute: mocks.setRoute }),
    subscribe: (listener: typeof mocks.chatListener) => { mocks.chatListener = listener; return () => { mocks.chatListener = undefined } }
  })
}))
vi.mock('../rooms/agent-chat-navigation', () => ({
  useAgentChatNavigationStore: Object.assign((selector: (state: typeof mocks.navigation) => unknown) => selector(mocks.navigation), {
    getState: () => mocks.navigation, subscribe: () => () => undefined, setState: mocks.setNavigation
  }),
  openAgentConversationRoom: mocks.openRoom,
  openAgentConversation: mocks.openAgent,
  AGENT_CHAT_SELECTED_KEY: 'kun.agentChats.selected'
}))
vi.mock('../rooms/room-sidebar-actions', () => ({
  toggleRoomSidebarEntryArchived: mocks.archive,
  setRoomSidebarEntryDeleted: mocks.deleted
}))
vi.mock('../rooms/rooms-client', () => ({ roomsRequest: mocks.request, roomRequestId: () => 'initialize-request' }))
vi.mock('../rooms/useRoomSidebar', () => ({
  useRoomSidebar: (query: unknown, key: unknown) => {
    mocks.query(query, key)
    return { ...mocks.page, refresh: mocks.refresh, more: mocks.more, togglePin: mocks.pin }
  }
}))
vi.mock('../rooms/RoomAvatar', () => ({
  RoomAvatar: ({ label }: { label: string }) => createElement('span', { className: 'avatar' }, label)
}))
vi.mock('../rooms/RoomNewChat', () => ({
  RoomNewChat: ({ selectionMode, onAgent, onOpen, onFill, onClose }: {
    selectionMode: string; onAgent: (id: string) => void; onOpen: (id: string) => void; onFill: () => void; onClose: () => void
  }) =>
    createElement('div', { 'data-new-chat': selectionMode },
      createElement('button', { onClick: () => onAgent('new-agent') }, 'Choose agent'),
      createElement('button', { onClick: () => { onFill(); onClose() } }, 'Fill agent profile'),
      createElement('button', { onClick: () => onOpen('new-direct-room') }, 'Created room'))
}))
vi.mock('../rooms/RoomModal', () => ({
  RoomModal: ({ children, onClose, title }: { children: ReactNode; onClose: () => void; title: string }) => createElement('div', { 'data-profile-modal': true, 'data-modal-title': title },
    createElement('button', { onClick: onClose }, 'Close profile'), children)
}))
vi.mock('../rooms/AgentProfileForm', () => ({
  AgentProfileForm: ({ onSaved }: { onSaved: (agent: { id: string }) => void }) =>
    createElement('button', { onClick: () => onSaved({ id: 'manual-agent' }) }, 'Save agent profile')
}))
vi.mock('./SidebarConversationsSection', () => ({
  SidebarConversationsSection: ({ titleKey }: { titleKey: string }) =>
    createElement('button', { 'data-legacy-history': true }, titleKey)
}))

let root: Root
let host: HTMLDivElement
const props = (overrides: Partial<ComponentProps<typeof SidebarAgentChatsSection>> = {}) => ({
  threads: [], activeThreadId: 'thread', runtimeReady: true, conversationRoot: '/tmp/conversations',
  onNewConversation: vi.fn(), onSelectThread: vi.fn(), onRenameThread: vi.fn(), onPinThread: vi.fn(),
  onArchiveThread: vi.fn(), onDeleteThread: vi.fn(), onRestoreThread: vi.fn(), t: (key: string) => key,
  ...overrides
})
function entry(id: string, values: Partial<RoomSidebarEntry> = {}): RoomSidebarEntry {
  return { id, name: id, title: `${id} specialty`, agentId: id, roomId: `dm-${id}`, kind: 'user_agent',
    members: [], pinned: false, archived: false, deleted: false, latestMessageSeq: 0, readSeq: 0,
    runningCount: 0, attentionCount: 0, ...values }
}
async function render(values = props()): Promise<void> {
  await act(async () => root.render(createElement(SidebarAgentChatsSection, values)))
}
function button(label: string): HTMLButtonElement {
  return host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
}
function openMenu(name: string): void { act(() => button(`${name} · roomsMoreActions`).click()) }
async function menuAction(label: string): Promise<void> {
  const action = [...document.querySelectorAll<HTMLButtonElement>('.rooms-menu-list button')].find((item) => item.textContent === label)!
  await act(async () => action.click())
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const saved = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key)
  })
  mocks.route = 'chat'
  mocks.activeThreadId = 'thread'
  mocks.navigation = { roomId: 'dm-alpha', pending: false, error: '' }
  mocks.page = { entries: [entry('alpha'), entry('beta'), entry('gamma'), entry('delta')], busy: false, error: '', nextCursor: undefined }
  mocks.request.mockReset().mockResolvedValue({ roomId: 'dm-alpha', seen: false })
  mocks.refresh.mockReset(); mocks.more.mockReset(); mocks.query.mockReset(); mocks.openRoom.mockReset()
  mocks.openAgent.mockReset().mockResolvedValue(undefined)
  mocks.pin.mockReset()
  mocks.archive.mockReset().mockResolvedValue(undefined)
  mocks.deleted.mockReset().mockResolvedValue(undefined)
  mocks.setRoute.mockReset().mockImplementation((route: string) => { mocks.route = route })
  mocks.setNavigation.mockReset().mockImplementation((state: Partial<typeof mocks.navigation>) => { Object.assign(mocks.navigation, state) })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

describe('Code agent conversations sidebar', () => {
  it('shows persistent identities and previews without selecting a chat during initialization', async () => {
    mocks.page.entries[0].latestMessage = { id: 'message', authorKind: 'member', authorLabelSnapshot: 'Alpha',
      createdAt: '2026-09-30T03:00:00Z', preview: 'Finished the analysis', attachmentCount: 0 }
    await render()
    expect(host.querySelectorAll('.sidebar-agent-chat-row')).toHaveLength(3)
    expect(host.querySelector('.sidebar-agent-chat-preview')?.textContent).toBe('Finished the analysis')
    expect(mocks.query).toHaveBeenCalledWith({ kind: 'agents', search: '' }, 'dm-alpha')
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith('/v1/agents/chat-entry', 'POST', {
      action: 'initialize', clientRequestId: 'initialize-request'
    })
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(mocks.openRoom).not.toHaveBeenCalled()
    expect(mocks.openAgent).not.toHaveBeenCalled()
    expect(host.querySelector('[aria-current="page"]')).toBeNull()
  })

  it('keeps the selected private chat visible and highlights only on the Agent route', async () => {
    mocks.navigation.roomId = 'dm-delta'
    await render()
    expect(button('delta')).toBeNull()
    mocks.route = 'agent-chat'
    await render()
    expect(button('delta').getAttribute('aria-current')).toBe('page')
    expect(host.querySelectorAll('.sidebar-agent-chat-row')).toHaveLength(3)
    expect(button('gamma')).toBeNull()
  })

  it('reopens an existing room, creates a missing DM by Agent identity, and exposes a private-only picker', async () => {
    mocks.page.entries[1].roomId = undefined
    await render()
    act(() => button('alpha').click())
    expect(mocks.openRoom).toHaveBeenCalledWith('dm-alpha')
    await act(async () => button('beta').click())
    expect(mocks.openAgent).toHaveBeenCalledWith('beta')
    act(() => button('agentChatsStart').click())
    expect(host.querySelector('[data-new-chat="private"]')).not.toBeNull()
    await act(async () => [...host.querySelectorAll('button')].find((item) => item.textContent === 'Choose agent')!.click())
    expect(mocks.openAgent).toHaveBeenLastCalledWith('new-agent')
  })

  it('uses only an unread marker when event sequence gaps are large', async () => {
    mocks.page.entries[0].latestMessageSeq = 900
    mocks.page.entries[0].readSeq = 1
    await render()
    const unread = button('alpha').querySelector('.sidebar-agent-chat-unread')!
    expect(unread.getAttribute('aria-label')).toBe('roomsUnread')
    expect(unread.textContent).toBe('')
    expect(button('beta').querySelector('.sidebar-agent-chat-unread')).toBeNull()
  })

  it('preserves pin and unpin actions in a sibling menu without nested buttons', async () => {
    await render()
    openMenu('alpha')
    await menuAction('roomsPinConversation')
    expect(mocks.pin).toHaveBeenCalledWith(mocks.page.entries[0])
    mocks.page.entries[0].pinned = true
    await render()
    expect(button('alpha').querySelector('[aria-label="roomsPinConversation"]')).not.toBeNull()
    openMenu('alpha')
    await menuAction('roomsUnpinConversation')
    expect(mocks.pin).toHaveBeenCalledTimes(2)
    expect(host.querySelector('button button')).toBeNull()
  })

  it('leaves an archived active DM and lets users restore it through archived conversations', async () => {
    mocks.route = 'agent-chat'
    localStorage.setItem('kun.agentChats.selected', 'dm-alpha')
    await render()
    openMenu('alpha')
    await menuAction('roomsArchiveConversation')
    expect(mocks.archive).toHaveBeenCalledWith(mocks.page.entries[0])
    expect(mocks.setRoute).toHaveBeenCalledWith('chat')
    expect(mocks.navigation.roomId).toBeNull()
    expect(localStorage.getItem('kun.agentChats.selected')).toBeNull()
    expect(button('alpha')).toBeNull()
    mocks.page.entries = [entry('alpha', { archived: true })]
    openMenu('sidebarConversations')
    await menuAction('roomsArchivedConversations')
    expect(mocks.query).toHaveBeenLastCalledWith({ kind: 'agents', search: '', archivedOnly: true }, '')
    expect(button('alpha').disabled).toBe(true)
    openMenu('alpha')
    await menuAction('roomsRestoreArchivedConversation')
    expect(mocks.archive).toHaveBeenLastCalledWith(mocks.page.entries[0])
    expect(mocks.refresh).toHaveBeenCalledTimes(3)
  })

  it('confirms recoverable deletion before clearing the active recipient and exposes restore', async () => {
    mocks.route = 'agent-chat'
    await render()
    openMenu('alpha')
    await menuAction('roomsDeleteConversation')
    expect(mocks.deleted).not.toHaveBeenCalled()
    const confirm = host.querySelector<HTMLButtonElement>('[data-modal-title="roomsDeleteConversation"] .rooms-delete-confirm-actions button:last-child')!
    await act(async () => confirm.click())
    expect(mocks.deleted).toHaveBeenCalledWith(expect.objectContaining({ roomId: 'dm-alpha' }), true)
    expect(mocks.navigation.roomId).toBeNull()
    expect(mocks.setRoute).toHaveBeenCalledWith('chat')
    expect(host.querySelector('[data-modal-title="roomsDeleteConversation"]')).toBeNull()
    mocks.page.entries = [entry('alpha', { deleted: true })]
    openMenu('sidebarConversations')
    await menuAction('roomsRecentlyDeleted')
    expect(mocks.query).toHaveBeenLastCalledWith({ kind: 'agents', search: '', deletedOnly: true }, '')
    expect(button('alpha').disabled).toBe(true)
    openMenu('alpha')
    await menuAction('roomsRestoreConversation')
    expect(mocks.deleted).toHaveBeenLastCalledWith(expect.objectContaining({ roomId: 'dm-alpha' }), false)
  })

  it('retains the conversation and confirmation when deletion is rejected for active work', async () => {
    mocks.route = 'agent-chat'
    mocks.deleted.mockRejectedValueOnce(new Error('stop or reconcile active work'))
    await render()
    openMenu('alpha')
    await menuAction('roomsDeleteConversation')
    await act(async () => host.querySelector<HTMLButtonElement>('.rooms-delete-confirm-actions button:last-child')!.click())
    expect(host.querySelector('[data-modal-title="roomsDeleteConversation"] [role="alert"]')?.textContent).toBe('roomsDeleteActiveWork')
    expect(mocks.navigation.roomId).toBe('dm-alpha')
    expect(mocks.setRoute).not.toHaveBeenCalled()
  })

  it('does not clear a newer DM selected while an archive request is in flight', async () => {
    mocks.route = 'agent-chat'
    let complete!: () => void
    mocks.archive.mockImplementationOnce(() => new Promise<void>((resolve) => { complete = resolve }))
    await render()
    openMenu('alpha')
    await menuAction('roomsArchiveConversation')
    mocks.navigation.roomId = 'dm-beta'
    await act(async () => complete())
    expect(mocks.navigation.roomId).toBe('dm-beta')
    expect(mocks.setRoute).not.toHaveBeenCalled()
  })

  it('lets users configure a new Agent and opens its private conversation after saving', async () => {
    await render()
    act(() => button('agentChatsStart').click())
    act(() => [...host.querySelectorAll('button')].find((item) => item.textContent === 'Fill agent profile')!.click())
    expect(host.querySelector('[data-new-chat]')).toBeNull()
    expect(host.querySelector('[data-profile-modal]')).not.toBeNull()
    await act(async () => [...host.querySelectorAll('button')].find((item) => item.textContent === 'Save agent profile')!.click())
    expect(mocks.openAgent).toHaveBeenCalledWith('manual-agent')
    expect(host.querySelector('[data-profile-modal]')).toBeNull()
  })

  it('does not let a late creation result override a newer task, even after navigating back', async () => {
    await render()
    act(() => button('agentChatsStart').click())
    const previous = { route: mocks.route, activeThreadId: mocks.activeThreadId }
    mocks.chatListener?.({ route: 'rooms', activeThreadId: 'thread' }, previous)
    mocks.chatListener?.(previous, { route: 'rooms', activeThreadId: 'thread' })
    act(() => [...host.querySelectorAll('button')].find((item) => item.textContent === 'Created room')!.click())
    expect(mocks.openRoom).not.toHaveBeenCalled()
  })

  it('allows all identities to be browsed while keeping legacy standalone threads in their own list', async () => {
    const legacy = { id: 'legacy', workspace: '/tmp/conversations/private-a', title: 'Old discussion',
      updatedAt: '2026-01-01T00:00:00Z', model: 'test', mode: 'agent' as const }
    mocks.page.entries.push(entry('group', { kind: 'group' }))
    await render(props({ threads: [legacy] }))
    expect(host.querySelector('[data-legacy-history]')?.textContent).toBe('agentChatsLegacyHistory')
    expect(button('Old discussion')).toBeNull()
    act(() => [...host.querySelectorAll('button')].find((item) => item.textContent === 'agentChatsViewAll')!.click())
    expect(host.querySelectorAll('.sidebar-agent-chat-row')).toHaveLength(4)
    expect(button('group')).toBeNull()
  })

  it('persists accessible sizing without shrinking below or growing above the supported range', async () => {
    localStorage.setItem(AGENT_CHATS_HEIGHT_KEY, '250')
    await render()
    const resize = host.querySelector<HTMLElement>('[role="separator"]')!
    const key = (value: string) => act(() => resize.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true })))
    expect(resize.getAttribute('aria-valuenow')).toBe('250')
    key('ArrowUp')
    expect(localStorage.getItem(AGENT_CHATS_HEIGHT_KEY)).toBe('270')
    key('End'); key('ArrowUp')
    expect(resize.getAttribute('aria-valuenow')).toBe('360')
    key('Home'); key('ArrowDown')
    expect(localStorage.getItem(AGENT_CHATS_HEIGHT_KEY)).toBe('160')
  })

  it('leaves unavailable runtime actions disabled and retries default initialization after a failure', async () => {
    await render(props({ runtimeReady: false }))
    expect(mocks.request).not.toHaveBeenCalled()
    expect(button('agentChatsStart').disabled).toBe(true)
    mocks.request.mockRejectedValueOnce(new Error('offline'))
    await render()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('agentChatsUnavailable')
    await act(async () => host.querySelector<HTMLButtonElement>('[role="alert"] button')!.click())
    expect(mocks.request).toHaveBeenCalledTimes(2)
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })
})
