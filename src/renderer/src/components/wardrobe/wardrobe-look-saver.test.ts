/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoomAvatarReference } from '@shared/rooms-api'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../rooms/rooms-client', () => ({ roomsRequest: mocks.request, roomRequestId: () => 'request-id' }))

import { useRoomUserProfile } from '../rooms/room-user-profile'
import { createWardrobeLookSaver } from './wardrobe-look-saver'

const look = (headwear: string): RoomAvatarReference =>
  ({ kind: 'composed', version: 1, parts: { color: 'sky', face: 'normal', bg: '#eef6ff', headwear } } as RoomAvatarReference)
const echo = async (_path: string, method?: string, body?: { avatar: RoomAvatarReference; expectedRevision: number }) =>
  method === 'PUT' ? { profile: { avatar: body!.avatar }, revision: body!.expectedRevision + 1 } : { profile: { avatar: null }, revision: 9 }

describe('wardrobe look saver', () => {
  beforeEach(() => {
    mocks.request.mockReset()
    useRoomUserProfile.setState({ profile: { avatar: null }, revision: 1 })
  })

  it('ends a burst of choices on the last look, saved against the newest revision', async () => {
    let release: (value: unknown) => void = () => undefined
    mocks.request.mockImplementationOnce(() => new Promise((resolve) => { release = resolve })).mockImplementation(echo)
    const onIdle = vi.fn(), onError = vi.fn()
    const saver = createWardrobeLookSaver({ onIdle, onError })
    saver.save(look('beret')); saver.save(look('hood')); saver.save(look('laurel'))
    release({ profile: { avatar: look('beret') }, revision: 2 })
    await vi.waitFor(() => expect(onIdle).toHaveBeenCalledOnce())
    const puts = mocks.request.mock.calls.filter((call) => call[1] === 'PUT')
    expect(puts.map((call) => (call[2].avatar.parts as { headwear: string }).headwear)).toEqual(['beret', 'laurel'])
    expect(puts[1]![2].expectedRevision).toBe(2)
    expect(useRoomUserProfile.getState().profile.avatar).toEqual(look('laurel'))
    expect(onError).not.toHaveBeenCalled()
  })

  it('reloads the profile and retries once when the revision is stale', async () => {
    mocks.request.mockRejectedValueOnce(new Error('revision conflict')).mockImplementation(echo)
    const onIdle = vi.fn(), onError = vi.fn()
    createWardrobeLookSaver({ onIdle, onError }).save(look('beret'))
    await vi.waitFor(() => expect(onIdle).toHaveBeenCalledOnce())
    expect(mocks.request.mock.calls.map((call) => call[1] ?? 'GET')).toEqual(['PUT', 'GET', 'PUT'])
    expect(mocks.request.mock.calls[2]![2].expectedRevision).toBe(9)
  })

  it('reports a save that still fails after the retry', async () => {
    mocks.request.mockImplementation(async (_path: string, method?: string) => {
      if (method === 'PUT') throw new Error('offline')
      return { profile: { avatar: null }, revision: 4 }
    })
    const onIdle = vi.fn(), onError = vi.fn()
    createWardrobeLookSaver({ onIdle, onError }).save(null)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('Error: offline'))
    expect(onIdle).not.toHaveBeenCalled()
  })
})
