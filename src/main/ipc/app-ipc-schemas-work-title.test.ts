import { describe, expect, it } from 'vitest'
import { kunThreadWorkTitleRecoverPath } from '../../shared/kun-endpoints'
import { runtimeRequestPayloadSchema } from './app-ipc-schemas/runtime'

describe('Work title recovery IPC route', () => {
  it('allows only the intended single-thread POST', () => {
    const path = kunThreadWorkTitleRecoverPath('thread-1')
    expect(runtimeRequestPayloadSchema.safeParse({ path, method: 'POST' }).success).toBe(true)
    for (const method of ['GET', 'PATCH', 'DELETE', 'PUT']) {
      expect(runtimeRequestPayloadSchema.safeParse({ path, method }).success).toBe(false)
    }
    expect(runtimeRequestPayloadSchema.safeParse({ path: `${path}/extra`, method: 'POST' }).success).toBe(false)
  })
})
