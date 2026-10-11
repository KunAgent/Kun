import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { startKunServe } from './runtime-factory.js'

it('publishes metadata-only changes over HTTP SSE and long polling without advancing configuration CAS', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-metadata-events-'))
  const upstream = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ data: [{ id: 'account-model', context_window: 131072, max_input_tokens: 120000 }] }))
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const upstreamUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`
  const server = await startKunServe({ host: '127.0.0.1', port: 0, dataDir, runtimeToken: 'fixture', apiKey: '',
    baseUrl: 'http://127.0.0.1:9', model: 'private-test', approvalPolicy: 'on-request', sandboxMode: 'workspace-write',
    tokenEconomyMode: false, insecure: false })
  const base = `http://${server.host}:${server.port}`, headers = { authorization: 'Bearer fixture', 'content-type': 'application/json' }
  const abort = new AbortController()
  try {
    const initial = await fetch(`${base}/v1/model-connections`, { headers }).then((response) => response.json()) as { revision: number }
    const configured = await fetch(`${base}/v1/model-connections/connect`, { method: 'POST', headers,
      body: JSON.stringify({ expectedRevision: initial.revision, id: 'metadata-provider', name: 'Metadata provider',
        baseUrl: upstreamUrl, credential: 'fixture-only', models: ['account-model'], probe: false })
    }).then((response) => response.json()) as { revision: number; metadataRevision?: number }
    const cursor = `since_revision=${configured.revision}&since_metadata_revision=${configured.metadataRevision ?? 0}`
    const streamPromise = fetch(`${base}/v1/model-connections/events?${cursor}`, { headers: { ...headers, accept: 'text/event-stream' }, signal: abort.signal })
    const pollPromise = fetch(`${base}/v1/model-connections/events?${cursor}&wait_ms=10000`, { headers })
    const probe = await fetch(`${base}/v1/model-connections/metadata-provider/probe`, { method: 'POST', headers }).then((response) => response.json())
    expect(probe).toMatchObject({ ok: true, models: ['account-model'] })
    const poll = await pollPromise.then((response) => response.json()) as { changed: boolean; snapshot: { revision: number; metadataRevision: number } }
    expect(poll.changed).toBe(true)
    expect(poll.snapshot.revision).toBe(configured.revision)
    expect(poll.snapshot.metadataRevision).toBeGreaterThan(configured.metadataRevision ?? 0)
    expect(JSON.parse(await readFile(join(dataDir, 'model-catalog', 'revision.json'), 'utf8'))).toEqual({ revision: poll.snapshot.metadataRevision })
    const legacyPoll = await fetch(`${base}/v1/model-connections/events?since_revision=${configured.revision}`, { headers }).then((response) => response.json())
    expect(legacyPoll.changed).toBe(false)
    const response = await streamPromise, reader = response.body!.getReader()
    const chunk = await reader.read(), body = new TextDecoder().decode(chunk.value)
    expect(body).toContain('event: model_connections')
    const snapshot = JSON.parse(body.split('\ndata: ')[1]!.split('\n')[0]!)
    expect(snapshot).toMatchObject({ revision: configured.revision, metadataRevision: poll.snapshot.metadataRevision,
      providers: expect.arrayContaining([expect.objectContaining({ id: 'metadata-provider',
        modelCapabilities: { 'account-model': expect.objectContaining({ maxInputTokens: 120000 }) } })]) })
    // A metadata update cannot invalidate the user's configuration revision.
    const selected = await fetch(`${base}/v1/model-connections/select`, { method: 'POST', headers,
      body: JSON.stringify({ expectedRevision: configured.revision, providerId: 'metadata-provider', model: 'account-model' }) })
    expect(selected.status).toBe(200)
    abort.abort(); await reader.cancel().catch(() => undefined)
  } finally {
    abort.abort(); await server.close(); upstream.closeAllConnections()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
    await rm(dataDir, { recursive: true, force: true })
  }
}, 30_000)
