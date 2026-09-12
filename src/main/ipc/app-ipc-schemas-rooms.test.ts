import { describe, expect, it } from 'vitest'
import { runtimeRequestPayloadSchema } from './app-ipc-schemas/runtime'

describe('Rooms desktop HTTP boundary', () => {
  it.each([
    ['/v1/rooms', ['GET', 'POST']],
    ['/v1/rooms/presets', ['GET']],
    ['/v1/rooms/room-1', ['GET', 'PATCH']],
    ['/v1/rooms/room-1/messages?limit=50&cursor=100', ['GET', 'POST']],
    ['/v1/rooms/room-1/tasks', ['GET']],
    ['/v1/rooms/room-1/tasks/task-1', ['GET']],
    ['/v1/rooms/room-1/events?since_seq=10', ['GET']],
    ['/v1/rooms/room-1/rules', ['GET', 'POST']],
    ...['cancel', 'retry', 'review', 'accept', 'apply'].map((action) => [`/v1/rooms/room-1/tasks/task-1/${action}`, ['POST']])
  ])('allows modeled methods for %s', (path, methods) => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(runtimeRequestPayloadSchema.safeParse({ path, method }).success).toBe(methods.includes(method))
    }
  })
  it.each([
    '/v1/rooms/room-1/delete', '/v1/rooms//messages',
    '/v1/rooms/room-1/tasks/task-1/reset', '/v1/rooms/room-1/tasks/task-1/apply/extra'
  ])('rejects unmodeled actions and empty identities: %s', (path) => {
    expect(runtimeRequestPayloadSchema.safeParse({ path, method: 'POST' }).success).toBe(false)
  })
})
