import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createKunWardrobe, type KunWardrobe } from '@shared/rooms-api'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('./rooms-client', () => ({ roomsRequest: mocks.request, roomRequestId: () => 'request-id' }))

import { WardrobeAccountError, acceptWardrobe, openWardrobeDrops, updateWardrobeSettings } from './room-wardrobe'
import { saveRoomUserProfile } from './room-user-profile'

const mirror: KunWardrobe = { ...createKunWardrobe(1), feathers: 40 }
const api = {
  sync: vi.fn(), open: vi.fn(), stash: vi.fn(), seen: vi.fn(), settings: vi.fn(), setLook: vi.fn(async () => ({ ok: true })),
  shop: vi.fn(), purchase: vi.fn(), invites: vi.fn(), claimInvite: vi.fn()
}
const parts = { color: 'sky' as const, face: 'normal' as const, bg: '#eef6ff', headwear: 'beret' as const }

beforeEach(() => {
  vi.stubGlobal('window', { kunGui: { kunAccount: { wardrobe: api } } })
  mocks.request.mockReset()
  mocks.request.mockImplementation(async (_path: string, method?: string, body?: { avatar: unknown }) =>
    method === 'PUT' ? { profile: { avatar: body!.avatar }, revision: 2 } : { wardrobe: mirror, revision: 1, mode: 'guest' })
  for (const fn of Object.values(api)) fn.mockClear()
})
afterEach(() => { vi.unstubAllGlobals() })

describe('wardrobe changes by owner', () => {
  it('sends a signed-in change to the account and keeps the mirror it returns', async () => {
    acceptWardrobe({ wardrobe: mirror, revision: 1, mode: 'account' })
    api.open.mockResolvedValueOnce({ ok: true, value: { wardrobe: { ...mirror, feathers: 55 }, revision: 2, mode: 'account', drops: [], feathers: 15 } })
    const result = await openWardrobeDrops(['bottle-1'])
    expect(api.open).toHaveBeenCalledWith(['bottle-1'])
    expect(result.feathers).toBe(15)
    expect(mocks.request).not.toHaveBeenCalled()
    api.settings.mockResolvedValueOnce({ ok: false, code: 'service' })
    await expect(updateWardrobeSettings({ drops: false })).rejects.toEqual(new WardrobeAccountError('service'))
  })

  it('keeps signed-out and debug changes on the local runtime', async () => {
    acceptWardrobe({ wardrobe: mirror, revision: 1, mode: 'local' })
    mocks.request.mockResolvedValueOnce({ wardrobe: mirror, revision: 2, drops: [] })
    await openWardrobeDrops(['drop-1'])
    expect(mocks.request).toHaveBeenCalledWith('/v1/rooms/wardrobe/open', 'POST', expect.objectContaining({ dropIds: ['drop-1'] }))
    expect(api.open).not.toHaveBeenCalled()
  })

  it('makes a saved composed look the account avatar only while signed in', async () => {
    acceptWardrobe({ wardrobe: mirror, revision: 1, mode: 'guest' })
    await expect(saveRoomUserProfile({ avatar: { kind: 'composed', version: 1, parts }, expectedRevision: 1, clientRequestId: 'a' })).rejects.toThrow('anonymous')
    expect(mocks.request).not.toHaveBeenCalled()
    expect(api.setLook).not.toHaveBeenCalled()
    acceptWardrobe({ wardrobe: mirror, revision: 1, mode: 'account' })
    await saveRoomUserProfile({ avatar: { kind: 'composed', version: 1, parts }, expectedRevision: 2, clientRequestId: 'b' })
    await saveRoomUserProfile({ avatar: null, expectedRevision: 3, clientRequestId: 'c' })
    expect(api.setLook).toHaveBeenCalledTimes(1)
    expect(api.setLook).toHaveBeenCalledWith(parts)
  })
})
