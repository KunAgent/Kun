import { describe, expect, it } from 'vitest'
import { runtimeRequestPayloadSchema } from './app-ipc-schemas'

describe('handoff preview desktop bridge', () => {
  it('permits the exact read-only endpoint with its turn query', () => {
    const path = '/v1/threads/thread_1/handoff-preview?turnId=turn_2'
    expect(runtimeRequestPayloadSchema.parse({ path, method: 'GET' }).path).toBe(path)
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(runtimeRequestPayloadSchema.safeParse({ path, method }).success).toBe(false)
    }
    expect(runtimeRequestPayloadSchema.safeParse({ path: '/v1/threads/thread_1/handoff-preview/other', method: 'GET' }).success).toBe(false)
  })
})
