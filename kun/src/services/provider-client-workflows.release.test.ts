import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'
import { ModelConnectionRegistry } from './model-connection-registry.js'
import { ExtensionCredentialStore } from './extension-credential-store.js'

it('keeps three same-template accounts independent through key rotation, rename, regroup and restart without any CLI', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kun-provider-account-workflow-'))
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ data: [{ id: 'coding' }, { id: 'new-discovered' }] }))
  })
  await new Promise<void>((accept) => server.listen(0, '127.0.0.1', accept))
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  const makeRegistry = () => new ModelConnectionRegistry({ dataDir: directory,
    credentials: new ExtensionCredentialStore({ dataDir: directory, profileId: 'release' }), onChanged: async () => undefined })
  vi.stubEnv('PATH', '')
  try {
    const registry = makeRegistry()
    await registry.initialize()
    for (const id of ['one', 'two', 'three']) await registry.connect({ expectedRevision: (await registry.snapshot()).revision,
      id, name: id, presetSource: 'same-template', kind: 'http', authType: 'api-key',
      baseUrl: endpoint, endpointFormat: 'chat_completions', credential: `fixture-key-${id}`,
      models: ['coding'], probe: false, select: false })
    const original = await registry.snapshot()
    await registry.replaceCredential('two', { expectedRevision: original.revision, credential: 'fixture-two-rotated' })
    await registry.patch('one', { expectedRevision: (await registry.snapshot()).revision, name: 'Renamed One' })
    const preview = await registry.previewConfiguration({ expectedRevision: (await registry.snapshot()).revision, operations: [
      { kind: 'put-group', group: { id: 'team', name: 'Team', enabled: true, defaults: {} } },
      { kind: 'configure-connection', connectionId: 'one', configuration: { groupId: 'team', enabled: true, inherit: [], manualModels: [] } }
    ] })
    await registry.commitConfiguration({ expectedRevision: preview.expectedRevision, previewId: preview.previewId, idempotencyKey: 'group-account-workflow' })
    expect(await registry.probe('one')).toEqual({ ok: true, models: ['coding', 'new-discovered'] })
    expect((await registry.snapshot()).providers.find((profile) => profile.id === 'one')?.models).toEqual(['coding'])
    const reopened = makeRegistry()
    await reopened.initialize()
    const current = await reopened.snapshot()
    expect(current.providers.map((profile) => [profile.id, profile.accountId]))
      .toEqual(original.providers.map((profile) => [profile.id, profile.accountId]))
    expect(current.providers.find((profile) => profile.id === 'one')?.name).toBe('Renamed One')
    expect((await reopened.configurationSnapshot()).configuration.connections.one?.groupId).toBe('team')
    expect(await reopened.credentialForCompatibility('one')).toBe('fixture-key-one')
    expect(await reopened.credentialForCompatibility('two')).toBe('fixture-two-rotated')
    expect(await reopened.credentialForCompatibility('three')).toBe('fixture-key-three')
    expect((await reopened.materializeReadOnly()).providers.size).toBe(3)
  } finally {
    vi.unstubAllEnvs()
    server.closeAllConnections()
    await new Promise<void>((accept) => server.close(() => accept()))
    await rm(directory, { recursive: true, force: true })
  }
})
