import { describe, expect, it } from 'vitest'
import { Router } from '../router.js'
import { registerCoreRoutes } from './register-core-routes.js'
import type { ServerRuntime } from './server-runtime.js'

describe('app catalog route', () => {
  it('requires the runtime token and returns only preset metadata', async () => {
    const router = new Router()
    registerCoreRoutes(router, { runtimeToken: 'test-runtime-token', insecure: false } as ServerRuntime)
    const route = router.match('GET', '/v1/apps/catalog')!
    const call = (token?: string) => route.handler(new Request('http://localhost/v1/apps/catalog', {
      headers: token ? { authorization: `Bearer ${token}` } : {}
    }), { params: route.params })
    const denied = await call()
    expect(denied).not.toBeInstanceOf(Response)
    if (denied instanceof Response) throw new Error('expected JSON response')
    expect(denied.status).toBe(401)
    const allowed = await call('test-runtime-token')
    expect(allowed).not.toBeInstanceOf(Response)
    if (allowed instanceof Response) throw new Error('expected JSON response')
    expect(allowed.status).toBe(200)
    const body = JSON.parse(allowed.body) as { presets: { id: string; availability: string }[] }
    expect(body.presets.find((preset) => preset.id === 'notion')?.availability).toBe('planned')
    expect(body.presets.find((preset) => preset.id === 'figma-remote')?.availability).toBe('vendor_approval')
    expect(allowed.body).not.toContain('test-runtime-token')
  })
})
