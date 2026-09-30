// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoomSidebarQuery } from '@shared/rooms-api'
import { RoomSidebar } from './RoomSidebar'

const api = vi.hoisted(() => ({ sidebar: vi.fn() }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => undefined }
}))
vi.mock('./useRoomSidebar', () => ({ useRoomSidebar: api.sidebar }))
vi.mock('./useRoomSidebarMotion', () => ({ useRoomSidebarMotion: () => vi.fn() }))
vi.mock('@tanstack/react-virtual', () => ({ useVirtualizer: () => ({ getVirtualItems: () => [] }) }))
vi.mock('./RoomAvatar', () => ({ RoomAvatar: () => null }))
vi.mock('./RoomPopover', () => ({
  RoomPopover: ({ children }: { children: (close: () => void) => ReactNode }) =>
    createElement('div', {}, children(() => undefined))
}))
vi.mock('./RoomSidebarRow', () => ({ RoomSidebarRow: () => null }))
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

describe('Rooms group sidebar', () => {
  it('migrates the old Agent directory surface to group rooms and creates groups', () => {
    window.localStorage.setItem('kun.rooms.sidebar.surface', 'agents')
    window.localStorage.setItem('kun.rooms.sidebar.kind', 'agents')
    const props = callbacks()
    act(() => root.render(createElement(RoomSidebar, props)))
    expect(query().kind).toBe('group')
    const choices = [...host.querySelectorAll('select option')].map((item) => item.getAttribute('value'))
    expect(choices).toEqual(['group', 'agent_agent'])
    click('directCreateGroup')
    expect(props.onCreateGroup).toHaveBeenCalledOnce()
    expect(props.onCreateAgent).not.toHaveBeenCalled()
    click('agentsDirectory')
    expect(props.onManage).toHaveBeenCalledOnce()
  })

  it('keeps recent deletion filtering scoped to the selected room kind', () => {
    const props = callbacks()
    act(() => root.render(createElement(RoomSidebar, props)))
    click('roomsSidebar_agent_agent')
    expect(query().kind).toBe('agent_agent')
    expect(window.localStorage.getItem('kun.rooms.sidebar.kind')).toBe('agent_agent')
    click('roomsRecentlyDeleted')
    expect(query()).toMatchObject({ kind: 'agent_agent', deletedOnly: true, archivedOnly: false })
    click('roomsFilter_all')
    expect(query()).toMatchObject({ kind: 'agent_agent', deletedOnly: false })
    click('roomsSidebar_group')
    expect(query().kind).toBe('group')
  })
})
