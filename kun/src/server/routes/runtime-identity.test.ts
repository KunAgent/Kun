import { describe, expect, it } from 'vitest'
import { runtimeIdentityJsonResponse } from './runtime-identity.js'

function runtime(info: Record<string, unknown>) {
  return { info: () => info } as never
}

function request(remoteAddress: string): Request {
  return new Request('http://127.0.0.1/v1/runtime/identity', {
    headers: { 'x-kun-remote-address': remoteAddress }
  })
}

describe('runtimeIdentityJsonResponse', () => {
  it('returns identity fields for a loopback client', async () => {
    const response = runtimeIdentityJsonResponse(
      runtime({
        instanceId: 'i-1',
        pid: 42,
        startedAt: '2026-08-21T00:00:00.000Z',
        buildId: 'b'.repeat(64),
        dataDir: '/tmp/data',
        host: '127.0.0.1',
        port: 43001
      }),
      request('127.0.0.1')
    )
    expect(response.status).toBe(200)
    const body = JSON.parse(response.body ?? '{}') as Record<string, unknown>
    expect(body.instanceId).toBe('i-1')
    expect(body.pid).toBe(42)
    expect(body.port).toBe(43001)
  })

  it('rejects a non-loopback client', () => {
    const response = runtimeIdentityJsonResponse(
      runtime({}),
      request('192.168.1.10')
    )
    expect(response.status).toBe(403)
  })
})
