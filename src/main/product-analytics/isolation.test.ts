import { describe, expect, it } from 'vitest'
import { runtimeRequestPayloadSchema } from '../ipc/app-ipc-schemas/runtime'
import { REMOTE_ALLOWED_INVOKE_CHANNELS } from '../remote/remote-allowlist'
import { ANALYTICS_CHANNELS } from '../../shared/product-analytics'
describe('analytics privileged boundary', () => {
  it('does not expose desktop consent or private outbox to remote browser clients', () => {
    for (const channel of Object.values(ANALYTICS_CHANNELS)) expect(REMOTE_ALLOWED_INVOKE_CHANNELS.has(channel)).toBe(false)
    for (const path of ['/v1/product-analytics', '/v1/product-analytics/lease', '/v1/product-analytics/ack'])
      for (const method of ['GET', 'POST']) expect(runtimeRequestPayloadSchema.safeParse({ path, method }).success).toBe(false)
  })
})
