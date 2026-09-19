import { beforeEach, expect, it, vi } from 'vitest'
import type { Room, RoomSidebarEntry } from '@shared/rooms-api'
import { RoomSidebarPins } from './room-sidebar-pins'
const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }))
vi.mock('./rooms-client', () => ({ roomsRequest: vi.fn(), roomRequestId: () => crypto.randomUUID(), roomsClient: mocks }))
const entry = (id: string, seq: number, pinned = false) => ({ id, roomId: id, pinned, activitySeq: seq, latestMessageSeq: seq } as RoomSidebarEntry)
const room = (id: string, pinned = false) => ({ id, pinned, revision: 1 } as Room)
beforeEach(() => { mocks.get.mockReset(); mocks.update.mockReset() })
it('moves immediately, overlays stale SSE snapshots and retires only after a post-save query', async () => {
  let resolve!: (value: { room: Room }) => void
  mocks.get.mockImplementation(() => new Promise((done) => { resolve = done }))
  mocks.update.mockResolvedValue({ room: room('old', true) })
  const entries = [entry('new', 20), entry('old', 10)], pins = new RoomSidebarPins(vi.fn(), vi.fn(), vi.fn())
  pins.toggle(entries[1])
  expect(pins.project(entries).map((item) => item.id)).toEqual(['old', 'new'])
  const stale = pins.checkpoint()
  resolve({ room: room('old') }); await vi.waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1))
  pins.received(stale)
  expect(pins.project(entries)[0].pinned).toBe(true)
  const fresh = pins.checkpoint(); pins.received(fresh)
  expect(pins.project(entries)[0].id).toBe('new')
})
it('coalesces rapid toggles to the latest intent without concurrent writes', async () => {
  let resolve!: (value: { room: Room }) => void
  mocks.get.mockResolvedValue({ room: room('one') })
  mocks.update.mockImplementationOnce(() => new Promise((done) => { resolve = done })).mockResolvedValue({ room: room('one') })
  const item = entry('one', 1), pins = new RoomSidebarPins(vi.fn(), vi.fn(), vi.fn())
  pins.toggle(item); await vi.waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1))
  pins.toggle(pins.project([item])[0])
  expect(pins.project([item])[0].pinned).toBe(false)
  expect(mocks.update).toHaveBeenCalledTimes(1)
  resolve({ room: room('one', true) })
  await vi.waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2))
  expect(mocks.update.mock.calls[1][1]).toEqual({ pinned: false })
})
it('rolls back a failed pin without reverting another pending entry', async () => {
  mocks.get.mockImplementation((id) => id === 'bad' ? Promise.reject(new Error('offline')) : new Promise(() => {}))
  const failed = vi.fn(), items = [entry('bad', 20), entry('good', 10)]
  const pins = new RoomSidebarPins(vi.fn(), vi.fn(), failed)
  pins.toggle(items[0]); pins.toggle(items[1])
  await vi.waitFor(() => expect(failed).toHaveBeenCalledWith(expect.stringContaining('offline')))
  expect(pins.project(items).map((item) => [item.id, item.pinned])).toEqual([['good', true], ['bad', false]])
})
