/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { KunAccountState } from '@shared/kun-account'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
  clear() { this.values.clear() }
}
const roomsRequest = vi.hoisted(() => vi.fn())
vi.mock('./rooms-client', () => ({ roomsRequest }))

const STORAGE_KEY = 'kun.rooms.userAvatar.v1'
const explorer = { kind: 'builtin', id: 'explorer' } as const
const designer = { kind: 'builtin', id: 'designer' } as const
const signedIn = (id: string): KunAccountState => ({ status: 'authenticated', user: { id, email: `${id}@kun.test`, name: id, avatarUrl: null }, error: null })
const signedOut: KunAccountState = { status: 'anonymous', user: null, error: null }

let storage: MemoryStorage
let roots: Root[] = []
let accountHandler: ((state: KunAccountState) => void) | undefined
let accountState: KunAccountState

/** A fresh launch: modules are loaded again, and only storage carries over. */
async function launch() {
  vi.resetModules()
  return import('./room-user-profile')
}
async function mountSync(profile: Awaited<ReturnType<typeof launch>>) {
  const Probe = () => { profile.useRoomUserProfileSync(); return null }
  const root = createRoot(document.body.appendChild(document.createElement('div')))
  roots.push(root)
  await act(async () => root.render(createElement(Probe)))
}
const saved = () => JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null')

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  storage = new MemoryStorage()
  vi.stubGlobal('localStorage', storage)
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
  accountState = signedIn('user-1')
  accountHandler = undefined
  Object.defineProperty(window, 'kunGui', { configurable: true, value: { kunAccount: {
    getState: vi.fn(async () => accountState),
    onState: vi.fn((handler: (state: KunAccountState) => void) => { accountHandler = handler; return () => { accountHandler = undefined } })
  } } })
  roomsRequest.mockReset()
  roomsRequest.mockResolvedValue({ profile: { avatar: designer }, revision: 5 })
})
afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount())
  roots = []
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window, 'kunGui')
})

it('wears the look the last run ended with before the runtime has answered', async () => {
  storage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, owner: 'user-1', avatar: explorer, faces: {} }))
  const profile = await launch()
  expect(profile.useRoomUserProfile.getState().profile.avatar).toEqual(explorer)

  let answer!: (value: unknown) => void
  roomsRequest.mockReturnValue(new Promise((resolve) => { answer = resolve }))
  await mountSync(profile)
  expect(profile.useRoomUserProfile.getState().profile.avatar).toEqual(explorer)

  await act(async () => answer({ profile: { avatar: designer }, revision: 5 }))
  expect(profile.useRoomUserProfile.getState().profile.avatar).toEqual(designer)
  expect(saved().avatar).toEqual(designer)
})

it('lets the runtime answer win even when it has no look or an older revision', async () => {
  storage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, owner: 'user-1', avatar: explorer, faces: {} }))
  const profile = await launch()
  roomsRequest.mockResolvedValue({ profile: { avatar: null }, revision: null })
  await mountSync(profile)
  expect(profile.useRoomUserProfile.getState().profile.avatar).toBeNull()
  expect(storage.getItem(STORAGE_KEY)).toBeNull()
})

it('remembers a look the user just saved and forgets it again when they clear it', async () => {
  const profile = await launch()
  profile.acceptRoomUserProfile({ profile: { avatar: explorer }, revision: 1 })
  expect(saved().avatar).toEqual(explorer)
  profile.acceptRoomUserProfile({ profile: { avatar: designer }, revision: 2 })
  expect(saved().avatar).toEqual(designer)
  profile.acceptRoomUserProfile({ profile: { avatar: explorer }, revision: 1 })
  expect(saved().avatar).toEqual(designer)
  profile.acceptRoomUserProfile({ profile: { avatar: null }, revision: 3 })
  expect(storage.getItem(STORAGE_KEY)).toBeNull()
})

it('keeps the remembered look while the runtime is still starting and asks again soon', async () => {
  storage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, owner: 'user-1', avatar: explorer, faces: {} }))
  const profile = await launch()
  roomsRequest.mockRejectedValueOnce(new Error('runtime not ready')).mockRejectedValueOnce(new Error('runtime not ready'))
  await mountSync(profile)
  expect(profile.useRoomUserProfile.getState().profile.avatar).toEqual(explorer)
  expect(roomsRequest).toHaveBeenCalledTimes(1)

  await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
  expect(roomsRequest).toHaveBeenCalledTimes(2)
  expect(profile.useRoomUserProfile.getState().profile.avatar).toEqual(explorer)

  await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
  expect(roomsRequest).toHaveBeenCalledTimes(3)
  expect(profile.useRoomUserProfile.getState().profile.avatar).toEqual(designer)
})

it('drops the remembered look when nobody is signed in', async () => {
  storage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, owner: 'user-1', avatar: explorer, faces: {} }))
  const profile = await launch()
  accountState = signedOut
  roomsRequest.mockReturnValue(new Promise(() => undefined))
  await mountSync(profile)
  expect(storage.getItem(STORAGE_KEY)).toBeNull()
  expect(profile.useRoomUserProfile.getState().profile.avatar).toBeNull()
})

it('does not inherit another account\'s look and fetches the new account\'s', async () => {
  storage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, owner: 'user-1', avatar: explorer, faces: {} }))
  const profile = await launch()
  accountState = signedIn('user-2')
  roomsRequest.mockReturnValue(new Promise(() => undefined))
  await mountSync(profile)
  expect(storage.getItem(STORAGE_KEY)).toBeNull()
  expect(profile.useRoomUserProfile.getState().profile.avatar).toBeNull()
})

it('refetches when the signed-in account changes while the app is open', async () => {
  const profile = await launch()
  await mountSync(profile)
  expect(profile.useRoomUserProfile.getState().profile.avatar).toEqual(designer)
  expect(roomsRequest).toHaveBeenCalledOnce()

  roomsRequest.mockResolvedValue({ profile: { avatar: explorer }, revision: 1 })
  await act(async () => accountHandler?.(signedIn('user-2')))
  expect(roomsRequest).toHaveBeenCalledTimes(2)
  expect(profile.useRoomUserProfile.getState().profile.avatar).toEqual(explorer)
  expect(saved().owner).toBe('user-2')

  await act(async () => accountHandler?.(signedOut))
  expect(storage.getItem(STORAGE_KEY)).toBeNull()
})
