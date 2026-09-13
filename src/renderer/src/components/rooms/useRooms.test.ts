import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRooms } from './useRooms'

const client = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  messages: vi.fn(),
  tasks: vi.fn(),
  rules: vi.fn()
}))
vi.mock('./rooms-client', async (original) => ({
  ...(await original<typeof import('./rooms-client')>()),
  roomsClient: client
}))
const events = vi.hoisted(() => new Set<(event: { seq: number; roomId: string; kind: string }) => void>())
vi.mock('./useRoomEvents', () => ({
  roomEventsLive: () => false,
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
