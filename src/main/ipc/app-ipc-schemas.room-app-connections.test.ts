import { describe, expect, it } from 'vitest'
import { runtimeRequestPayloadSchema } from './app-ipc-schemas'

describe('Room app connection IPC boundary', () => {
  it('allows only the two user actions on a connection card', () => {
    for (const action of ['complete', 'skip']) {
      expect(runtimeRequestPayloadSchema.parse({
        path: `/v1/rooms/private-room/app-connections/card-1/${action}`,
        method: 'POST', body: '{"clientRequestId":"click-1"}'
      }).method).toBe('POST')
    }
    expect(() => runtimeRequestPayloadSchema.parse({
      path: '/v1/rooms/private-room/app-connections/card-1/authorize', method: 'POST'
    })).toThrow(/runtime request path is not allowed/)
  })
})
