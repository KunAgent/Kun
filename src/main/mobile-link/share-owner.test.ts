import { describe, expect, it } from 'vitest'
import { RemoteApi } from '@kun/remote-protocol'
import { ShareOwnerOperations } from './share-owner'
import { shareFixture } from '../../../kun/src/remote/sharing/guest.test-support'
import { registerSharedTaskRoutes } from '../../../kun/src/remote/sharing/routes'
describe('Main shared task owner journal and native cloud proof', () => {
  it('reconciles a lost create response without repeating the cloud mutation or leaking business data', async () => {
    const f = await shareFixture(); registerSharedTaskRoutes(f.router, f.runtime)
    try {
      const sent: any[] = [], proof = new Map<string, unknown>()
      const api = new RemoteApi({ origin: 'https://relay.test', token: async () => 'test-token',
        identity: async () => ({ id: 'host', credential: 'a'.repeat(64) }), fetch: async (input, init) => {
          const path = new URL(String(input)).pathname
          if (init?.method === 'POST' && path.endsWith('/shares')) {
            const body = JSON.parse(String(init.body)); sent.push(body)
            proof.set(body.requestId, { share: { ...f.share, id: 'created', resourceHandle: body.resourceHandle } })
            throw new Error('response-lost-after-commit')
          }
          const id = path.split('/').at(-1)!
          return Response.json({ result: proof.get(id) ?? null })
        } })
      const request = async (path: string, _method?: string, body?: string) => {
        const route = f.router.match('POST', path)!
        const response = await route.handler(new Request('http://runtime' + path, { method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, body }), { params: route.params })
        return response instanceof Response ? { ok: response.ok, status: response.status, body: await response.text() } : { ok: response.status < 400, status: response.status, body: response.body }
      }
      const context = { api, owner: f.owner, current: () => true, lease: async () => ({ runtimeToken: 'token', request }) }
      const operations = new ShareOwnerOperations(), call = { method: 'shares.manage', requestId: 'owner_create', expiresAt: Date.now() + 60000,
        params: { action: 'create', threadId: f.task.id } }
      const first: any = await operations.invoke(context, call, () => {})
      expect(first.receipt.status).toBe('reconciliation_required')
      const recovered = await operations.lookup(context, call.requestId)
      expect(recovered.receipt).toMatchObject({ status: 'applied', method: 'shares.manage', result: { share: { id: 'created' }, threadId: f.task.id, title: 'Shared task' } })
      expect(await operations.invoke(context, { ...call, expiresAt: call.expiresAt + 1000 }, () => {})).toEqual(recovered)
      await expect(operations.invoke(context, { ...call, expiresAt: call.expiresAt + 2000, params: { ...call.params, expiresAt: Date.now() + 86400000 } }, () => {})).rejects.toThrow('REQUEST_CONFLICT')
      expect(sent).toHaveLength(1)
      expect(sent[0]).toMatchObject({ resourceHandle: expect.stringMatching(/^shared_/), requestId: expect.stringMatching(/^share-owner-/) })
      for (const field of ['threadId', 'title', 'prompt', 'invitation', 'secret']) expect(sent[0]).not.toHaveProperty(field)
    } finally { await f.close() }
  })
})
