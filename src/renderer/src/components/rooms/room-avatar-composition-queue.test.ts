import { afterEach, describe, expect, it, vi } from 'vitest'
import { KUN_AVATAR_DEFAULT_PARTS } from '@shared/rooms-api'
import type { AvatarCompositionResource } from './room-avatar-composition-cache'

const render = vi.hoisted(() => vi.fn())
vi.mock('./room-avatar-composition-canvas', () => ({ renderAvatarComposition: render }))
import { acquireComposedAvatar, avatarRenderRequest, composedAvatarCache } from './room-avatar-compositor'

afterEach(() => { composedAvatarCache.clear(); render.mockReset() })

describe('avatar composition scheduling', () => {
  it('skips abandoned queued choices while keeping a shared pending preview alive', async () => {
    const resolve = new Map<string, (resource: AvatarCompositionResource) => void>()
    render.mockImplementation((_urls: string[], options: { bg: string }) => new Promise((done) => resolve.set(options.bg, done)))
    const requests = Array.from({ length: 7 }, (_, index) => avatarRenderRequest({
      ...KUN_AVATAR_DEFAULT_PARTS, bg: `#00000${index}`
    }, 96, 1))
    const leases = requests.map(acquireComposedAvatar)
    const outcomes = leases.map((lease) => lease.promise.then((url) => url, () => 'cancelled'))
    const shared = acquireComposedAvatar(requests[5])
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(4))
    leases[4].release()
    leases[5].release()
    const finish = (bg: string) => resolve.get(bg)!({ url: `blob:${bg}`, bytes: 1, dispose: vi.fn() })
    finish('#000000')
    await vi.waitFor(() => expect(resolve.has('#000005')).toBe(true))
    expect(resolve.has('#000004')).toBe(false)
    finish('#000001')
    await vi.waitFor(() => expect(resolve.has('#000006')).toBe(true))
    for (const bg of ['#000002', '#000003', '#000005', '#000006']) finish(bg)
    expect(await outcomes[4]).toBe('cancelled')
    await expect(shared.promise).resolves.toBe('blob:#000005')
    await Promise.all(outcomes)
    for (const lease of leases) lease.release()
    shared.release()
    expect(render).toHaveBeenCalledTimes(6)
  })
})
