import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRoomResource } from './useRoomResource'
const state = vi.hoisted(() => ({ request: vi.fn(), event: undefined as undefined | ((event: unknown) => void) }))
vi.mock('./rooms-client', () => ({ roomsRequest: state.request, roomRequestId: () => 'request' }))
vi.mock('./useRoomEvents', () => ({ roomEventsLive: () => true, subscribeRoomEvents: (listener: (event: unknown) => void) => {
  state.event = listener; return () => { state.event = undefined }
} }))
let renderer: ReactTestRenderer
afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.useRealTimers() })
describe('in-flight room resource invalidation', () => {
  it('fetches fresh state when an update arrives before the previous read finishes', async () => {
    vi.useFakeTimers()
    let resolve!: (value: unknown) => void
    state.request.mockReset().mockImplementationOnce(() => new Promise((done) => { resolve = done }))
      .mockResolvedValue({ revision: 2 })
    function View() {
      const value = useRoomResource<{ revision: number }>('room', '/v1/rooms/room/tasks/task')
      return createElement('div', null, String(value.data?.revision ?? 0))
    }
    await act(async () => { renderer = create(createElement(View)) })
    await act(async () => {
      state.event?.({ roomId: 'room', kind: 'task.updated', payload: { id: 'task' } })
      await vi.advanceTimersByTimeAsync(150)
    })
    await act(async () => { resolve({ revision: 1 }) })
    expect(state.request).toHaveBeenCalledTimes(2)
    expect(renderer.root.findByType('div').children).toEqual(['2'])
  })
})
