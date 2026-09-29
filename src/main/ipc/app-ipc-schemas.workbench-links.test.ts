import { describe, expect, it } from 'vitest'
import { runtimeRequestPayloadSchema } from './app-ipc-schemas'

describe('Room workbench link IPC boundary', () => {
  it('allows reading links and the user decisions on a card, and nothing an Agent tool owns', () => {
    for (const [path, method] of [
      ['/v1/rooms/room-1/workbench-links?limit=50&status=running,needs_attention', 'GET'],
      ['/v1/rooms/room-1/workbench-links/link-1', 'GET'],
      ['/v1/rooms/room-1/workbench-links/watch', 'POST'],
      ...['confirm', 'dismiss', 'cancel'].map((action) => [`/v1/rooms/room-1/workbench-links/link-1/${action}`, 'POST'])
    ] as const) {
      expect(runtimeRequestPayloadSchema.parse({ path, method, ...(method === 'POST' ? { body: '{}' } : {}) }).method, path).toBe(method)
    }
    for (const [path, method] of [
      ['/v1/rooms/room-1/workbench-links/link-1/confirm', 'GET'],
      ['/v1/rooms/room-1/workbench-links/link-1', 'DELETE'],
      ['/v1/rooms/room-1/workbench-links/link-1/run', 'POST'],
      ['/v1/rooms/room-1/workbench-links', 'POST']
    ] as const) {
      expect(() => runtimeRequestPayloadSchema.parse({ path, method }), `${method} ${path}`).toThrow(/runtime request/)
    }
  })

  it('exposes the workspace directory only for reading and replacing', () => {
    expect(runtimeRequestPayloadSchema.parse({ path: '/v1/workbench/directory', method: 'GET' }).method).toBe('GET')
    expect(runtimeRequestPayloadSchema.parse({ path: '/v1/workbench/directory', method: 'PUT', body: '{}' }).method).toBe('PUT')
    expect(() => runtimeRequestPayloadSchema.parse({ path: '/v1/workbench/directory', method: 'DELETE' })).toThrow(/runtime request/)
  })
})
