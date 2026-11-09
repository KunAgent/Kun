import { expect, it, vi } from 'vitest'
import { MobileLinkService, type LinkDependencies } from './service'

function fixture(status: number, code: string) {
  const deps: LinkDependencies = {
    account: {
      getState: async () => ({ status: 'authenticated', error: null,
        user: { id: 'owner', name: 'owner', email: 'owner@test.invalid', avatarUrl: null } }),
      accessToken: async () => 'token', expire: async () => {}, onState: () => () => {}
    },
    requireMembership: vi.fn(async () => {}),
    identity: vi.fn(async () => ({ id: '11111111-1111-4111-8111-111111111111', credential: 'a'.repeat(64) })),
    origin: 'https://relay.test', name: 'desktop', platform: 'macos',
    fetch: vi.fn(async () => Response.json({ error: code }, { status })),
    socket: vi.fn(), lease: vi.fn(), diagnostic: vi.fn()
  }
  return { deps, service: new MobileLinkService(deps) }
}

it('preserves a registration rejection as a device authorization error without rotating or enabling access', async () => {
  const { deps, service } = fixture(403, 'forbidden')
  try {
    await expect(service.enable(true)).rejects.toThrow('DEVICE_AUTHORIZATION_REQUIRED')
    expect(await service.status()).toMatchObject({ enabled: false, online: false, error: 'DEVICE_AUTHORIZATION_REQUIRED' })
    expect(deps.identity).toHaveBeenCalledTimes(1)
    expect(deps.fetch).toHaveBeenCalledTimes(1)
    expect(deps.socket).not.toHaveBeenCalled()
    expect(deps.diagnostic).toHaveBeenCalledWith('DEVICE_AUTHORIZATION_REQUIRED')
  } finally { service.dispose() }
})

it.each([[401, 'unauthorized'], [403, 'vip_mobile_remote_required'], [503, 'unavailable']])(
  'does not mistake HTTP %s / %s for a rejected device identity', async (status, code) => {
    const { service } = fixture(status, code)
    try {
      await expect(service.enable(true)).rejects.toThrow(code)
      expect((await service.status()).error).not.toBe('DEVICE_AUTHORIZATION_REQUIRED')
    } finally { service.dispose() }
  }
)
