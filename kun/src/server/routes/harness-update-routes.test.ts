import { expect, it, vi } from 'vitest'
import { Router } from '../router.js'
import { registerHarnessUpdateRoutes } from './register-harness-update-routes.js'
import type { ServerRuntime } from './server-runtime.js'

it('authenticates updates and accepts only fingerprint-bound built-in actions', async () => {
  const start = vi.fn(async () => ({ job: { status: 'waiting' } }))
  const check = vi.fn(async () => ({ status: 'available' }))
  const router = new Router()
  registerHarnessUpdateRoutes(router, { runtimeToken: 'test-token', insecure: false,
    harnesses: { updates: { start, check } } } as unknown as ServerRuntime)
  const request = async (action: string, body: unknown, authorized = true) => {
    const path = `/v1/harnesses/claude-code/updates/${action}`
    const match = router.match('POST', path)!
    return match.handler(new Request(`http://localhost${path}`, { method: 'POST',
      headers: { 'content-type': 'application/json', ...(authorized ? { authorization: 'Bearer test-token' } : {}) },
      body: JSON.stringify(body) }), { params: match.params })
  }
  expect((await request('start', { action: 'managed', expectedFingerprint: 'reviewed-binary' }, false)).status).toBe(401)
  for (const body of [
    { action: 'managed', expectedFingerprint: 'reviewed-binary', command: '/tmp/arbitrary-command' },
    { action: 'use-local', expectedFingerprint: 'reviewed-binary', path: '/tmp/unverified' },
    { action: 'execute', expectedFingerprint: 'reviewed-binary' },
    { action: 'update' }
  ]) expect((await request('start', body)).status).toBe(400)
  expect(start).not.toHaveBeenCalled()
  expect((await request('start', { action: 'use-local', expectedFingerprint: 'reviewed-binary' })).status).toBe(202)
  expect(start).toHaveBeenCalledWith('claude-code', 'use-local', 'reviewed-binary')
  await request('check', { force: true })
  expect(check).toHaveBeenCalledWith('claude-code', true)
})
