import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startKunServe, type KunServeHandle } from './runtime-factory.js'
import {
  runtimeDataDirClaimsPath,
  runtimeDataDirOwnerPath
} from './runtime-data-dir-migration-lock.js'
import { runtimeDiscoveryPath } from './runtime-discovery.js'
import { KUN_VERSION } from '../version.js'

const roots: string[] = []
const servers: KunServeHandle[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close().catch(() => undefined)))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('runtime lifecycle API', () => {
  it('settles discovery and standalone writer leases after an earlier close failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-runtime-close-'))
    roots.push(root)
    const dataDir = join(root, 'data')
    const server = await startKunServe({
      host: '127.0.0.1',
      port: 0,
      dataDir,
      runtimeToken: 'secret',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:9',
      model: 'test-model',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      tokenEconomyMode: false,
      insecure: false,
      launchMode: 'shared'
    })
    servers.push(server)
    expect((await readdir(runtimeDataDirClaimsPath(dataDir)))
      .filter((name) => name.startsWith('claim-'))).toHaveLength(1)
    const backgroundShellRuntime = server.runtime.backgroundShellRuntime
    if (!backgroundShellRuntime) throw new Error('expected background shell Runtime')
    const originalBackgroundShutdown = backgroundShellRuntime.shutdown.bind(backgroundShellRuntime)
    const shutdown = vi.spyOn(backgroundShellRuntime, 'shutdown').mockImplementation(async () => {
      await originalBackgroundShutdown()
      throw new Error('injected Runtime shutdown failure')
    })

    await expect(server.close()).rejects.toThrow('injected Runtime shutdown failure')
    shutdown.mockRestore()
    await expect(readFile(runtimeDataDirOwnerPath(dataDir), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(runtimeDiscoveryPath(dataDir), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
    expect((await readdir(runtimeDataDirClaimsPath(dataDir)))
      .filter((name) => name.startsWith('claim-'))).toEqual([])
  })

  it('reports instance identity and only shuts down the current instance', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-runtime-lifecycle-'))
    roots.push(dataDir)
    const server = await startKunServe({
      host: '127.0.0.1',
      port: 0,
      dataDir,
      runtimeToken: 'secret',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:9',
      model: 'test-model',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      tokenEconomyMode: false,
      insecure: false,
      buildId: 'b'.repeat(64),
      launchMode: 'shared'
    })
    servers.push(server)
    const baseUrl = `http://${server.host}:${server.port}`
    const headers = { authorization: 'Bearer secret', 'content-type': 'application/json' }
    const infoResponse = await fetch(`${baseUrl}/v1/runtime/info`, { headers })
    expect(infoResponse.headers.get('x-kun-active-turn-count')).toBe('0')
    const info = await infoResponse.json()
    expect(info).toMatchObject({
      instanceId: server.instanceId,
      serviceVersion: KUN_VERSION,
      buildId: 'b'.repeat(64),
      launchMode: 'shared'
    })

    const initialConnections = await fetch(`${baseUrl}/v1/model-connections`, { headers })
      .then((response) => response.json()) as { revision: number }
    const eventAbort = new AbortController()
    const eventResponsePromise = fetch(
      `${baseUrl}/v1/model-connections/events?since_revision=${initialConnections.revision}`,
      { headers: { ...headers, accept: 'text/event-stream' }, signal: eventAbort.signal }
    )
    const connectedResponse = await fetch(`${baseUrl}/v1/model-connections/connect`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        expectedRevision: initialConnections.revision,
        name: 'Test custom',
        baseUrl: 'https://example.com/v1',
        credential: 'must-never-be-returned',
        models: ['model-a'],
        selectedModel: 'model-a',
        probe: false
      })
    })
    const connectedText = await connectedResponse.text()
    expect(connectedResponse.status, connectedText).toBe(201)
    expect(connectedText).not.toContain('must-never-be-returned')
    const eventResponse = await eventResponsePromise
    expect(eventResponse.headers.get('content-type')).toContain('text/event-stream')
    const eventReader = eventResponse.body!.getReader()
    const eventChunk = await eventReader.read()
    expect(new TextDecoder().decode(eventChunk.value)).toContain('event: model_connections')
    eventAbort.abort()
    await eventReader.cancel().catch(() => undefined)
    const conflict = await fetch(`${baseUrl}/v1/model-connections/select`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        expectedRevision: initialConnections.revision,
        providerId: 'test-custom',
        model: 'model-a'
      })
    })
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({ code: 'revision_conflict' })

    const stale = await fetch(`${baseUrl}/v1/runtime/shutdown`, {
      method: 'POST', headers, body: JSON.stringify({ instanceId: 'stale' })
    })
    expect(stale.status).toBe(409)
    const accepted = await fetch(`${baseUrl}/v1/runtime/shutdown`, {
      method: 'POST', headers, body: JSON.stringify({ instanceId: server.instanceId })
    })
    expect(accepted.status).toBe(200)
    await server.shutdownRequested
  })
})
