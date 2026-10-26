/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KunAccountUser } from '@shared/kun-account'
import {
  ACCOUNT_AVATAR_STORAGE_KEY, ownAccountPicture, resetAccountAvatarForTests, resolveAccountFace,
  setAccountAvatarCustom, setAccountAvatarSource, type AccountAvatarRecord
} from './account-avatar'

const photo = 'data:image/webp;base64,UklGRg=='
const custom = 'data:image/png;base64,iVBORw0KGgo='
const user = (avatarUrl: string | null): KunAccountUser => ({ id: 'u', email: 'u@example.test', name: 'U', avatarUrl })
const record = (value: Partial<AccountAvatarRecord>): AccountAvatarRecord => ({ source: 'own', custom: null, photo: null, ...value })
const stored = () => JSON.parse(localStorage.getItem(ACCOUNT_AVATAR_STORAGE_KEY) ?? 'null')

// Node's own localStorage global shadows jsdom's, so each test gets a plain in-memory one.
function memoryStorage(): Storage {
  const items = new Map<string, string>()
  return {
    get length() { return items.size }, clear: () => items.clear(), key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => items.get(key) ?? null, setItem: (key, value) => { items.set(key, String(value)) }, removeItem: (key) => { items.delete(key) }
  }
}

beforeEach(() => { vi.stubGlobal('localStorage', memoryStorage()); resetAccountAvatarForTests() })
afterEach(() => { vi.unstubAllGlobals(); resetAccountAvatarForTests() })

describe('account avatar choice', () => {
  it('wears the account photo by default and Kun without one', () => {
    const read = record({ photo: { url: 'https://cdn.example.test/me.png', data: photo } })
    expect(resolveAccountFace(read, user('https://cdn.example.test/me.png'))).toEqual({ kind: 'image', src: photo })
    expect(resolveAccountFace(read, user(null))).toEqual({ kind: 'kun' })
    // A photo read for an earlier URL is not shown for a new one.
    expect(resolveAccountFace(read, user('https://cdn.example.test/new.png'))).toEqual({ kind: 'kun' })
    expect(resolveAccountFace(record({}), null)).toEqual({ kind: 'kun' })
  })

  it('lets a picture chosen on this machine win, and Kun win when chosen', () => {
    const both = record({ custom, photo: { url: 'https://cdn.example.test/me.png', data: photo } })
    expect(ownAccountPicture(both, user('https://cdn.example.test/me.png'))).toBe(custom)
    expect(resolveAccountFace(both, null)).toEqual({ kind: 'image', src: custom })
    expect(resolveAccountFace({ ...both, source: 'kun' }, user('https://cdn.example.test/me.png'))).toEqual({ kind: 'kun' })
  })

  it('remembers the choice and drops malformed records', () => {
    setAccountAvatarCustom(custom)
    setAccountAvatarSource('kun')
    expect(stored()).toMatchObject({ source: 'kun', custom })
    setAccountAvatarCustom(custom)
    expect(stored().source).toBe('own')
    setAccountAvatarCustom(null)
    expect(stored()).toMatchObject({ source: 'own', custom: null })
    localStorage.setItem(ACCOUNT_AVATAR_STORAGE_KEY, JSON.stringify({ source: 'other', custom: 'javascript:alert(1)', photo: { url: 1 } }))
    resetAccountAvatarForTests()
    setAccountAvatarSource('own')
    expect(stored()).toEqual({ source: 'own', custom: null, photo: null })
  })
})
