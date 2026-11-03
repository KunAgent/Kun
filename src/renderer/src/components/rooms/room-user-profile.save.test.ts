import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoomAvatarReference } from '@shared/rooms-api'

const mocks = vi.hoisted(() => ({ request: vi.fn(), canChange: vi.fn(() => true), syncLook: vi.fn() }))
vi.mock('./rooms-client', () => ({ roomsRequest: mocks.request, roomRequestId: () => 'request-id' }))
vi.mock('./room-wardrobe', async (importOriginal) => ({ ...await importOriginal<typeof import('./room-wardrobe')>(),
  canChangeKunAppearance: mocks.canChange, syncAccountLook: mocks.syncLook }))

import { acceptRoomUserProfile, saveRoomUserProfile, useRoomUserProfile } from './room-user-profile'

const composed: RoomAvatarReference = { kind: 'composed', version: 1, parts: { color: 'sky', face: 'normal', bg: '#f7f5ef' } }

describe('saveRoomUserProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.canChange.mockReturnValue(true)
    useRoomUserProfile.setState({ profile: { avatar: null }, revision: null })
  })

  it('saves through the runtime, publishes the saved profile and hands a composed look to the account', async () => {
    const saved = { profile: { avatar: composed }, revision: 3 }
    mocks.request.mockResolvedValueOnce(saved)
    const input = { avatar: composed, expectedRevision: 2, clientRequestId: 'save-1' }
    await expect(saveRoomUserProfile(input)).resolves.toEqual(saved)
    expect(mocks.request).toHaveBeenCalledWith('/v1/rooms/user-profile', 'PUT', input)
    expect(useRoomUserProfile.getState()).toEqual(saved)
    expect(mocks.syncLook).toHaveBeenCalledWith(composed.kind === 'composed' ? composed.parts : undefined)
  })

  it('keeps a photo on this machine: nothing is synced to the account', async () => {
    const photo: RoomAvatarReference = { kind: 'uploaded', attachmentId: 'att_' + 'a'.repeat(24) }
    mocks.request.mockResolvedValueOnce({ profile: { avatar: photo }, revision: 4 })
    await saveRoomUserProfile({ avatar: photo, expectedRevision: 3, clientRequestId: 'save-2' })
    expect(mocks.syncLook).not.toHaveBeenCalled()
  })

  it('refuses a signed-out user before anything is sent', async () => {
    mocks.canChange.mockReturnValue(false)
    await expect(saveRoomUserProfile({ avatar: composed, expectedRevision: null, clientRequestId: 'save-3' })).rejects.toThrow('anonymous')
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('never lets an older profile replace a newer one', () => {
    acceptRoomUserProfile({ profile: { avatar: composed }, revision: 5 })
    acceptRoomUserProfile({ profile: { avatar: null }, revision: 4 })
    expect(useRoomUserProfile.getState().revision).toBe(5)
  })
})
