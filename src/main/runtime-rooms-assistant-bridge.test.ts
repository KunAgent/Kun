import { describe, expect, it } from 'vitest'
import { runtimeRequestPayloadSchema } from './ipc/app-ipc-schemas/runtime'

describe('Rooms assistant desktop bridge endpoints', () => {
  it.each([
    ['/v1/rooms/room/messages/message/context?limit=20', 'GET'],
    ['/v1/rooms/room/read', 'GET'],
    ['/v1/rooms/room/read', 'POST'],
    ['/v1/rooms/room/result-inbox?limit=30', 'GET'],
    ['/v1/rooms/room/files?legacy_cursor=start', 'GET'],
    ['/v1/rooms/room/reminders/reminder/pause', 'POST'],
    ['/v1/rooms/room/reminders/reminder/resume', 'POST'],
    ['/v1/agents/agent/commitments', 'POST'],
    ['/v1/agents/agent/artifacts/artifact/versions', 'GET'],
    ['/v1/agents/agent/artifacts/artifact/export?version=1&offset=0', 'GET']
  ])('permits %s %s through constrained IPC', (path, method) => {
    expect(runtimeRequestPayloadSchema.safeParse({ path, method }).success).toBe(true)
  })
  it.each([
    ['/v1/rooms/room/messages/message/context', 'POST'],
    ['/v1/rooms/room/result-inbox', 'DELETE'],
    ['/v1/rooms/room/reminders/reminder/pause', 'GET'],
    ['/v1/agents/agent/artifacts/artifact/export', 'POST']
  ])('does not broaden methods for %s', (path, method) => {
    expect(runtimeRequestPayloadSchema.safeParse({ path, method }).success).toBe(false)
  })
})
