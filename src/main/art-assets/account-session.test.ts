import { expect, it, vi } from 'vitest'
import { ArtAccountSession } from './account-session'
import type { ArtAccountAccess } from './account-access'
import type { ArtAssetService } from './service'
import type { KunAccountState } from '../../shared/kun-account'
import type { ArtState } from '../../shared/kun-art'
it('gates cached resources, cancels old work and ignores late callbacks across logout/account switches', async () => {
  let state: KunAccountState = { status: 'anonymous', user: null, error: null }
  let listener!: (state: KunAccountState) => void
  const account = { getState: async () => state, onState: (fn: typeof listener) => { listener = fn; return () => {} } } as ArtAccountAccess
  const ready: ArtState = { phase: 'ready', manifest: null, completed: 0, total: 0 }
  const services: { dispose: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; changed: (state: ArtState) => void }[] = []
  const published = vi.fn(), reset = vi.fn(async () => {})
  const create = vi.fn((changed: (state: ArtState) => void) => {
    const service = { dispose: vi.fn(), stop: vi.fn(async () => {}), changed,
      getState: async () => ready, check: vi.fn(async () => ready), checkIfDue: async () => ready, resource: async () => new Uint8Array([1]) }
    services.push(service); return service as unknown as ArtAssetService
  })
  const session = new ArtAccountSession({ account, create, changed: published, reset })
  expect((await session.checkIfDue()).phase).toBe('signed_out'); expect(create).not.toHaveBeenCalled()
  await expect(session.resource('kun-asset://one/path')).rejects.toThrow('login_required')
  state = { status: 'authenticated', user: { id: 'a', name: 'A', email: 'a@example.test', avatarUrl: null }, error: null }; listener(state)
  expect((await session.getState()).phase).toBe('ready')
  expect((await session.resource('kun-asset://one/path')).length).toBe(1)
  state = { status: 'anonymous', user: null, error: null }; listener(state)
  expect(services[0].dispose).toHaveBeenCalledOnce()
  services[0].changed(ready)
  expect(published.mock.calls.at(-1)?.[0].phase).toBe('signed_out')
  await expect(session.resource('kun-asset://one/path')).rejects.toThrow('login_required')
  state = { status: 'authenticated', user: { id: 'b', name: 'B', email: 'b@example.test', avatarUrl: null }, error: null }; listener(state)
  await session.getState(); expect(create).toHaveBeenCalledTimes(2)
  session.dispose()
  await expect(session.resource('kun-asset://one/path')).rejects.toThrow('login_required')
})
