import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RoomAvatarReference } from '@shared/rooms-api'
import type { AvatarCompositionLease } from './room-avatar-composition-cache'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
  clear() { this.values.clear() }
}
const world = vi.hoisted(() => ({
  wardrobe: { mode: 'account' as 'account' | 'guest', modeKnown: true },
  uploaded: undefined as string | undefined,
  face: undefined as string | undefined,
  lease: undefined as { lease: AvatarCompositionLease; resolve: (url: string) => void } | undefined,
  faceDataUrl: vi.fn()
}))
vi.stubGlobal('window', { localStorage: new MemoryStorage() })

vi.mock('./room-wardrobe', async (importOriginal) => ({ ...await importOriginal<typeof import('./room-wardrobe')>(),
  useWardrobe: () => ({ ...world.wardrobe, unlockAll: false, wardrobe: null, revision: null, error: '', loaded: world.wardrobe.modeKnown }) }))
vi.mock('./room-uploaded-avatar', () => ({ useRoomUploadedAvatar: () => world.uploaded }))
vi.mock('./room-avatar-compositor', () => ({
  avatarRenderRequest: (parts: { face: string }, size: number) => ({ key: `${parts.face}:${size}`, pixels: size * 2 }),
  acquireComposedAvatar: () => world.lease!.lease
}))
vi.mock('./room-user-avatar-cache', async (importOriginal) => ({ ...await importOriginal<typeof import('./room-user-avatar-cache')>(),
  faceDataUrl: world.faceDataUrl }))

const { RoomAvatar } = await import('./RoomAvatar')
const { useRoomUserProfile } = await import('./room-user-profile')
const cache = await import('./room-user-avatar-cache')

const explorer: RoomAvatarReference = { kind: 'builtin', id: 'explorer' }
const normal = { kind: 'composed', version: 1, parts: { color: 'sky', face: 'normal', bg: '#f7f5ef' } } as RoomAvatarReference
const uploaded: RoomAvatarReference = { kind: 'uploaded', attachmentId: 'att_aaaaaaaaaaaaaaaaaaaaaaaa' }
let renderer: ReactTestRenderer | undefined

function pendingComposition() {
  let resolve!: (url: string) => void
  const promise = new Promise<string>((res) => { resolve = res })
  world.lease = { lease: { promise, release: vi.fn() }, resolve }
}
const userAvatar = (props: Record<string, unknown> = {}) => createElement(RoomAvatar, { id: 'user', label: 'You', size: 38, ...props })

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  ;(window as unknown as { localStorage: MemoryStorage }).localStorage.clear()
  cache.resetUserAvatarCacheForTests()
  world.wardrobe = { mode: 'account', modeKnown: true }
  world.uploaded = undefined
  world.faceDataUrl.mockReset()
  pendingComposition()
  useRoomUserProfile.setState({ profile: { avatar: null }, revision: null })
})
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
})

it('paints the remembered look until the wardrobe says the user is really a guest', async () => {
  world.wardrobe = { mode: 'guest', modeKnown: false }
  useRoomUserProfile.setState({ profile: { avatar: explorer }, revision: null })
  await act(async () => { renderer = create(userAvatar()) })
  expect(renderer!.root.findAllByProps({ 'data-avatar-id': 'explorer' })).toHaveLength(1)

  world.wardrobe = { mode: 'guest', modeKnown: true }
  await act(async () => renderer!.update(userAvatar()))
  expect(renderer!.root.findAllByProps({ 'data-avatar-id': 'explorer' })).toHaveLength(0)
  expect(renderer!.root.findByType('img').props.src).toContain('kun_greet.png')
})

it('shows the saved face of a composed look on the first frame, before anything is drawn', async () => {
  cache.rememberUserAvatar(normal)
  cache.rememberFace(normal, 'normal:38', 'data:image/png;base64,saved')
  useRoomUserProfile.setState({ profile: { avatar: normal }, revision: null })
  world.faceDataUrl.mockResolvedValue('data:image/png;base64,saved')
  await act(async () => { renderer = create(userAvatar()) })
  expect(renderer!.root.findByType('img').props.src).toBe('data:image/png;base64,saved')

  // The fresh render matches the saved one, so nothing is swapped.
  await act(async () => world.lease!.resolve('blob:fresh'))
  expect(world.faceDataUrl).toHaveBeenCalledWith('blob:fresh', 76)
  expect(renderer!.root.findByType('img').props.src).toBe('data:image/png;base64,saved')
})

it('replaces the saved face when the artwork drew something different', async () => {
  cache.rememberUserAvatar(normal)
  cache.rememberFace(normal, 'normal:38', 'data:image/png;base64,old')
  useRoomUserProfile.setState({ profile: { avatar: normal }, revision: null })
  world.faceDataUrl.mockResolvedValue('data:image/png;base64,new')
  await act(async () => { renderer = create(userAvatar()) })
  await act(async () => world.lease!.resolve('blob:fresh'))
  expect(renderer!.root.findByType('img').props.src).toBe('blob:fresh')
  expect(cache.rememberedFace(normal, 'normal:38')).toBe('data:image/png;base64,new')
})

it('saves the first face of a look drawn after a change', async () => {
  cache.rememberUserAvatar(normal)
  useRoomUserProfile.setState({ profile: { avatar: normal }, revision: null })
  world.faceDataUrl.mockResolvedValue('data:image/png;base64,first')
  await act(async () => { renderer = create(userAvatar()) })
  expect(renderer!.root.findByType('img').props.src).toContain('kun_greet.png')
  await act(async () => world.lease!.resolve('blob:fresh'))
  expect(renderer!.root.findByType('img').props.src).toBe('blob:fresh')
  expect(cache.rememberedFace(normal, 'normal:38')).toBe('data:image/png;base64,first')
})

it('shows and saves the uploaded portrait of the user\'s own look', async () => {
  cache.rememberUserAvatar(uploaded)
  cache.rememberFace(uploaded, 'uploaded', 'data:image/jpeg;base64,saved')
  useRoomUserProfile.setState({ profile: { avatar: uploaded }, revision: null })
  await act(async () => { renderer = create(userAvatar()) })
  expect(renderer!.root.findByType('img').props.src).toBe('data:image/jpeg;base64,saved')

  world.uploaded = 'data:image/jpeg;base64,live'
  await act(async () => renderer!.update(userAvatar()))
  expect(renderer!.root.findByType('img').props.src).toBe('data:image/jpeg;base64,live')
  expect(cache.rememberedFace(uploaded, 'uploaded')).toBe('data:image/jpeg;base64,live')
})

it('never remembers previews, other people or agents', async () => {
  cache.rememberUserAvatar(normal)
  world.faceDataUrl.mockResolvedValue('data:image/png;base64,other')
  await act(async () => { renderer = create(userAvatar({ avatar: normal, id: 'preview', user: true })) })
  await act(async () => world.lease!.resolve('blob:preview'))
  expect(world.faceDataUrl).not.toHaveBeenCalled()
  expect(cache.rememberedFace(normal, 'normal:38')).toBeUndefined()

  pendingComposition()
  await act(async () => renderer!.update(createElement(RoomAvatar, { id: 'agent-1', label: 'Agent', size: 38, avatar: normal })))
  await act(async () => world.lease!.resolve('blob:agent'))
  expect(world.faceDataUrl).not.toHaveBeenCalled()
})
