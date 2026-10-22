import { describe, expect, it } from 'vitest'
import { runtimeRequestPayloadSchema } from './app-ipc-schemas'

describe('Native GitHub IPC boundary', () => {
  it('admits the connection lifecycle and rejects direct mail sending', () => {
    for (const [path, method] of [
      ['/v1/github/status?threadId=t1', 'GET'],
      ['/v1/github/authorize', 'POST'],
      ['/v1/github/authorization/request-1?threadId=t1', 'GET'],
      ['/v1/github/authorization/request-1?threadId=t1', 'DELETE'],
      ['/v1/github/sharing', 'PATCH'],
      ['/v1/github/connection', 'DELETE'],
      ['/v1/github/continue', 'POST']
    ]) {
      expect(runtimeRequestPayloadSchema.parse({ path, method }).method).toBe(method)
    }
    for (const [path, method] of [
      ['/v1/github/send', 'POST'], ['/v1/github/status', 'POST'],
      ['/v1/github/authorize', 'GET'], ['/v1/github/authorization/request-1', 'POST']
    ]) {
      expect(() => runtimeRequestPayloadSchema.parse({ path, method })).toThrow()
    }
  })
})
