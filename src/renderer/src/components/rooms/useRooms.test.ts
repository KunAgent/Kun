import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRooms } from './useRooms'

const client = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  messages: vi.fn(),
  tasks: vi.fn(),
  rules: vi.fn(),
  request: vi.fn()
}))
vi.mock('./rooms-client', async (original) => ({
  ...(await original<typeof import('./rooms-client')>()),
  roomsClient: client,
  roomsRequest: client.request
}))
const events = vi.hoisted(() => new Set<(event: { seq: number; roomId: string; kind: string }) => void>())
const connection = vi.hoisted(() => ({ live: false }))
vi.mock('./useRoomEvents', () => ({
  roomEventsLive: () => connection.live,
  subscribeRoomEvents: (listener: (event: { seq: number; roomId: string; kind: string }) => void) => {
    events.add(listener)
    return () => events.delete(listener)
  }
}))

describe('Rooms view state', () => {
  let renderer: ReactTestRenderer
  let state: ReturnType<typeof useRooms>
  const room = {
    id: 'room-a',
    name: 'Room',
    members: [],
    updatedAt: '2026-09-12T00:00:00Z'
  }
  beforeEach(() => {
    vi.useFakeTimers()
    connection.live = false
    for (const method of Object.values(client)) method.mockReset()
    client.list.mockResolvedValue({ rooms: [room] })
    client.get.mockImplementation(async (id) => ({ room: { ...room, id } }))
    client.messages.mockResolvedValue({
      messages: [{ id: 'm2', messageSeq: 2, bodyRevision: 0, body: 'Latest' }],
      nextCursor: '2'
    })
    client.tasks.mockResolvedValue({
      tasks: [{ id: 'task2', revision: 2, updatedAt: '2026-09-12T00:00:00Z' }],
      nextCursor: '2'
    })
    client.rules.mockResolvedValue({ rules: [] })
    client.request.mockResolvedValue({ messages: [] })
    vi.stubGlobal('window', {
      localStorage: { getItem: () => null, setItem: () => undefined }
    })
  })
  afterEach(() => {
    if (renderer) act(() => renderer.unmount())
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  async function mount(): Promise<void> {
    function Harness() {
      state = useRooms()
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
    })
  }

  function pagedRooms() {
    const records = Array.from({ length: 101 }, (_, index) => ({ ...room, id: `room-${index}`,
      name: `Room ${index}`, rank: index, unread: true, repositoryRoot: '/repository' }))
    client.list.mockImplementation(async (_archived: boolean, cursor?: string, _signal?: AbortSignal,
      _search?: string, filters?: { ids?: string[]; unreadOnly?: boolean; repositoryRoot?: string }) => {
      let eligible = records.filter((entry) => (!filters?.unreadOnly || entry.unread) &&
        (!filters?.repositoryRoot || entry.repositoryRoot === filters.repositoryRoot))
      if (filters?.ids) return { rooms: eligible.filter((entry) => filters.ids!.includes(entry.id)).map((entry) => ({ ...entry })) }
      if (cursor) eligible = eligible.filter((entry) => entry.rank >= Number(cursor.slice('cursor-'.length)))
      const selected = eligible.slice(0, 50)
      return { rooms: selected.map((entry) => ({ ...entry })), nextCursor: eligible.length > 50 ? `cursor-${selected.at(-1)!.rank + 1}` : undefined }
    })
    return records
  }

  it('removes a newly read room through live events without losing later unread pages or rewinding the keyset cursor', async () => {
    connection.live = true
    const records = pagedRooms()
    await mount()
    await act(async () => state.setFilter('unread'))
    await act(async () => { await state.loadMoreRooms() })
    expect(state.rooms).toHaveLength(100)
    expect(state.roomCursor).toBe('cursor-100')
    records[0].unread = false
    client.list.mockClear()
    await act(async () => {
      events.forEach((listener) => listener({ seq: 20, roomId: 'room-0', kind: 'room.read' }))
      await vi.advanceTimersByTimeAsync(150)
    })
    expect(state.rooms.some((entry) => entry.id === 'room-0')).toBe(false)
    expect(state.rooms.some((entry) => entry.id === 'room-99')).toBe(true)
    expect(state.rooms).toHaveLength(99)
    expect(state.roomCursor).toBe('cursor-100')
    expect(client.list).toHaveBeenCalledWith(false, undefined, undefined, '', expect.objectContaining({ unreadOnly: true, ids: ['room-0'] }))
    await act(async () => { await state.loadMoreRooms() })
    expect(client.list).toHaveBeenLastCalledWith(false, 'cursor-100', undefined, '', expect.objectContaining({ unreadOnly: true }))
    expect(state.rooms.at(-1)?.id).toBe('room-100')
    expect(state.roomCursor).toBeNull()
  })

  it('revalidates changed repository-filtered rows while retaining eligible loaded pages and their next cursor', async () => {
    connection.live = true
    const records = pagedRooms()
    await mount()
    await act(async () => state.setRepositoryRoot('/repository'))
    await act(async () => { await state.loadMoreRooms() })
    records[75].name = 'Renamed in the loaded tail'
    records[80].repositoryRoot = '/another-repository'
    client.list.mockClear()
    await act(async () => {
      for (const id of ['room-75', 'room-80']) events.forEach((listener) => listener({ seq: 21, roomId: id, kind: 'room.updated' }))
      await vi.advanceTimersByTimeAsync(150)
    })
    expect(state.rooms).toHaveLength(99)
    expect(state.rooms.find((entry) => entry.id === 'room-75')?.name).toBe('Renamed in the loaded tail')
    expect(state.rooms.some((entry) => entry.id === 'room-80')).toBe(false)
    expect(state.rooms.some((entry) => entry.id === 'room-99')).toBe(true)
    expect(state.roomCursor).toBe('cursor-100')
    expect(client.list).toHaveBeenCalledWith(false, undefined, undefined, '', expect.objectContaining({ repositoryRoot: '/repository', ids: ['room-75', 'room-80'] }))
    expect(client.list.mock.calls.filter((call) => call[4]?.ids).every((call) => call[4].ids.length <= 50)).toBe(true)
    await act(async () => { await state.loadMoreRooms() })
    expect(client.list).toHaveBeenLastCalledWith(false, 'cursor-100', undefined, '', expect.objectContaining({ repositoryRoot: '/repository' }))
    expect(state.rooms.at(-1)?.id).toBe('room-100')
  })

  it('finishes a deferred next page after a same-scope background refresh and revalidates its current membership', async () => {
    connection.live = true
    const records = pagedRooms()
    await mount()
    await act(async () => state.setRepositoryRoot('/repository'))
    const normalList = client.list.getMockImplementation()!
    const stalePage = await normalList(false, 'cursor-50', undefined, '', { repositoryRoot: '/repository' })
    let release!: (value: unknown) => void
    const deferredPage = new Promise((resolve) => { release = resolve })
    client.list.mockImplementation((...args) => args[1] === 'cursor-50' ? deferredPage : normalList(...args))
    let paging!: Promise<void>
    act(() => { paging = state.loadMoreRooms() })
    expect(state.moreBusy).toBe(true)
    records[75].name = 'Updated while the page was in flight'
    records[80].repositoryRoot = '/another-repository'
    await act(async () => {
      for (const id of ['room-75', 'room-80']) events.forEach((listener) => listener({ seq: 22, roomId: id, kind: 'room.updated' }))
      await vi.advanceTimersByTimeAsync(150)
    })
    expect(state.rooms).toHaveLength(50)
    await act(async () => { release(stalePage); await paging })
    expect(state.rooms).toHaveLength(99)
    expect(state.rooms.find((entry) => entry.id === 'room-75')?.name).toBe('Updated while the page was in flight')
    expect(state.rooms.some((entry) => entry.id === 'room-80')).toBe(false)
    expect(state.rooms.some((entry) => entry.id === 'room-99')).toBe(true)
    expect(state.roomCursor).toBe('cursor-100')
    expect(state.moreBusy).toBe(false)
    const validation = client.list.mock.calls.find((call) => call[4]?.ids?.length === 50)
    expect(validation?.[4]).toMatchObject({ repositoryRoot: '/repository', ids: Array.from({ length: 50 }, (_, index) => `room-${index + 50}`) })
    await act(async () => { await state.loadMoreRooms() })
    expect(client.list).toHaveBeenLastCalledWith(false, 'cursor-100', undefined, '', expect.objectContaining({ repositoryRoot: '/repository' }))
    expect(state.rooms.at(-1)?.id).toBe('room-100')
  })

  it.each(['user', 'member'])('refreshes an old loaded root count from a new %s reply without rereading history or losing its cursor', async (authorKind) => {
    connection.live = true
    const latest = Array.from({ length: 50 }, (_, index) => ({ id: `recent-${index}`, roomId: 'room-a',
      body: `Recent ${index}`, bodyRevision: 0, messageSeq: 100 + index }))
    client.messages.mockResolvedValue({ messages: latest, nextCursor: '100' })
    await mount()
    const root = { id: 'old-root', roomId: 'room-a', body: 'Old root', bodyRevision: 0, messageSeq: 1, replyCount: 1 }
    client.messages.mockResolvedValueOnce({ messages: [root], nextCursor: '1' })
    await act(async () => { await state.loadEarlier() })
    const reply = { id: 'new-reply', roomId: 'room-a', authorKind, body: 'A new reply', bodyRevision: 0,
      messageSeq: 150, replyToMessageId: 'old-root', displayThreadRootId: 'old-root' }
    client.messages.mockResolvedValue({ messages: [...latest.slice(1), reply], nextCursor: '101' })
    client.request.mockResolvedValue({ messages: [{ ...root, replyCount: 2 }] })
    const historyCalls = client.messages.mock.calls.length
    await act(async () => {
      events.forEach((listener) => listener({ seq: 30, roomId: 'room-a', kind: 'message.created' }))
      await vi.advanceTimersByTimeAsync(150)
    })
    expect(state.messages.find((message) => message.id === root.id)?.replyCount).toBe(2)
    expect(state.messages.some((message) => message.id === 'recent-0')).toBe(true)
    expect(state.messages.some((message) => message.id === reply.id)).toBe(true)
    expect(state.messageCursor).toBe('1')
    expect(client.messages).toHaveBeenCalledTimes(historyCalls + 1)
    expect(client.messages).toHaveBeenLastCalledWith('room-a', undefined, expect.any(AbortSignal))
    expect(client.request).toHaveBeenCalledWith('/v1/rooms/room-a/messages?message_ids=old-root', 'GET', undefined, expect.any(AbortSignal))
    await act(async () => {
      events.forEach((listener) => listener({ seq: 31, roomId: 'room-a', kind: 'message.created' }))
      await vi.advanceTimersByTimeAsync(150)
    })
    expect(client.request).toHaveBeenCalledTimes(1)
  })

  it('retains a newly received reply and retries a failed root-count projection on the next refresh', async () => {
    await mount()
    const root = { id: 'old-root', roomId: 'room-a', body: 'Old root', bodyRevision: 0, messageSeq: 1 }
    client.messages.mockResolvedValueOnce({ messages: [root] })
    await act(async () => { await state.loadEarlier() })
    const reply = { id: 'reply', roomId: 'room-a', body: 'Reply', bodyRevision: 0, messageSeq: 3, displayThreadRootId: root.id }
    client.messages.mockResolvedValue({ messages: [reply] })
    client.request.mockRejectedValueOnce(new Error('Reply projection unavailable'))
    await act(async () => { await state.refresh() })
    expect(state.error).toBe('Reply projection unavailable')
    expect(state.messages.some((message) => message.id === reply.id)).toBe(true)
    client.request.mockResolvedValue({ messages: [{ ...root, replyCount: 1 }] })
    await act(async () => { await state.refresh() })
    expect(state.messages.find((message) => message.id === root.id)?.replyCount).toBe(1)
    expect(state.error).toBe('')
  })

  it('keeps earlier pages when the latest page refreshes and stops polling on unmount', async () => {
    await mount()
    client.messages.mockResolvedValueOnce({
      messages: [{ id: 'm1', messageSeq: 1, bodyRevision: 0, body: 'Earlier' }]
    })
    await act(async () => {
      await state.loadEarlier()
    })
    expect(state.messages.map((message) => message.id)).toEqual(['m1', 'm2'])
    client.tasks.mockResolvedValueOnce({
      tasks: [{ id: 'task1', revision: 1, updatedAt: '2026-09-11T00:00:00Z' }]
    })
    await act(async () => {
      await state.loadMoreTasks()
    })
    expect(state.tasks.map((task) => task.id)).toEqual(['task2', 'task1'])
    await act(async () => {
      await state.refresh()
    })
    expect(state.messages.map((message) => message.id)).toEqual(['m1', 'm2'])
    expect(state.tasks.map((task) => task.id)).toEqual(['task2', 'task1'])
    act(() => renderer.unmount())
    const calls = client.messages.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000)
    })
    expect(client.messages).toHaveBeenCalledTimes(calls)
  })

  it('does not let an old room response replace the newly selected room', async () => {
    let resolveOld!: (value: unknown) => void
    client.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        })
    )
    await mount()
    await act(async () => {
      state.select('room-b')
    })
    expect(state.room?.id).toBe('room-b')
    await act(async () => {
      resolveOld({ room })
    })
    expect(state.room?.id).toBe('room-b')
  })

  it('retains real messages and displays a failed refresh without inventing a reply', async () => {
    await mount()
    client.messages.mockRejectedValueOnce(new Error('Runtime unavailable'))
    await act(async () => {
      await state.refresh()
    })
    expect(state.error).toBe('Runtime unavailable')
    expect(state.messages.map((message) => message.body)).toEqual(['Latest'])
  })

  it.each(['message.created', 'message.updated'])('refreshes list previews on %s without fetching other rooms histories', async (kind) => {
    await mount()
    const latestMessage = { id: 'latest', authorKind: 'member', authorMemberId: 'reviewer',
      authorLabelSnapshot: 'Reviewer', preview: 'Updated review', createdAt: '2026-09-13T00:00:00Z', attachmentCount: 0 }
    client.list.mockResolvedValueOnce({ rooms: [{ ...room, latestMessage }] })
    const historyCalls = client.messages.mock.calls.length
    const listCalls = client.list.mock.calls.length
    await act(async () => {
      events.forEach((listener) => listener({ seq: 10, roomId: 'room-b', kind }))
      events.forEach((listener) => listener({ seq: 11, roomId: 'room-b', kind }))
      await vi.advanceTimersByTimeAsync(150)
    })
    expect(client.list).toHaveBeenCalledTimes(listCalls + 1)
    expect(client.messages).toHaveBeenCalledTimes(historyCalls)
    expect(state.rooms[0].latestMessage).toEqual(latestMessage)
  })
})
