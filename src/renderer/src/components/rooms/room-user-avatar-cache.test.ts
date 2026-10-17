import { beforeEach, expect, it, vi } from 'vitest'
import type { RoomAvatarReference } from '@shared/rooms-api'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
  clear() { this.values.clear() }
}
// Node's own localStorage global shadows jsdom's, so the cache gets a stubbed window like the other storage tests.
const localStorage = new MemoryStorage()
const storageListeners: Array<(event: { key: string | null }) => void> = []
vi.stubGlobal('window', { localStorage, addEventListener: (_: string, listener: (event: { key: string | null }) => void) => storageListeners.push(listener) })
const {
  reconcileUserAvatarOwner, rememberedFace, rememberedUserAvatar, rememberFace, rememberUserAvatar,
  resetUserAvatarCacheForTests, userAvatarKey
} = await import('./room-user-avatar-cache')

const explorer: RoomAvatarReference = { kind: 'builtin', id: 'explorer' }
const designer: RoomAvatarReference = { kind: 'builtin', id: 'designer' }
const composed = (face: string): RoomAvatarReference => ({
  kind: 'composed', version: 1, parts: { color: 'sky', face, bg: '#f7f5ef' }
} as RoomAvatarReference)
const STORAGE_KEY = 'kun.rooms.userAvatar.v1'
/** What the next launch sees: the in-memory copy is gone, only storage is left. */
const restart = () => resetUserAvatarCacheForTests()

beforeEach(() => {
  localStorage.clear()
  restart()
})

it('remembers the look and its faces across a restart', () => {
  rememberUserAvatar(explorer)
  rememberFace(explorer, 'a', 'data:image/png;base64,aaa')
  restart()
  expect(rememberedUserAvatar()).toEqual(explorer)
  expect(rememberedFace(explorer, 'a')).toBe('data:image/png;base64,aaa')
})

it('keeps the faces while the look is unchanged and drops them when it changes', () => {
  rememberUserAvatar(explorer)
  rememberFace(explorer, 'a', 'data:a')
  rememberUserAvatar(explorer)
  expect(rememberedFace(explorer, 'a')).toBe('data:a')
  rememberUserAvatar(designer)
  expect(rememberedUserAvatar()).toEqual(designer)
  expect(rememberedFace(explorer, 'a')).toBeUndefined()
  expect(rememberedFace(designer, 'a')).toBeUndefined()
})

it('forgets everything when no look is chosen', () => {
  rememberUserAvatar(explorer)
  rememberUserAvatar(null)
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  restart()
  expect(rememberedUserAvatar()).toBeNull()
})

it('only saves a face for the look that is remembered, and bounds how many it keeps', () => {
  rememberFace(explorer, 'orphan', 'data:x')
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  rememberUserAvatar(explorer)
  rememberFace(designer, 'other', 'data:x')
  expect(rememberedFace(explorer, 'other')).toBeUndefined()
  rememberFace(explorer, 'huge', 'x'.repeat(300000))
  expect(rememberedFace(explorer, 'huge')).toBeUndefined()
  for (let index = 0; index < 9; index += 1) rememberFace(explorer, `face-${index}`, `data:${index}`)
  expect(rememberedFace(explorer, 'face-0')).toBeUndefined()
  expect(rememberedFace(explorer, 'face-2')).toBeUndefined()
  expect(rememberedFace(explorer, 'face-3')).toBe('data:3')
  expect(rememberedFace(explorer, 'face-8')).toBe('data:8')
})

it('treats the same composed look as one key however its parts are ordered', () => {
  const reordered = { kind: 'composed', version: 1, parts: { bg: '#f7f5ef', face: 'happy', color: 'sky' } } as RoomAvatarReference
  expect(userAvatarKey(composed('happy'))).toBe(userAvatarKey(reordered))
  expect(userAvatarKey(composed('happy'))).not.toBe(userAvatarKey(composed('normal')))
  rememberUserAvatar(composed('happy'))
  rememberFace(reordered, 'a', 'data:a')
  expect(rememberedFace(composed('happy'), 'a')).toBe('data:a')
})

it('keys the other kinds by what identifies them, not by property order', () => {
  expect(userAvatarKey({ attachmentId: 'att_aaaaaaaaaaaaaaaaaaaaaaaa', kind: 'uploaded' }))
    .toBe(userAvatarKey({ kind: 'uploaded', attachmentId: 'att_aaaaaaaaaaaaaaaaaaaaaaaa' }))
  expect(userAvatarKey(explorer)).not.toBe(userAvatarKey(designer))
})

it('drops the record for signed-out users and other accounts, and keeps it for the owner', () => {
  reconcileUserAvatarOwner('user-1')
  rememberUserAvatar(explorer)
  restart()
  expect(reconcileUserAvatarOwner('user-1')).toBe(false)
  expect(rememberedUserAvatar()).toEqual(explorer)
  expect(reconcileUserAvatarOwner('user-2')).toBe(true)
  expect(rememberedUserAvatar()).toBeNull()

  rememberUserAvatar(explorer)
  expect(reconcileUserAvatarOwner(null)).toBe(true)
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  // Signed out, a look the runtime still reports is not kept.
  rememberUserAvatar(explorer)
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
})

it('lets the account that arrives after the profile claim the record', () => {
  rememberUserAvatar(explorer)
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).owner).toBe('')
  expect(reconcileUserAvatarOwner('user-1')).toBe(false)
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).owner).toBe('user-1')
  restart()
  expect(reconcileUserAvatarOwner('user-2')).toBe(true)
})

it('ignores a damaged or foreign record', () => {
  for (const raw of ['{not json', JSON.stringify({ v: 2, owner: '', avatar: explorer }),
    JSON.stringify({ v: 1, owner: '', avatar: { kind: 'builtin' } }), JSON.stringify({ v: 1, avatar: explorer })]) {
    localStorage.setItem(STORAGE_KEY, raw)
    restart()
    expect(rememberedUserAvatar()).toBeNull()
  }
})

it('follows a newer look saved by another window', () => {
  rememberUserAvatar(explorer)
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, owner: '', avatar: designer, faces: {} }))
  for (const listener of storageListeners) listener({ key: STORAGE_KEY })
  expect(rememberedUserAvatar()).toEqual(designer)
})
