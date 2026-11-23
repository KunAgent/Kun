import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { startServiceManager } from '../manager/service-manager.js'
import { startKunServe } from './runtime-factory.js'
import { heartbeatRuntimeWithManager } from '../manager/manager-client.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

it('delivers an isolated Work annotation through native HTTP, SSE and the configured model', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-work-annotation-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const calls: Array<{ tools?: unknown[]; messages: unknown[] }> = []
  const answer = JSON.stringify({ text: 'The original input is added back.', suggestion: { kind: 'insertAfter', text: 'Add the input.'} })
  const model = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url?.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'fixture-text', object: 'model' }] }))
      return
    }
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.writeHead(404).end()
      return
    }
    const chunks = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString())
    calls.push(body)
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: answer}, finish_reason: null }] }) + '\n\n')
    res.end('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n')
  })
  await new Promise<void>(done => model.listen(0, '127.0.0.1', done))
  cleanup.push(async () => { model.closeAllConnections(); await new Promise<void>(done => model.close(() => done())) })
  const address = model.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const baseUrl = `http://127.0.0.1:${address.port}`
  const manager = await startServiceManager({ controlDir: join(root, 'control'), dataDir: join(root, 'data'),
    settingsPath: join(root, 'settings.json'), managerToken: 'fixture-manager', instanceId: 'fixture-manager',
    startedAt: new Date().toISOString() })
  cleanup.push(() => manager.close())
  const connection = { discovery: manager.discovery }
  const runtime = await startKunServe({ host: '127.0.0.1', port: 0, dataDir: join(root, 'data'), runtimeToken: 'fixture-runtime',
    apiKey: 'synthetic', baseUrl, model: 'fixture-text', activeProviderId: 'annotation-fixture',
    providers: { 'annotation-fixture': { apiKey: 'synthetic', baseUrl, models: ['fixture-text'], selectedModel: 'fixture-text' } },
    approvalPolicy: 'on-request', sandboxMode: 'read-only', tokenEconomyMode: false, insecure: false,
    runtimeFlavor: 'development', discoveryDir: join(root, 'discovery'), serviceManager: connection })
  cleanup.push(() => runtime.close())
  const heartbeat = setInterval(() => { void heartbeatRuntimeWithManager({ manager: connection,
    flavor: 'development', instanceId:runtime.instanceId }).catch(() => undefined) }, 5000)
  heartbeat.unref()
  cleanup.push(async () => clearInterval(heartbeat))
  const server = 'http://' + runtime.host + ':' + runtime.port
  const headers = { authorization: 'Bearer fixture-runtime', 'content-type': 'application/json' }
  async function json<T>(path: string, body?: unknown): Promise<T> {
    const result = await fetch(server + path, { headers, signal: AbortSignal.timeout(30_000),
      ...(body ? { method: 'POST', body:JSON.stringify(body)} : {}) })
    const value = await result.json()
    expect(result.ok, path + ' ' + JSON.stringify(value)).toBe(true)
    return value as T
  }

  const registry = await json<{defaultProviderId:string; defaultModel:string}>('/v1/model-connections')
  const route = { providerId: registry.defaultProviderId, model: registry.defaultModel }
  expect(route).toEqual({ providerId: 'annotation-fixture', model: 'fixture-text' })
  const thread = await json<ThreadRecord>('/v1/threads', { purpose: 'work-annotation', title: 'Passage',
    workspace: root, agentSurface: 'write', harnessId: 'kun', sandboxMode: 'read-only', ...route })
  expect(thread.relation).toBe('side')
  expect(calls).toHaveLength(0)
  const base = '/v1/threads/' + thread.id
  const request = { prompt: '@Kun explain the residual', clientRequestId: 'annotation-send', mode: 'agent', orchestration: 'direct',
    agentSurface: 'write', clientSurface: 'gui', harnessId: 'kun', sandboxMode: 'read-only', ...route,
    paperContext: { version:1, scope: 'work-annotation', privacy: 'model-provider', purpose: 'Discuss the selected passage',
      maxModelRequests:1, ...route, sources: [{ paperId: 'annotation', title: 'Selection', text: 'SYNTHETIC_SELECTED_PASSAGE'}] } }
  const { turnId } = await json<{turnId:string}>(base + '/turns', request)
  const abort = new AbortController()
  const response = await fetch(server + base + '/events?since_seq=0', { headers, signal:AbortSignal.any([abort.signal, AbortSignal.timeout(45_000)]) })
  expect(response.ok).toBe(true)
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let events = ''
  try {
    while (!events.includes('turn_completed') && !events.includes('turn_failed')) {
      const chunk = await reader.read()
      if (chunk.done) break
      events += decoder.decode(chunk.value, { stream: true })
    }
  } finally { abort.abort(); await reader.cancel().catch(() => undefined) }
  const turn = await json<Turn>(base + '/turns/' + turnId)
  expect(turn.status, turn.error).toBe('completed')
  expect(events).toContain('turn_completed')
  expect(turn.items).toContainEqual(expect.objectContaining({ kind: 'assistant_text', text:answer }))
  expect(await json(base + '/turns', request)).toMatchObject({ turnId })
  expect(calls).toHaveLength(1)
  expect(calls[0].tools ?? []).toHaveLength(0)
  expect(JSON.stringify(calls[0].messages)).toContain('SYNTHETIC_SELECTED_PASSAGE')
}, 90_000)
