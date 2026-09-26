// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoomSidebarEntry } from '@shared/rooms-api'
import { MobileRoomsHome, type MobileRoomsHomeProps } from './MobileRoomsHome'
import { imListTime } from '../../lib/im-time'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => options?.count === undefined ? key : `${key}:${options.count}`,
    i18n: { language: 'en-US' }
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined }
}))
vi.mock('../../components/rooms/RoomAvatar', () => ({
  RoomAvatar: ({ label }: { label: string }) => createElement('span', { className: 'avatar' }, label),
  RoomAvatarGroup: ({ label }: { label: string }) => createElement('span', { className: 'avatar-group' }, label)
}))
vi.mock('../sheets/MobileSheet', () => ({
  MobileSheet: ({ open, title, children }: { open: boolean; title: string; children?: ReactNode }) =>
    open ? createElement('div', { className: 'sheet', 'data-title': title }, children) : null
}))

const group = {
  id: 'entry', roomId: 'room', name: 'Build team', title: 'Build team', kind: 'group', pinned: true, archived: false,
  runningCount: 1, members: [],
  latestMessage: { authorLabelSnapshot: 'Agent', preview: 'Finished', createdAt: new Date().toISOString(), id: 'm', authorKind: 'agent', attachmentCount: 0 },
  latestMessageSeq: 5, readSeq: 3, attentionCount: 1
} as unknown as RoomSidebarEntry
const agent = {
  id: 'agent-entry', agentId: 'kun', name: 'Kun', title: 'Assistant', kind: 'user_agent', pinned: false, archived: false,
  runningCount: 0, members: [],
  latestMessage: { authorLabelSnapshot: 'Kun', preview: 'Disk usage', createdAt: new Date().toISOString(), id: 'n', authorKind: 'agent', attachmentCount: 0 },
  latestMessageSeq: 300, readSeq: 0, attentionCount: 0
} as unknown as RoomSidebarEntry
function props(): MobileRoomsHomeProps {
  return {
    rooms: [group, agent], search: '', filter: 'all', loading: false, error: '', hasMore: true,
    onSearch: vi.fn(), onFilter: vi.fn(), onOpen: vi.fn(), onPin: vi.fn(), onSettings: vi.fn(), onArchive: vi.fn(),
    onCreate: vi.fn(), onProfile: vi.fn(), onRetry: vi.fn(), onLoadMore: vi.fn()
  }
}
let root: Root
let host: HTMLDivElement
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })
const rows = (): HTMLButtonElement[] => [...host.querySelectorAll<HTMLButtonElement>('.kun-mobile-room-open')]
const byText = (text: string): HTMLButtonElement =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === text)!

describe('mobile Bot list', () => {
  it('renders IM rows: avatar badge, name and time, author only in group previews', () => {
    act(() => root.render(createElement(MobileRoomsHome, props())))
    const [groupRow, agentRow] = rows()
    expect(groupRow!.querySelector('strong')?.textContent).toBe('Build team')
    expect(groupRow!.querySelector('time')?.textContent).not.toBe('')
    expect(groupRow!.querySelector('.kun-mobile-room-preview')?.textContent).toBe('[roomsAttention]Agent: Finished')
    expect(groupRow!.querySelector('.kun-mobile-room-badge')?.textContent).toBe('2')
    expect(groupRow!.querySelector('.kun-mobile-room-running')).not.toBeNull()
    expect(groupRow!.closest('li')?.hasAttribute('data-pinned')).toBe(true)
    expect(agentRow!.querySelector('.kun-mobile-room-preview')?.textContent).toBe('Disk usage')
    expect(agentRow!.querySelector('.kun-mobile-room-badge')?.textContent).toBe('99+')
  })

  it('opens on tap, and a long press opens actions without also opening the row', () => {
    vi.useFakeTimers()
    const input = props()
    act(() => root.render(createElement(MobileRoomsHome, input)))
    act(() => rows()[1]!.click())
    expect(input.onOpen).toHaveBeenCalledWith(agent)
    const row = rows()[0]!
    act(() => { row.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 })) })
    act(() => { vi.advanceTimersByTime(500) })
    act(() => { row.dispatchEvent(new MouseEvent('pointerup', { bubbles: true })); row.click() })
    expect(input.onOpen).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.sheet')?.getAttribute('data-title')).toBe('Build team')
    act(() => byText('roomsSidebarUnpin').click())
    expect(input.onPin).toHaveBeenCalledWith(group)
    expect(host.querySelector('.sheet')).toBeNull()
  })

  it('hides room settings for an agent that has no conversation yet', () => {
    act(() => root.render(createElement(MobileRoomsHome, props())))
    act(() => { rows()[1]!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })) })
    expect(host.querySelector('.sheet')?.textContent).not.toContain('roomsSettings')
    expect(host.querySelector('.sheet')?.textContent).toContain('agentsArchive')
  })

  it('offers new chat, group chat and profile from the "+" menu', () => {
    const input = props()
    act(() => root.render(createElement(MobileRoomsHome, input)))
    const plus = host.querySelector<HTMLButtonElement>('button[aria-label="roomsSidebarNew"]')!
    act(() => plus.click())
    expect(plus.getAttribute('aria-expanded')).toBe('true')
    act(() => byText('directCreateGroup').click())
    expect(input.onCreate).toHaveBeenCalledWith('group')
    expect(host.querySelector('[role="menu"]')).toBeNull()
  })

  it('uses mutually exclusive error/empty states and guards retry', () => {
    const input = { ...props(), rooms: [], error: 'Offline', loading: true }
    act(() => root.render(createElement(MobileRoomsHome, input)))
    expect(host.querySelector('[role="status"]')).toBeNull()
    const retry = host.querySelector('[role="alert"] button') as HTMLButtonElement
    expect(retry.disabled).toBe(true)
    act(() => retry.click())
    expect(input.onRetry).not.toHaveBeenCalled()
  })
})

describe('imListTime', () => {
  const now = new Date(2026, 8, 24, 18, 0)
  it('uses time today, yesterday, weekday this week, then dates', () => {
    expect(imListTime(new Date(2026, 8, 24, 9, 5).toISOString(), 'en-US', now)).toMatch(/09:05/)
    expect(imListTime(new Date(2026, 8, 23, 23, 0).toISOString(), 'en-US', now)).toBe('yesterday')
    expect(imListTime(new Date(2026, 8, 23, 23, 0).toISOString(), 'zh-CN', now)).toBe('昨天')
    expect(imListTime(new Date(2026, 8, 21, 8, 0).toISOString(), 'en-US', now)).toBe('Mon')
    expect(imListTime(new Date(2026, 5, 2).toISOString(), 'en-US', now)).toBe('6/2')
    expect(imListTime(new Date(2025, 5, 2).toISOString(), 'en-US', now)).toBe('6/2/2025')
    expect(imListTime('not a date', 'en-US', now)).toBe('')
  })
})
