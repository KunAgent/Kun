import { describe, expect, it, vi } from 'vitest'
import { Router } from '../router.js'
import type { JsonResponse } from '../response.js'
import type { ServerRuntime } from './server-runtime.js'
import { registerGitHubAppRoutes } from './github-app.js'

function fixture() {
  const githubApp = { status: vi.fn(async () => ({ configured: true, connected: false })), authorize: vi.fn(), sharing: vi.fn() }
  const thread = { id: 'thread-1', turns: [{ id: 'turn-1', clientSurface: 'gui', harnessId: 'kun' }] }
  const runtime = { runtimeToken: 'host-token', insecure: true, githubApp,
    threadService: { get: async (id: string) => id === thread.id ? thread : null } } as unknown as ServerRuntime
  const router = new Router(); registerGitHubAppRoutes(router, runtime)
  const request = async (method: string, path: string, body?: unknown, token = true) => {
    const route = router.match(method, new URL(path, 'http://local.test').pathname)!
    return await route.handler(new Request(`http://local.test${path}`, { method,
      headers: { ...(token ? { authorization: 'Bearer host-token' } : {}), 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}) }), { params: route.params }) as JsonResponse
  }
  return { request, githubApp, thread, router }
}
describe('GitHub App host API boundary', () => {
  it('requires the host token even in insecure mode and forbids tool/credential HTTP endpoints', async () => {
    const f = fixture()
    expect((await f.request('GET', '/v1/github/status?threadId=thread-1', undefined, false)).status).toBe(401)
    expect(f.githubApp.status).not.toHaveBeenCalled()
    expect((await f.request('GET', '/v1/github/status?threadId=thread-1')).headers['cache-control']).toBe('no-store')
    expect(f.router.match('POST', '/v1/github/read')).toBeUndefined()
    expect(f.router.match('GET', '/v1/github/token')).toBeUndefined()
  })
  it('rejects forged binding, callback and credentials and requires the exact data-use acknowledgement', async () => {
    const f = fixture()
    const body = { binding: { threadId: 'thread-1' }, allowModelSharing: true, sharingPolicy: 'configured-models-v1' }
    for (const invalid of [{ ...body, callbackUrl: 'https://other.test' }, { ...body, token: 'injected' },
      { ...body, binding: { threadId: 'thread-1', roomId: 'other', messageId: 'fake' } }]) {
      expect((await f.request('POST', '/v1/github/authorize', invalid)).status).toBe(400)
    }
    expect((await f.request('POST', '/v1/github/authorize', { binding: body.binding })).status).toBe(409)
    expect((await f.request('POST', '/v1/github/authorize', body)).status).toBe(200)
    expect(f.githubApp.authorize).toHaveBeenCalledExactlyOnceWith('thread:thread-1')
    f.thread.turns[0].harnessId = 'external-agent'
    expect((await f.request('POST', '/v1/github/authorize', body)).status).toBe(409)
    expect(f.githubApp.authorize).toHaveBeenCalledTimes(1)
  })
})
