import { expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { RemoteApi } from '@kun/remote-protocol'
import { agentLibraryFixture } from '../../../kun/src/remote/agents/library/library.test-support'
import { registerRemoteRoutes } from '../../../kun/src/remote/routes'
import { transferFiles } from './files'
vi.mock('electron', () => ({ app: { getPath: () => '/unused-for-export' } }))
vi.mock('../services/office-document-service', () => ({ readLocalOfficeDocument: vi.fn() }))
vi.mock('../services/runtime-document-attachment-service', () => ({ uploadRuntimeDocumentAttachment: vi.fn() }))
vi.mock('../services/runtime-image-attachment-service', () => ({ uploadRuntimeImageAttachment: vi.fn() }))
vi.mock('../services/write-pdf-text-service', () => ({ readLocalPdfText: vi.fn() }))

it('exports two exact native versions through Main, protected runtime routes, R2 and version-bound durable receipts', async () => {
  const f = await agentLibraryFixture()
  try {
    await f.run('run-two'); await f.capture(2, 'run-two')
    registerRemoteRoutes(f.router, f.runtime)
    const cloud = new Map<string, Buffer>(), sourcePaths: string[] = []
    async function dispatch(path: string, method = 'GET', body?: string) {
      const url = new URL('http://runtime' + path), route = f.router.match(method, url.pathname)!
      const result = await route.handler(new Request(url, { method,
        headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, body }), { params: route.params })
      return result instanceof Response ? result : new Response(result.body, { status: result.status, headers: result.headers })
    }
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input)), method = init?.method ?? 'GET'
      if (url.hostname === 'runtime') { sourcePaths.push(url.pathname + url.search); return dispatch(url.pathname + url.search, method) }
      if (url.pathname.endsWith('/transfers') && method === 'POST') {
        const id = randomUUID(), metadata = JSON.parse(String(init?.body))
        cloud.set(id, Buffer.alloc(0)); return Response.json({ id, ...metadata })
      }
      const id = url.pathname.split('/').at(-2)!
      if (method === 'PUT' && cloud.has(id)) { cloud.set(id, Buffer.from(init?.body as Uint8Array)); return Response.json({ ok: true }) }
      throw new Error('unexpected fixture request')
    }
    vi.stubGlobal('fetch', fetcher)
    const api = new RemoteApi({ origin: 'https://relay.test', token: async () => 'fixture-token',
      identity: async () => ({ id: 'host', credential: 'a'.repeat(64) }), fetch: fetcher })
    const lease = { runtimeToken: 'token', baseUrl: 'http://runtime', request: async (path: string, method?: string, body?: string) => {
      const result = await dispatch(path, method, body)
      return { ok: result.ok, status: result.status, body: await result.text() }
    } }
    const scope = { api, owner: 'owner', peer: 'phone', authorizationId: 'connection', current: () => true, lease: async () => lease }
    for (const version of [1, 2]) {
      const call = { method: 'attachment.export', params: { artifactId: f.first.artifactId, agentId: f.agent.id, version }, requestId: 'version-' + version }
      const value: any = await transferFiles(scope, call)
      expect(value.receipt).toMatchObject({ status: 'applied', params: call.params })
      expect(cloud.get(value.receipt.result.transferId)?.toString()).toBe('Immutable version ' + version)
      expect(sourcePaths.at(-1)).toBe('/v1/remote/artifacts/agent/' + f.agent.id + '/' + f.first.artifactId + '?version=' + version)
      expect(await transferFiles(scope, call)).toEqual(value)
    }
    const count = sourcePaths.length
    await expect(transferFiles(scope, { method: 'attachment.export', requestId: 'version-1',
      params: { artifactId: f.first.artifactId, agentId: f.agent.id, version: 2 } })).rejects.toThrow('RECEIPT_CONFLICT')
    expect(sourcePaths).toHaveLength(count)
  } finally { vi.unstubAllGlobals(); await f.close() }
})
