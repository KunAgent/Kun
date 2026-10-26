import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { useAccountEntitlements } from './useAccountEntitlements'
let renderer: ReactTestRenderer | undefined
let latest: ReturnType<typeof useAccountEntitlements>
const api = vi.fn()
function Probe({ owner }: { owner: string }) { latest = useAccountEntitlements(owner); return null }
const snapshot = (userId: string, effectiveTier = 'plus') => ({ version: 1, userId, tier: effectiveTier, effectiveTier, status: 'active', expiresAt: null, checkedAt: new Date().toISOString(), revision: 1, features: { mobileRemote: true, personalAssistant: effectiveTier !== 'plus' } })
beforeEach(() => {
  api.mockReset()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('window', Object.assign(new EventTarget(), { kunGui: { mobileLink: { entitlements: api } } }))
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
})
afterEach(async () => { if (renderer) await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals() })
it('refreshes on foreground and ignores an older response after a newer refresh', async () => {
  api.mockResolvedValue(snapshot('owner'))
  await act(async () => { renderer = create(createElement(Probe, { owner: 'owner' })) })
  expect(latest.value?.effectiveTier).toBe('plus')
  let older!: (value: unknown) => void
  api.mockImplementationOnce(() => new Promise(resolve => { older = resolve }))
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  api.mockResolvedValue(snapshot('owner', 'pro'))
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  expect(latest.value?.effectiveTier).toBe('pro')
  await act(async () => { older(snapshot('owner')) })
  expect(latest.value?.effectiveTier).toBe('pro')
})
it('clears membership across account switches and never accepts the prior account response', async () => {
  let previous!: (value: unknown) => void
  api.mockImplementationOnce(() => new Promise(resolve => { previous = resolve }))
  await act(async () => { renderer = create(createElement(Probe, { owner: 'owner' })) })
  api.mockResolvedValue(snapshot('other', 'max'))
  await act(async () => renderer!.update(createElement(Probe, { owner: 'other' })))
  await act(async () => { previous(snapshot('owner')) })
  expect(latest.value?.userId).toBe('other')
  expect(latest.value?.effectiveTier).toBe('max')
})
