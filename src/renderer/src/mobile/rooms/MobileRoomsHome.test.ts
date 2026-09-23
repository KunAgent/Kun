// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoomSidebarEntry } from '@shared/rooms-api'
import { MobileRoomsHome, type MobileRoomsHomeProps } from './MobileRoomsHome'

let root: Root
let host: HTMLDivElement
const room = {
  id: 'entry', roomId: 'room', name: 'Build team', title: 'Build team', kind: 'group', pinned: false, archived: false, runningCount: 0,
  members: [{ id: 'one' }, { id: 'two' }],
  latestMessage: { authorLabelSnapshot: 'Agent', preview: 'Finished', createdAt: '', id: 'm', authorKind: 'agent', attachmentCount: 0 },
  latestMessageSeq: 5, readSeq: 3, attentionCount: 1
} as unknown as RoomSidebarEntry
function props(): MobileRoomsHomeProps {
  return {
    rooms: [room], search: '', filter: 'all', loading: false, error: '', hasMore: true,
    labels: { title: 'Rooms', search: 'Search', create: 'Create', more: 'More', empty: 'Empty', loading: 'Loading', retry: 'Retry', loadMore: 'More rooms', all: 'All', unread: 'Unread', attention: 'Attention' },
    onSearch: vi.fn(), onFilter: vi.fn(), onOpen: vi.fn(), onMenu: vi.fn(), onCreate: vi.fn(), onRetry: vi.fn(), onLoadMore: vi.fn()
  }
}
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('mobile Rooms home', () => {
  it('shows room identity, existing unread metadata and explicit actions', () => {
    const input = props()
    act(() => root.render(createElement(MobileRoomsHome, input)))
    expect(host.textContent).toContain('Agent: Finished')
    expect(host.querySelector('.kun-mobile-room-count')?.textContent).toBe('2')
    expect(host.querySelector('.kun-mobile-room-attention')).not.toBeNull()
    act(() => (host.querySelector('.kun-mobile-room-open') as HTMLButtonElement).click())
    act(() => (host.querySelector('[aria-label="More: Build team"]') as HTMLButtonElement).click())
    expect(input.onOpen).toHaveBeenCalledWith('room')
    expect(input.onMenu).toHaveBeenCalledWith('room')
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
