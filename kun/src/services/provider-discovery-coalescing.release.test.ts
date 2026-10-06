import { createServer, type ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { ModelConnectionRegistry } from './model-connection-registry.js'
import { ExtensionCredentialStore } from './extension-credential-store.js'

const sleep = (ms: number) => new Promise<void>((accept) => setTimeout(accept, ms))
async function until(check: () => boolean) {
  const deadline = Date.now() + 3000
  while (!check()) { if (Date.now() > deadline) throw new Error('Fixture HTTP request did not arrive'); await sleep(5) }
}

it('coalesces live refreshes, cancels one subscriber independently and rejects an obsolete credential response', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-catalog-refresh-release-'))
  const responses: ServerResponse[] = []
  const server = createServer((_request, response) => responses.push(response))
  await new Promise<void>((accept) => server.listen(0, '127.0.0.1', accept))
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  const registry = new ModelConnectionRegistry({ dataDir,
    credentials: new ExtensionCredentialStore({ dataDir, profileId: 'release' }), onChanged: async () => undefined })
  try {
    await registry.initialize()
    await registry.connect({ expectedRevision: 0, id: 'one', name: 'One', kind: 'http', authType: 'api-key',
      baseUrl: endpoint, endpointFormat: 'chat_completions', models: ['user-selected'],
      credential: 'fixture-first-key', probe: false, select: false })
    const controller = new AbortController()
    const first = registry.probe('one', controller.signal)
    const second = registry.probe('one')
    await until(() => responses.length === 1)
    await sleep(20)
    controller.abort(new Error('only-first-caller-cancelled'))
    await expect(first).rejects.toThrow('only-first-caller-cancelled')
    responses[0]!.setHeader('content-type', 'application/json')
    responses[0]!.end(JSON.stringify({ data: [{ id: 'discovered-new' }] }))
    expect(await second).toEqual({ ok: true, models: ['discovered-new'] })
    expect(responses).toHaveLength(1)
    expect((await registry.snapshot()).providers[0]?.models).toEqual(['user-selected'])
    expect(await registry.catalog('one')).toMatchObject({ unavailableModels: ['user-selected'] })

    const obsolete = registry.probe('one')
    await until(() => responses.length === 2)
    const revision = (await registry.snapshot()).revision
    await registry.replaceCredential('one', { expectedRevision: revision, credential: 'fixture-replacement-key' })
    responses[1]!.setHeader('content-type', 'application/json')
    responses[1]!.end(JSON.stringify({ data: [{ id: 'obsolete-account-only' }] }))
    await expect(obsolete).rejects.toThrow('configuration changed')
    const historical = await registry.catalog('one')
    expect(historical?.models).not.toContain('obsolete-account-only')
    expect(historical?.identityChanged).toBe(true)

    const current = registry.probe('one')
    await until(() => responses.length === 3)
    responses[2]!.setHeader('content-type', 'application/json')
    responses[2]!.end(JSON.stringify({ data: [] }))
    expect(await current).toEqual({ ok: true, models: [] })
    expect((await registry.catalog('one'))?.models).toEqual([])
    expect((await registry.snapshot()).providers[0]?.models).toEqual(['user-selected'])
    expect((await registry.catalog('one'))?.identityChanged).toBe(false)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((accept) => server.close(() => accept()))
    await rm(dataDir, { recursive: true, force: true })
  }
})
