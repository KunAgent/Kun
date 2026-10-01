// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoomSidebarEntry, RoomSidebarQuery } from '@shared/rooms-api'
import { RoomSidebar } from './RoomSidebar'

const api = vi.hoisted(() => ({ sidebar: vi.fn() }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }),
  initReactI18next: { type: '3rdParty', init: () => undefined }
}))
vi.mock('./useRoomSidebar', () => ({ useRoomSidebar: api.sidebar }))
vi.mock('./useRoomSidebarMotion', () => ({ useRoomSidebarMotion: () => vi.fn() }))
vi.mock('@tanstack/react-virtual', () => ({ useVirtualizer: () => ({ getVirtualItems: () => [] }) }))
vi.mock('./RoomAvatar', () => ({
  RoomAvatar: ({ label }: { label: string }) => createElement('span', { 'data-avatar': label }),
  RoomAvatarGroup: ({ label }: { label: string }) => createElement('span', { 'data-avatar-group': label })
}))
vi.mock('./RoomPopover', () => ({
  RoomPopover: ({ children }: { children: (close: () => void) => ReactNode }) =>
    createElement('div', {}, children(() => undefined))
}))
vi.mock('./RoomManagementControls', () => ({ RoomListFilters: () => null }))
vi.mock('./RoomUnifiedSearch', () => ({ RoomUnifiedSearch: () => null }))

let root: Root, host: HTMLDivElement
const originalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage')
const callbacks = () => ({
  selectedRoomId: '', onOpenAgent: vi.fn(), onSelect: vi.fn(), onCreateAgent: vi.fn(),
  onCreateGroup: vi.fn(), onDetails: vi.fn(), onSearch: vi.fn(), onProfile: vi.fn(),
  onTeam: vi.fn(), onManage: vi.fn(), onDeleted: vi.fn()
})
const query = () => api.sidebar.mock.calls.at(-1)![0] as RoomSidebarQuery
const click = (label: string) => {
  const button = [...host.querySelectorAll('button')].find((item) => item.textContent === label || item.getAttribute('aria-label') === label)!
  act(() => button.click())
}
const changeKind = (kind: string) => act(() => {
  const select = host.querySelector<HTMLSelectElement>('.rooms-sidebar-filter-menu select')!
  select.value = kind
  select.dispatchEvent(new Event('change', { bubbles: true }))
})
const entry = (id: string, kind: RoomSidebarEntry['kind']): RoomSidebarEntry => ({
  id: 'room:' + id, roomId: id, agentId: kind === 'user_agent' ? 'agent' : undefined,
  kind, name: id, title: id + ' summary', members: [], pinned: false, archived: false, deleted: false,
  latestMessageSeq: 0, readSeq: 0, attentionCount: 0, runningCount: 0
})

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const saved = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key)
  } })
  api.sidebar.mockReset().mockReturnValue({ entries: [], busy: false, error: '', refresh: vi.fn() })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount()); host.remove()
  if (originalStorage) Object.defineProperty(window, 'localStorage', originalStorage)
})

describe('Rooms mixed conversation sidebar', () => {
  it('opens the classic mixed chat list despite stale group-only preferences and creates conversations', () => {
    window.localStorage.setItem('kun.rooms.sidebar.surface', 'agents')
    window.localStorage.setItem('kun.rooms.sidebar.kind', 'group')
    const props = callbacks()
    act(() => root.render(createElement(RoomSidebar, props)))
    expect(query().kind).toBe('all')
    expect(host.querySelector('.rooms-im-sidebar')?.firstElementChild?.className).toBe('rooms-im-sidebar-toolbar')
    expect(host.querySelector('.rooms-im-sidebar-sections')).toBeNull()
    const choices = [...host.querySelectorAll('select option')].map((item) => item.getAttribute('value'))
    expect(choices).toEqual(['all', 'agents', 'group', 'agent_agent'])
    click('roomsSidebarNew')
    expect(props.onCreateAgent).toHaveBeenCalledOnce()
    expect(props.onCreateGroup).not.toHaveBeenCalled()
    click('agentsDirectory')
    expect(props.onManage).toHaveBeenCalledOnce()
  })

  it('keeps kind filtering in the filter menu and preserves explicit mixed-list preferences', () => {
    window.localStorage.setItem('kun.rooms.sidebar.kind', 'agent_agent')
    const props = callbacks()
    act(() => root.render(createElement(RoomSidebar, props)))
    expect(query().kind).toBe('all')
    changeKind('agent_agent')
    expect(query().kind).toBe('agent_agent')
    expect(window.localStorage.getItem('kun.rooms.sidebar.mixed-kind')).toBe('agent_agent')
    click('roomsRecentlyDeleted')
    expect(query()).toMatchObject({ kind: 'agent_agent', deletedOnly: true, archivedOnly: false })
    click('roomsFilter_all')
    expect(query()).toMatchObject({ kind: 'agent_agent', deletedOnly: false })
    act(() => { root.unmount(); root = createRoot(host); root.render(createElement(RoomSidebar, props)) })
    expect(query().kind).toBe('agent_agent')
    act(() => host.querySelector<HTMLButtonElement>('.rooms-sidebar-active-filter')!.click())
    expect(query().kind).toBe('all')
    expect(window.localStorage.getItem('kun.rooms.sidebar.mixed-kind')).toBe('all')
  })

  it('shows private and group portraits with current previews in one list and selects either conversation', () => {
    const direct = entry('Private Agent', 'user_agent'), group = entry('Project group', 'group')
    direct.latestMessage = { id: 'latest', authorKind: 'member', authorLabelSnapshot: 'Agent',
      createdAt: '2026-09-30T10:00:00.000Z', preview: 'Files are ready', attachmentCount: 0 }
    api.sidebar.mockReturnValue({ entries: [direct, group], busy: false, error: '', refresh: vi.fn() })
    const props = { ...callbacks(), selectedRoomId: group.roomId! }
    act(() => root.render(createElement(RoomSidebar, props)))
    expect(query().kind).toBe('all')
    expect(host.querySelectorAll('.rooms-im-sidebar-row')).toHaveLength(2)
    expect(host.querySelector('[data-avatar="Private Agent"]')).not.toBeNull()
    expect(host.querySelector('[data-avatar-group="Project group"]')).not.toBeNull()
    expect(host.querySelector('.rooms-im-sidebar-preview small')?.textContent).toBe('Files are ready')
    expect(host.querySelector('time')?.getAttribute('datetime')).toBe(direct.latestMessage.createdAt)
    expect(host.querySelector('[aria-current="page"]')?.getAttribute('aria-label')).toBe('Project group')
    click('Private Agent')
    click('Project group')
    expect(props.onSelect.mock.calls).toEqual([[direct.roomId], [group.roomId]])
  })

  it('retains a newly chosen private-only filter after remounting', () => {
    window.localStorage.setItem('kun.rooms.sidebar.mixed-kind', 'agents')
    act(() => root.render(createElement(RoomSidebar, callbacks())))
    expect(query().kind).toBe('agents')
    changeKind('group')
    expect(query().kind).toBe('group')
    expect(window.localStorage.getItem('kun.rooms.sidebar.mixed-kind')).toBe('group')
  })
})
