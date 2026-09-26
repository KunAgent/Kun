import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RoomSidebarQuery } from '@shared/rooms-api'
import { useRoomSidebar } from './useRoomSidebar'
const mocks = vi.hoisted(() => ({ request: vi.fn(), subscribe: vi.fn() }))
vi.mock('./rooms-client', () => ({ roomsRequest: mocks.request }))
vi.mock('./useRoomEvents', () => ({ subscribeRoomEvents: mocks.subscribe, roomEventsLive: () => true }))
let renderer: ReactTestRenderer, value: ReturnType<typeof useRoomSidebar>
function Probe({ query = {}, selected = '' }: { query?: RoomSidebarQuery; selected?: string }) { value = useRoomSidebar(query, selected); return null }
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mocks.request.mockReset(); mocks.subscribe.mockReturnValue(() => {}) })
afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.useRealTimers(); vi.unstubAllGlobals() })
async function flush() { await act(async () => { await vi.advanceTimersByTimeAsync(250) }) }
it('refreshes an initially empty list after initialization navigates before SSE is connected', async () => {
  mocks.request.mockResolvedValueOnce({ entries: [] })
  await act(async () => { renderer = create(createElement(Probe)) }); await flush()
  expect(value.entries).toEqual([])
  mocks.request.mockResolvedValueOnce({ entries: [{ id: 'agent:a', roomId: 'direct' }] })
  await act(async () => renderer.update(createElement(Probe, { selected: 'direct' }))); await flush()
  expect(value.entries.map((entry) => entry.id)).toEqual(['agent:a'])
  expect(mocks.request.mock.calls.every((call) => call[1] === 'GET')).toBe(true)
})
it('cancels an old query and discards its late response', async () => {
  let resolve!: (page: unknown) => void
  mocks.request.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  await act(async () => { renderer = create(createElement(Probe, { query: { search: 'old' } })) }); await flush()
  const signal = mocks.request.mock.calls[0][3]
  mocks.request.mockResolvedValueOnce({ entries: [{ id: 'new' }] })
  await act(async () => renderer.update(createElement(Probe, { query: { search: 'new' } }))); await flush()
  expect(signal.aborted).toBe(true)
  await act(async () => resolve({ entries: [{ id: 'old' }] }))
  expect(value.entries.map((entry) => entry.id)).toEqual(['new'])
})
it('clears a transient error after a successful refresh and keeps loaded pages in one cursor chain', async () => {
  mocks.request.mockRejectedValueOnce(new Error('offline'))
  await act(async () => { renderer = create(createElement(Probe)) }); await flush()
  expect(value.error).toContain('offline')
  mocks.request.mockResolvedValueOnce({ entries: [{ id: 'a' }], nextCursor: 'next' })
  act(() => value.refresh()); await flush()
  expect(value.error).toBe('')
  mocks.request.mockResolvedValueOnce({ entries: [{ id: 'a' }], nextCursor: 'next' }).mockResolvedValueOnce({ entries: [{ id: 'b' }] })
  act(() => value.more()); await flush()
  expect(value.entries.map((entry) => entry.id)).toEqual(['a', 'b'])
  expect(mocks.request.mock.calls.at(-1)![0]).toContain('cursor=next')
})
it('does not starve status refreshes during a stream of presentation updates', async () => {
  mocks.request.mockResolvedValue({ entries: [] })
  await act(async () => { renderer = create(createElement(Probe)) }); await flush()
  const event = mocks.subscribe.mock.calls.at(-1)![0]
  for (let i = 0; i < 10; i++) await act(async () => {
    event({ kind: 'message.updated' }); await vi.advanceTimersByTimeAsync(100)
  })
  expect(mocks.request.mock.calls.length).toBeGreaterThan(2)
  expect(mocks.request.mock.calls.length).toBeLessThanOrEqual(4)
})
