import { describe, expect, it } from 'vitest'
import { runtimeRequestPayloadSchema } from './app-ipc-schemas'

describe('wardrobe runtime request allowlist', () => {
  it('lets the renderer read the wardrobe and open, mark and exchange through the bridge', () => {
    for (const payload of [
      { path: '/v1/rooms/wardrobe', method: 'GET' },
      { path: '/v1/rooms/wardrobe/open', method: 'POST', body: '{}' },
      { path: '/v1/rooms/wardrobe/seen', method: 'POST', body: '{}' },
      { path: '/v1/rooms/wardrobe/exchange', method: 'POST', body: '{}' },
      { path: '/v1/rooms/wardrobe/settings', method: 'POST', body: '{}' },
      { path: '/v1/rooms/wardrobe/stash', method: 'POST', body: '{}' }
    ] as const) {
      expect(runtimeRequestPayloadSchema.parse(payload).path).toBe(payload.path)
    }
    expect(() => runtimeRequestPayloadSchema.parse({ path: '/v1/rooms/wardrobe', method: 'DELETE' }))
      .toThrow(/runtime request path is not allowed/)
    expect(() => runtimeRequestPayloadSchema.parse({ path: '/v1/rooms/wardrobe/reset', method: 'POST', body: '{}' }))
      .toThrow(/runtime request path is not allowed/)
  })
})
