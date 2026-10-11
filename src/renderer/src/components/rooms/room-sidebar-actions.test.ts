import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Room, RoomSidebarEntry } from '@shared/rooms-api'
import { setRoomSidebarEntryDeleted, toggleRoomSidebarEntryArchived } from './room-sidebar-actions'

const api = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), request: vi.fn() }))
vi.mock('./rooms-client', () => ({ roomsClient: { get: api.get, update: api.update }, roomsRequest: api.request }))

const room = { id: 'chat', revision: 3 } as Room
const entry = { id: 'room:chat', roomId: 'chat', agentId: 'agent', archived: false } as RoomSidebarEntry

beforeEach(() => {
  api.get.mockReset().mockResolvedValue({ room })
  api.update.mockReset().mockResolvedValue({ room })
  api.request.mockReset()
})

describe('conversation sidebar actions', () => {
  it('archives the chat without changing its Agent identity', async () => {
    await toggleRoomSidebarEntryArchived(entry)
    expect(api.update).toHaveBeenCalledWith(room, { archived: true })
    expect(api.request).not.toHaveBeenCalled()
  })

  it('moves only the chat to and from Recently deleted', async () => {
    await setRoomSidebarEntryDeleted(entry, true)
    await setRoomSidebarEntryDeleted({ ...entry, deleted: true }, false)
    expect(api.update.mock.calls.map(([, patch]) => patch)).toEqual([{ deleted: true }, { deleted: false }])
    expect(api.request).not.toHaveBeenCalled()
  })
})
