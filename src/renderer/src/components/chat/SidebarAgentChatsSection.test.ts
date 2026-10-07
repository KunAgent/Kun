// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoomSidebarEntry } from '@shared/rooms-api'
import { SidebarAgentChatsSection } from './SidebarAgentChatsSection'

const mocks = vi.hoisted(() => ({
  route: 'chat',
  activeThreadId: 'thread' as string | null,
  navigation: { roomId: 'dm-alpha' as string | null, pending: false, error: '' },
  page: { entries: [] as RoomSidebarEntry[], busy: false, error: '', nextCursor: undefined as string | undefined },
  request: vi.fn(), refresh: vi.fn(), more: vi.fn(), query: vi.fn(), openRoom: vi.fn(), openAgent: vi.fn(),
  pin: vi.fn(), archive: vi.fn(), remove: vi.fn(), restore: vi.fn(), setRoute: vi.fn(), setNavigation: vi.fn(),
  openDialog: vi.fn(), publish: vi.fn()
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }),
  initReactI18next: { type: '3rdParty', init: () => undefined }
}))
vi.mock('../../store/chat-store', () => ({
  useChatStore: Object.assign((selector: (state: { route: string }) => unknown) => selector({ route: mocks.route }), {
    getState: () => ({ route: mocks.route, activeThreadId: mocks.activeThreadId, setRoute: mocks.setRoute }),
    subscribe: () => () => undefined
  })
}))
vi.mock('../rooms/agent-chat-navigation', () => ({
  useAgentChatNavigationStore: Object.assign((selector: (state: typeof mocks.navigation) => unknown) => selector(mocks.navigation), {
    getState: () => mocks.navigation, subscribe: () => () => undefined, setState: mocks.setNavigation
  }),
  openAgentConversationRoom: mocks.openRoom,
  openAgentConversation: mocks.openAgent,
  // Mirrors the store helper: only the removed selection is cleared.
  leaveAgentConversation: (roomId: string) => {
    if (mocks.navigation.roomId !== roomId) return
    localStorage.removeItem('kun.agentChats.selected')
    mocks.setNavigation({ roomId: null, error: '', pending: false })
    if (mocks.route === 'agent-chat') mocks.setRoute('chat')
  },
  AGENT_CHAT_SELECTED_KEY: 'kun.agentChats.selected'
}))
vi.mock('../rooms/agent-chat-picker', () => ({ openAgentChatDialog: mocks.openDialog }))
vi.mock('../rooms/room-activity-counts', () => ({ publishRoomActivityCounts: mocks.publish }))
vi.mock('../rooms/room-sidebar-actions', () => ({ toggleRoomSidebarEntryArchived: mocks.archive }))
vi.mock('../rooms/agent-chat-removal', async (importActual) => ({
  ...await importActual<typeof import('../rooms/agent-chat-removal')>(),
  removeConversation: mocks.remove,
  restoreConversation: mocks.restore
}))
vi.mock('../rooms/rooms-client', () => ({ roomsRequest: mocks.request, roomRequestId: () => 'initialize-request' }))
vi.mock('../rooms/useRoomSidebar', () => ({
  useRoomSidebar: (query: unknown, key: unknown, enabled: boolean) => {
    mocks.query(query, key, enabled)
    return { ...mocks.page, refresh: mocks.refresh, more: mocks.more, togglePin: mocks.pin }
  }
}))
vi.mock('../rooms/RoomAvatar', () => ({
  RoomAvatar: ({ label }: { label: string }) => createElement('span', { className: 'avatar' }, label),
  RoomAvatarGroup: ({ label }: { label: string }) => createElement('span', { className: 'avatar-group' }, label)
}))
vi.mock('../rooms/RoomModal', () => ({
  RoomModal: ({ children, onClose, title }: { children: ReactNode; onClose: () => void; title: string }) => createElement('div', { 'data-modal-title': title },
    createElement('button', { onClick: onClose }, 'Close modal'), children)
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
function group(id: string, values: Partial<RoomSidebarEntry> = {}): RoomSidebarEntry {
  return entry(id, { kind: 'group', agentId: undefined, roomId: `room-${id}`, ...values })
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
const rows = () => host.querySelectorAll('.sidebar-agent-chat-row')
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
  mocks.page = { entries: ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].map((id) => entry(id)), busy: false, error: '', nextCursor: undefined }
  mocks.request.mockReset().mockResolvedValue({ initialized: true, roomId: 'dm-alpha', seen: false })
  for (const mock of [mocks.refresh, mocks.more, mocks.query, mocks.openRoom, mocks.pin, mocks.openDialog, mocks.publish]) mock.mockReset()
  mocks.openAgent.mockReset().mockResolvedValue(undefined)
  mocks.archive.mockReset().mockResolvedValue(undefined)
  mocks.remove.mockReset().mockResolvedValue(undefined)
  mocks.restore.mockReset().mockResolvedValue(undefined)
  mocks.setRoute.mockReset().mockImplementation((route: string) => { mocks.route = route })
  mocks.setNavigation.mockReset().mockImplementation((state: Partial<typeof mocks.navigation>) => { Object.assign(mocks.navigation, state) })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Code conversations sidebar', () => {
  it('lists private and group conversations without selecting one during initialization', async () => {
    mocks.page.entries[0].latestMessage = { id: 'message', authorKind: 'member', authorLabelSnapshot: 'Alpha',
      createdAt: '2026-09-30T03:00:00Z', preview: 'Finished the analysis', attachmentCount: 0 }
    await render()
    expect(rows()).toHaveLength(4)
    expect(host.querySelector('.sidebar-agent-chat-preview')?.textContent).toBe('Finished the analysis')
    expect(mocks.query).toHaveBeenCalledWith({ kind: 'all', search: '' }, 'dm-alpha', true)
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith('/v1/agents/chat-entry', 'GET')
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(mocks.openRoom).not.toHaveBeenCalled()
    expect(mocks.openAgent).not.toHaveBeenCalled()
    expect(host.querySelector('[aria-current="page"]')).toBeNull()
    expect(mocks.publish).toHaveBeenCalledWith(mocks.page.entries)
  })

  it('creates the default chat only when the read-only bootstrap check says it is missing', async () => {
    mocks.request.mockResolvedValueOnce({ initialized: false })
    await render()
    expect(mocks.request.mock.calls).toEqual([
      ['/v1/agents/chat-entry', 'GET'],
      ['/v1/agents/chat-entry', 'POST', { action: 'initialize', clientRequestId: 'initialize-request' }]
    ])
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })

  it('keeps the selected conversation visible and highlights it only on the conversation route', async () => {
    mocks.navigation.roomId = 'dm-epsilon'
    await render()
    expect(button('epsilon')).toBeNull()
    mocks.route = 'agent-chat'
    await render()
    expect(button('epsilon').getAttribute('aria-current')).toBe('page')
    expect(rows()).toHaveLength(4)
    expect(button('delta')).toBeNull()
  })

  it('reopens existing rooms, creates a missing DM by Agent identity and opens the shared picker', async () => {
    mocks.page.entries[1].roomId = undefined
    await render()
    act(() => button('alpha').click())
    expect(mocks.openRoom).toHaveBeenCalledWith('dm-alpha')
    await act(async () => button('beta').click())
    expect(mocks.openAgent).toHaveBeenCalledWith('beta')
    act(() => button('agentChatsStart').click())
    expect(mocks.openDialog).toHaveBeenCalledExactlyOnceWith('picker')
  })

  it('opens group conversations in Code and keeps Agent pair transcripts out of the list', async () => {
    mocks.page.entries = [group('release', { name: 'Release review', latestMessage: { id: 'm', authorKind: 'member',
      authorLabelSnapshot: 'Codex', createdAt: '2026-09-30T03:00:00Z', preview: 'Needs a test run', attachmentCount: 0 } }),
    entry('pair', { kind: 'agent_agent', name: 'Pair transcript' })]
    await render()
    expect(rows()).toHaveLength(1)
    expect(button('Pair transcript')).toBeNull()
    expect(button('Release review').querySelector('.avatar-group')).not.toBeNull()
    expect(button('Release review').querySelector('.sidebar-agent-chat-preview')?.textContent).toBe('Codex: Needs a test run')
    act(() => button('Release review').click())
    expect(mocks.openRoom).toHaveBeenCalledWith('room-release')
  })

  it('puts attention and running work ahead of the message preview', async () => {
    mocks.page.entries = [entry('alpha', { runningCount: 1 }), group('team', { runningCount: 2 }),
      group('review', { attentionCount: 1, runningCount: 1 })]
    await render()
    expect(button('alpha').querySelector('.is-working')?.textContent).toBe('conversationReplying')
    expect(button('team').querySelector('.is-working')?.textContent).toBe('conversationGroupWorking')
    expect(button('review').querySelector('.sidebar-agent-chat-attention')?.textContent).toBe('roomsAttention')
    expect(button('review').querySelector('.is-working')).toBeNull()
  })

  it('uses unread markers and counts unread conversations in the section header', async () => {
    mocks.page.entries[0].latestMessageSeq = 900
    mocks.page.entries[0].readSeq = 1
    await render()
    const unread = button('alpha').querySelector('.sidebar-agent-chat-unread')!
    expect(unread.getAttribute('aria-label')).toBe('roomsUnread')
    expect(unread.textContent).toBe('')
    expect(button('alpha').classList.contains('is-unread')).toBe(true)
    expect(button('beta').querySelector('.sidebar-agent-chat-unread')).toBeNull()
    expect(host.querySelector('.sidebar-agent-chats-count')?.textContent).toBe('1')
  })

  it('preserves pin and unpin actions in a sibling menu without nested buttons', async () => {
    await render()
    openMenu('alpha')
    await menuAction('conversationPin')
    expect(mocks.pin).toHaveBeenCalledWith(mocks.page.entries[0])
    mocks.page.entries[0].pinned = true
    await render()
    expect(button('alpha').querySelector('[aria-label="roomsPinConversation"]')).not.toBeNull()
    openMenu('alpha')
    await menuAction('roomsUnpinConversation')
    expect(mocks.pin).toHaveBeenCalledTimes(2)
    expect(host.querySelector('button button')).toBeNull()
  })

  it('leaves an archived active conversation and lets users restore it through archived conversations', async () => {
    mocks.route = 'agent-chat'
    localStorage.setItem('kun.agentChats.selected', 'dm-alpha')
    await render()
    openMenu('alpha')
    await menuAction('conversationArchive')
    expect(mocks.archive).toHaveBeenCalledWith(mocks.page.entries[0])
    expect(mocks.setRoute).toHaveBeenCalledWith('chat')
    expect(mocks.navigation.roomId).toBeNull()
    expect(localStorage.getItem('kun.agentChats.selected')).toBeNull()
    expect(button('alpha')).toBeNull()
    mocks.page.entries = [entry('alpha', { archived: true })]
    openMenu('sidebarConversations')
    await menuAction('roomsArchivedConversations')
    expect(mocks.query).toHaveBeenLastCalledWith({ kind: 'all', search: '', archivedOnly: true }, '', true)
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
    await menuAction('conversationDeleteChat')
    expect(mocks.remove).not.toHaveBeenCalled()
    const confirm = host.querySelector<HTMLButtonElement>('[data-modal-title="conversationRemoveChatTitle"] [data-removal-confirm="conversation"]')!
    await act(async () => confirm.click())
    expect(mocks.remove).toHaveBeenCalledWith(expect.objectContaining({ roomId: 'dm-alpha', agentId: 'alpha' }), 'conversation')
    expect(mocks.navigation.roomId).toBeNull()
    expect(mocks.setRoute).toHaveBeenCalledWith('chat')
    expect(host.querySelector('[data-modal-title="conversationRemoveChatTitle"]')).toBeNull()
    mocks.page.entries = [entry('alpha', { deleted: true })]
    openMenu('sidebarConversations')
    await menuAction('roomsRecentlyDeleted')
    expect(mocks.query).toHaveBeenLastCalledWith({ kind: 'all', search: '', deletedOnly: true }, '', true)
    expect(button('alpha').disabled).toBe(true)
    openMenu('alpha')
    await menuAction('roomsRestoreConversation')
    expect(mocks.restore).toHaveBeenLastCalledWith(expect.objectContaining({ roomId: 'dm-alpha' }))
  })

  it('deletes an Agent with its private chat and restores both together', async () => {
    mocks.route = 'agent-chat'
    await render()
    openMenu('alpha')
    const labels = [...document.querySelectorAll<HTMLButtonElement>('[data-conversation-menu="user_agent"] button')]
      .map((item) => [item.dataset.conversationAction, item.classList.contains('is-danger')])
    expect(labels).toEqual([['info', false], ['pin', false], ['archive', false], ['conversation', true], ['agent', true]])
    await menuAction('conversationDeleteAgent')
    const dialog = host.querySelector('[data-modal-title="conversationRemoveAgentTitle"]')!
    expect(dialog.textContent).toContain('conversationRemoveAgentPointChat')
    await act(async () => dialog.querySelector<HTMLButtonElement>('[data-removal-confirm="agent"]')!.click())
    expect(mocks.remove).toHaveBeenCalledWith(expect.objectContaining({ roomId: 'dm-alpha', agentId: 'alpha' }), 'agent')
    expect(mocks.navigation.roomId).toBeNull()
    expect(button('alpha')).toBeNull()
    mocks.page.entries = [entry('alpha', { deleted: true, agentArchived: true })]
    openMenu('sidebarConversations')
    await menuAction('roomsRecentlyDeleted')
    openMenu('alpha')
    await menuAction('conversationRestoreAgentAndChat')
    expect(mocks.restore).toHaveBeenCalledWith(expect.objectContaining({ roomId: 'dm-alpha', agentId: 'alpha', agentArchived: true }))
  })

  it('deletes groups as groups and opens the info board from the row menu', async () => {
    mocks.page.entries = [group('team', { name: 'Team' })]
    await render()
    openMenu('Team')
    expect([...document.querySelectorAll<HTMLButtonElement>('[data-conversation-menu="group"] button')]
      .map((item) => item.dataset.conversationAction)).toEqual(['info', 'pin', 'archive', 'group'])
    await menuAction('conversationViewGroupInfo')
    expect(mocks.openRoom).toHaveBeenCalledWith('room-team', { info: true })
    openMenu('Team')
    await menuAction('conversationDeleteGroup')
    await act(async () => host.querySelector<HTMLButtonElement>('[data-modal-title="conversationRemoveGroupTitle"] [data-removal-confirm="group"]')!.click())
    expect(mocks.remove).toHaveBeenCalledWith(expect.objectContaining({ roomId: 'room-team', kind: 'group' }), 'group')
  })

  it('retains the conversation and confirmation when deletion is rejected for active work', async () => {
    mocks.route = 'agent-chat'
    mocks.remove.mockRejectedValueOnce(new Error('stop or reconcile active work'))
    await render()
    openMenu('alpha')
    await menuAction('conversationDeleteChat')
    await act(async () => host.querySelector<HTMLButtonElement>('[data-removal-confirm="conversation"]')!.click())
    expect(host.querySelector('[data-modal-title="conversationRemoveChatTitle"] [role="alert"]')?.textContent).toBe('roomsDeleteActiveWork')
    expect(host.querySelector('.sidebar-agent-chats-error')).toBeNull()
    expect(mocks.navigation.roomId).toBe('dm-alpha')
    expect(mocks.setRoute).not.toHaveBeenCalled()
  })

  it('does not clear a newer conversation selected while an archive request is in flight', async () => {
    mocks.route = 'agent-chat'
    let complete!: () => void
    mocks.archive.mockImplementationOnce(() => new Promise<void>((resolve) => { complete = resolve }))
    await render()
    openMenu('alpha')
    await menuAction('conversationArchive')
    mocks.navigation.roomId = 'dm-beta'
    await act(async () => complete())
    expect(mocks.navigation.roomId).toBe('dm-beta')
    expect(mocks.setRoute).not.toHaveBeenCalled()
  })

  it('filters unread, needs-you and group conversations from the section menu', async () => {
    await render()
    openMenu('sidebarConversations')
    await menuAction('conversationFilterUnread')
    expect(mocks.query).toHaveBeenLastCalledWith({ kind: 'all', search: '', unreadOnly: true }, 'dm-alpha', true)
    expect(host.querySelector('.sidebar-agent-chats-scope')?.textContent).toBe('conversationFilterUnread')
    openMenu('sidebarConversations')
    await menuAction('conversationFilterAttention')
    expect(mocks.query).toHaveBeenLastCalledWith({ kind: 'all', search: '', attentionOnly: true }, 'dm-alpha', true)
    openMenu('sidebarConversations')
    await menuAction('conversationFilterGroups')
    expect(mocks.query).toHaveBeenLastCalledWith({ kind: 'group', search: '' }, 'dm-alpha', true)
    await act(async () => host.querySelector<HTMLButtonElement>('.sidebar-agent-chats-scope')!.click())
    expect(mocks.query).toHaveBeenLastCalledWith({ kind: 'all', search: '' }, 'dm-alpha', true)
    expect(host.querySelector('.sidebar-agent-chats-scope')).toBeNull()
  })

  it('opens the Agent directory from the section menu', async () => {
    await render()
    openMenu('sidebarConversations')
    await menuAction('agentDirectoryTitle')
    expect(mocks.openDialog).toHaveBeenCalledExactlyOnceWith('directory')
  })

  it('expands every conversation while keeping legacy standalone threads in their own list', async () => {
    const legacy = { id: 'legacy', workspace: '/tmp/conversations/private-a', title: 'Old discussion',
      updatedAt: '2026-01-01T00:00:00Z', model: 'test', mode: 'agent' as const }
    mocks.page.entries.push(group('team'))
    await render(props({ threads: [legacy] }))
    expect(host.querySelector('[data-legacy-history]')?.textContent).toBe('agentChatsLegacyHistory')
    expect(button('Old discussion')).toBeNull()
    expect(rows()).toHaveLength(4)
    act(() => [...host.querySelectorAll('button')].find((item) => item.textContent === 'conversationViewAll')!.click())
    expect(rows()).toHaveLength(6)
    expect(button('team')).not.toBeNull()
  })

  it('leaves unavailable runtime actions disabled and retries default initialization after a failure', async () => {
    vi.useFakeTimers()
    await render(props({ runtimeReady: false }))
    expect(mocks.request).not.toHaveBeenCalled()
    expect(button('agentChatsStart').disabled).toBe(true)
    mocks.request.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline'))
    await render()
    expect(host.querySelector('[role="alert"]')).toBeNull()
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('agentChatsUnavailable')
    await act(async () => host.querySelector<HTMLButtonElement>('[role="alert"] button')!.click())
    expect(mocks.request).toHaveBeenCalledTimes(3)
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })
  it('recovers transient startup initialization with the same idempotent request', async () => {
    vi.useFakeTimers()
    mocks.request.mockRejectedValueOnce(new Error('runtime still applying settings'))
    await render()
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(mocks.request).toHaveBeenCalledTimes(2)
    expect(mocks.request.mock.calls[0]).toEqual(mocks.request.mock.calls[1])
    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })
  it('cancels pending initialization recovery when Kun disconnects', async () => {
    vi.useFakeTimers()
    mocks.request.mockRejectedValueOnce(new Error('starting'))
    await render()
    await render(props({ runtimeReady: false }))
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(mocks.request).toHaveBeenCalledOnce()
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })
  it('hides cached rows and unavailable errors until Kun has finished loading', async () => {
    mocks.page.error = 'runtime still starting'
    mocks.navigation.error = 'early connection failure'
    await render(props({ runtimeReady: false }))
    expect(mocks.query).toHaveBeenLastCalledWith({ kind: 'all', search: '' }, 'dm-alpha', false)
    expect(host.querySelector('[data-agent-chats-waiting]')?.textContent).toContain('waitingForKun')
    expect(rows()).toHaveLength(0)
    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(host.textContent).not.toContain('conversationViewAll')
    mocks.page.error = ''; mocks.navigation.error = ''
    await render()
    expect(host.querySelector('[data-agent-chats-waiting]')).toBeNull()
    expect(rows()).toHaveLength(4)
  })
})
