import { describe, expect, it } from 'vitest'
import { runtimeRequestPayloadSchema } from './app-ipc-schemas'

describe('Room run steps IPC boundary', () => {
  it('lets the private chat read a run as steps, read-only', () => {
    expect(runtimeRequestPayloadSchema.parse({ path: '/v1/rooms/private-room/runs/run-1/steps', method: 'GET' }).method).toBe('GET')
    for (const method of ['POST', 'PUT', 'DELETE']) {
      expect(() => runtimeRequestPayloadSchema.parse({ path: '/v1/rooms/private-room/runs/run-1/steps', method }))
        .toThrow(/runtime request path is not allowed/)
    }
    expect(() => runtimeRequestPayloadSchema.parse({ path: '/v1/rooms/private-room/runs/run-1/steps/all', method: 'GET' }))
      .toThrow(/runtime request path is not allowed/)
  })
})
