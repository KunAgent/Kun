import { describe, expect, it } from 'vitest'
import { runtimeRequestPayloadSchema } from './app-ipc-schemas'

describe('Native Gmail IPC boundary', () => {
  it('admits the connection lifecycle and rejects direct mail sending', () => {
    for (const [path, method] of [
      ['/v1/gmail/status?threadId=t1', 'GET'],
      ['/v1/gmail/authorize', 'POST'],
      ['/v1/gmail/authorization/request-1?threadId=t1', 'GET'],
      ['/v1/gmail/authorization/request-1?threadId=t1', 'DELETE'],
      ['/v1/gmail/sharing', 'PATCH'],
      ['/v1/gmail/connection', 'DELETE'],
      ['/v1/gmail/continue', 'POST']
    ]) {
      expect(runtimeRequestPayloadSchema.parse({ path, method }).method).toBe(method)
    }
    for (const [path, method] of [
      ['/v1/gmail/send', 'POST'], ['/v1/gmail/status', 'POST'],
      ['/v1/gmail/authorize', 'GET'], ['/v1/gmail/authorization/request-1', 'POST']
    ]) {
      expect(() => runtimeRequestPayloadSchema.parse({ path, method })).toThrow()
    }
  })
})
