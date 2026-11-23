import { describe, expect, it } from 'vitest'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeToolResultItem } from '../../domain/item.js'
import { registerRemoteRoutes } from '../routes.js'
import { remoteFixture } from '../testing/runtime.test-support.js'

describe('artifact preview HTTP boundary', () => {
  it('delivers manifest-addressed bytes only after a scoped catalogue read and runtime authorization', async () => {
    const f = await remoteFixture()
    const workspace = await realpath(await mkdtemp(join(tmpdir(), 'kun-artifact-http-')))
    try {
      const thread = await f.h.threads.create({ workspace, title: 'Artifacts', model: 'fake',
        agentSurface: 'code', workspaceMode: 'code', mode: 'agent' })
      const resource = { kind: 'code', id: thread.id }
      await writeFile(join(workspace, 'preview.html'), '<html><body>Verified preview</body></html>')
      await f.h.sessionStore.appendItem(thread.id, makeToolResultItem({ id: 'result', turnId: 'turn',
        threadId: thread.id, callId: 'call', toolName: 'write',
        output: { generatedFiles: [{ path: 'preview.html' }] } }))
      registerRemoteRoutes(f.router, f.runtime)
      const invoke = f.router.match('POST', '/v1/remote/invoke')!
      const call = async (method: string, params: unknown) => {
        const result = await invoke.handler(new Request('http://local/v1/remote/invoke', { method: 'POST',
          headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
          body: JSON.stringify(f.envelope(method, params)) }), { params: {} })
        expect(result.status).toBe(200)
        return result instanceof Response ? result.json() : JSON.parse(result.body)
      }
      const catalogue = await call('artifact.catalog.list', { resource })
      const artifact = catalogue.artifacts[0]
      expect(artifact).toMatchObject({ available: true, kind: 'file' })
      const preview = await call('artifact.preview.get', { resource, id: artifact.id, revision: artifact.revision })
      const path = `/v1/remote/artifact-previews/code/${thread.id}/${artifact.id}/${preview.entryAssetId}`
      const route = f.router.match('GET', path)!
      const url = 'http://local' + path + '?revision=' + encodeURIComponent(artifact.revision)
      const headers = { Authorization: 'Bearer token', 'X-Kun-Remote-Account': 'owner',
        'X-Kun-Remote-Device': 'phone', 'X-Kun-Remote-Authorization': 'connection' }
      const get = (requestHeaders?: Record<string, string>) =>
        route.handler(new Request(url, { headers: requestHeaders }), { params: route.params })
      expect((await get()).status).toBe(401)
      expect((await get({ Authorization: 'Bearer token' })).status).toBe(403)
      for (const key of ['X-Kun-Remote-Account', 'X-Kun-Remote-Device', 'X-Kun-Remote-Authorization'])
        expect((await get({ ...headers, [key]: 'other' })).status).toBe(403)
      const response = await get(headers) as Response
      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(await response.text()).toContain('Verified preview')
      await writeFile(join(workspace, 'preview.html'), '<html>Changed preview</html>')
      expect((await get(headers)).status).toBe(403)
    } finally {
      await f.close()
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
