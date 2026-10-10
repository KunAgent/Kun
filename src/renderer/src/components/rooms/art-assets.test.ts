import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { receiveArtState } from './art-asset-store'
import { avatarRenderRequest, composeAvatar, composedAvatarLayerUrl } from './room-avatar-compositor'
import { fixture } from '../../../../main/art-assets/test-fixtures'
const canvas = vi.hoisted(() => vi.fn(async () => ({ url: 'blob:test', bytes: 1, dispose: () => {} })))
vi.mock('./room-avatar-composition-canvas', () => ({ renderAvatarComposition: canvas }))
let data: Awaited<ReturnType<typeof fixture>>
beforeAll(async () => { data = await fixture() })
afterEach(() => { receiveArtState({ phase: 'bundled', manifest: null, completed: 0, total: 0, rollbackAvailable: false, held: false }); canvas.mockClear() })
const apply = (releaseId: string) => receiveArtState({ phase: 'ready', manifest: { ...structuredClone(data.manifest), releaseId },
  completed: 453, total: 453, rollbackAvailable: true, held: false })
describe('art renderer version boundary', () => {
  it('keeps an in-flight composition on its original release during hot activation', async () => {
    apply('one')
    const request = avatarRenderRequest({ color: 'sky', face: 'normal', bg: '#ffffff' }, 96, 1)
    apply('two')
    await composeAvatar(request)
    const urls = (canvas.mock.calls as unknown as [string[]][])[0][0]
    expect(urls.every(url => url.startsWith('kun-asset://one/'))).toBe(true)
    expect(composedAvatarLayerUrl('base/sky', 128)).toMatch(/^kun-asset:\/\/two\//)
    expect(avatarRenderRequest(request.parts, 96, 1).key).not.toBe(request.key)
  })
  it('restores bundled image URLs after rollback to the installation resources', () => {
    apply('one')
    receiveArtState({ phase: 'bundled', manifest: null, completed: 0, total: 0, rollbackAvailable: false, held: true })
    expect(composedAvatarLayerUrl('base/sky', 128)).not.toMatch(/^kun-asset:/)
  })
})
