import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoomPeerTopicSummary } from '@shared/rooms-api'
import { useRoomTopics } from './useRoomTopics'

const api = vi.hoisted(() => ({
  topics: vi.fn(),
  listener: null as null | ((event: { roomId: string; kind: string }) => void)
}))
vi.mock('./rooms-client', () => ({ roomsClient: { topics: api.topics } }))
vi.mock('./useRoomEvents', () => ({
  roomEventsLive: () => true,
  subscribeRoomEvents: (listener: typeof api.listener) => {
    api.listener = listener
    return () => {
      api.listener = null
    }
  }
}))
const topic = (id: string, revision = 1) =>
  ({ rootRequestId: id, revision, createdAt: id }) as RoomPeerTopicSummary

describe('Room topic resource', () => {
  let renderer: ReactTestRenderer
  let state: ReturnType<typeof useRoomTopics>
  function Harness({ roomId }: { roomId: string }) {
    state = useRoomTopics(roomId)
    return null
  }
  beforeEach(() => {
    vi.useFakeTimers()
    api.topics.mockReset()
    api.listener = null
  })
  afterEach(() => {
    if (renderer) act(() => renderer.unmount())
    vi.useRealTimers()
  })
  it('aborts old room reads and ignores their late results', async () => {
    let resolveOld!: (value: { topics: RoomPeerTopicSummary[] }) => void
    api.topics.mockImplementation((id: string) =>
      id === 'old'
        ? new Promise((resolve) => {
            resolveOld = resolve
          })
        : Promise.resolve({ topics: [topic('new-topic')] })
    )
    await act(async () => {
      renderer = create(createElement(Harness, { roomId: 'old' }))
    })
    const oldSignal = api.topics.mock.calls[0][2] as AbortSignal
    await act(async () => {
      renderer.update(createElement(Harness, { roomId: 'new' }))
    })
    expect(oldSignal.aborted).toBe(true)
    expect(state.topics.map((item) => item.rootRequestId)).toEqual([
      'new-topic'
    ])
    await act(async () => {
      resolveOld({ topics: [topic('old-topic')] })
    })
    expect(state.topics.map((item) => item.rootRequestId)).toEqual([
      'new-topic'
    ])
  })
  it('coalesces peer events, ignores other rooms and streaming updates, and refreshes loaded pages', async () => {
    api.topics.mockImplementation((_id: string, cursor?: string) =>
      Promise.resolve(
        cursor
          ? { topics: [topic('older', 2)] }
          : { topics: [topic('newest', 3)], nextCursor: 'page2' }
      )
    )
    await act(async () => {
      renderer = create(createElement(Harness, { roomId: 'room' }))
    })
    await act(async () => state.loadMore())
    expect(state.topics.map((item) => item.rootRequestId)).toHaveLength(2)
    expect(state.nextCursor).toBeNull()
    api.topics.mockClear()
    act(() => {
      api.listener!({ roomId: 'other', kind: 'peer.changed' })
      api.listener!({ roomId: 'room', kind: 'message.updated' })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(api.topics).not.toHaveBeenCalled()
    act(() => {
      api.listener!({ roomId: 'room', kind: 'peer.changed' })
      api.listener!({ roomId: 'room', kind: 'peer.changed' })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })
    expect(api.topics).toHaveBeenCalledTimes(2)
    expect(api.topics.mock.calls.map((call) => call[1])).toEqual([
      undefined,
      'page2'
    ])
    expect(state.nextCursor).toBeNull()
  })
  it('retains a usable topic snapshot when refresh fails', async () => {
    api.topics.mockResolvedValue({ topics: [topic('topic')] })
    await act(async () => {
      renderer = create(createElement(Harness, { roomId: 'room' }))
    })
    api.topics.mockRejectedValue(new Error('Disconnected'))
    await act(async () => state.refresh())
    expect(state.error).toBe('Disconnected')
    expect(state.topics).toHaveLength(1)
  })
})
