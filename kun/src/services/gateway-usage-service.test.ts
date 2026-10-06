import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileSessionStore } from '../adapters/file/file-session-store.js'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { emptyUsageSnapshot } from '../contracts/usage.js'
import type { ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
import { gatewayChatCompletions, gatewayResponses } from '../server/routes/openai-model-gateway.js'
import { wrapGatewayUsage } from '../server/routes/gateway-usage.js'
import { gatewayMessages } from '../server/routes/anthropic-messages-gateway.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { createAesEncryptor } from '../security/secret-store.js'
import { GatewayCredentialService } from './gateway-credential-service.js'
import { GatewayUsageService, gatewayAuditThreadId, gatewaySessionId } from './gateway-usage-service.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { ThreadService } from './thread-service.js'
import { UsageService } from './usage-service.js'

const directories: string[] = []
const client = { clientId: 'gc_12345678-1234-1234-1234-123456789abc', name: 'Editor', credentialKind: 'client' as const }
const input = { client, sessionHeader: 'session-1', requestedModelId: 'smart', resolved: { model: 'smart', providerId: '__local_model_gateway__' } }

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-gateway-usage-'))
  directories.push(dataDir)
  const sessionStore = new FileSessionStore({ dataDir })
  const threadStore = new InMemoryThreadStore()
  const eventBus = new InMemoryEventBus()
  const nowIso = () => '2026-10-04T08:00:00.000Z'
  const events = new RuntimeEventRecorder({ sessionStore, eventBus, nowIso, allocateSeq: (id) => eventBus.allocateSeq(id) })
  const threadService = new ThreadService({ threadStore, sessionStore, events, ids: new SequentialIdGenerator(), nowIso })
  const usageService = new UsageService()
  let time = 1_000
  const deps = { workspace: dataDir, threadService, usageService, sessionStore, events, now: () => time }
  return { ...deps, dataDir, threadStore, service: new GatewayUsageService(deps), tick: (ms: number) => { time += ms } }
}

afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

describe('GatewayUsageService', () => {
  it('persists actual routing, usage and safe request metrics through the existing durable index', async () => {
    const f = await fixture()
    const recorder = await f.service.begin(input)
    const auditId = gatewayAuditThreadId(client.clientId)
    expect(recorder.attribution.threadId).toBe(auditId)
    expect(await f.threadStore.get(auditId)).toMatchObject({ relation: 'side', modelRequestCaptureEnabled: false, turns: [] })
    recorder.observe({ kind: 'retrying', attempt: 1, maxAttempts: 2, delayMs: 10, failureSummary: 'secret diagnostic' })
    recorder.observe({ kind: 'route_switching', from: { providerId: 'one', modelId: 'first' }, to: { providerId: 'two', modelId: 'actual' } })
    f.tick(20)
    recorder.observe({ kind: 'assistant_text_delta', text: 'private transcript', route: {
      routePoolId: 'pool', targetId: 'target', providerId: 'two', modelId: 'actual', requestedModelId: 'smart'
    } })
    f.tick(80)
    recorder.observe({ kind: 'usage', usage: { ...emptyUsageSnapshot(), promptTokens: 10, completionTokens: 5, totalTokens: 15, turns: 1, costUsd: 0.01 } })
    await recorder.finish('completed')
    await recorder.finish('cancelled')
    const reopened = new FileSessionStore({ dataDir: f.dataDir })
    const records = await reopened.loadUsageRecords({ threadId: auditId })
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ source: 'public-gateway', model: 'actual', providerId: 'two', usage: {
      promptTokens: 10, completionTokens: 5, actualProviderId: 'two', actualModelId: 'actual', requestedModelId: 'smart',
      requestTtftMs: 20, requestGenerationMs: 80,
      gateway: { clientId: client.clientId, latencyMs: 100, status: 'completed', retryCount: 1, failoverCount: 1, tokenUsage: 'upstream', costBasis: 'unverified' }
    } })
    const persisted = JSON.stringify(await reopened.loadEventsSince(auditId, 0))
    expect(persisted).not.toContain('private transcript')
    expect(persisted).not.toContain('secret diagnostic')
    expect(persisted).not.toContain('session-1')
    expect((await reopened.loadItems(auditId))).toEqual([])
    expect((await f.service.summary(client.clientId)).requests).toHaveLength(1)
  })

  it('serializes same-client initialization and cumulative commits without session-created threads', async () => {
    const f = await fixture()
    const create = vi.spyOn(f.threadService, 'create')
    const [first, second] = await Promise.all([f.service.begin(input), f.service.begin({ ...input, sessionHeader: 'session-2' })])
    expect(create).toHaveBeenCalledTimes(1)
    for (const recorder of [first, second]) recorder.observe({ kind: 'usage', usage: {
      ...emptyUsageSnapshot(), promptTokens: 5, completionTokens: 2, totalTokens: 7, turns: 1
    } })
    await Promise.all([first.finish('completed'), second.finish('completed')])
    const records = await f.sessionStore.loadUsageRecords({ threadId: first.attribution.threadId })
    expect(records.map((record) => record.usage.promptTokens)).toEqual([5, 5])
    expect(records[0].usage.gateway?.sessionId).not.toBe(records[1].usage.gateway?.sessionId)
    expect((await f.threadStore.list({ includeSide: true }))).toHaveLength(1)
    expect((await f.service.summary(client.clientId)).usage.promptTokens).toBe(10)
  })

  it('retains failure/cancellation without fabricating absent provider tokens or billed cost', async () => {
    const f = await fixture()
    const failed = await f.service.begin(input)
    failed.observe({ kind: 'error', message: 'credential or upstream secret', failure: { httpStatus: 429, category: 'rate_limit', failoverAllowed: true } })
    await failed.finish('failed')
    const cancelled = await f.service.begin(input)
    await cancelled.finish('cancelled')
    const records = await f.sessionStore.loadUsageRecords({ threadId: failed.attribution.threadId })
    expect(records).toHaveLength(2)
    expect(records[0].usage).toMatchObject({ promptTokens: 0, completionTokens: 0, hasError: true, gateway: { status: 'failed', httpStatus: 429, tokenUsage: 'unavailable' } })
    expect(records[0].usage.costUsd).toBeUndefined()
    expect(records[1].usage.gateway?.status).toBe('cancelled')
    expect(JSON.stringify(records)).not.toContain('credential or upstream secret')
  })

  it('attributes all three public wire APIs in streaming and buffered modes without accepting a thread header', async () => {
    const f = await fixture()
    const seen: ModelRequest[] = []
    const runtime = {
      ...f,
      modelConnections: { snapshot: async () => ({ providers: [{
        id: 'provider', kind: 'http', authType: 'api-key', configured: true,
        credentialStatus: 'ready', models: ['model'], selectedModel: 'model'
      }], failover: [] }) },
      modelGateway: {
        enabled: () => true, exposeProviderModels: () => true, pools: () => [],
        credentials: { verify: (key: string) => key === 'public', identify: () => client },
        usage: f.service
      },
      modelClient: { async *stream(request: ModelRequest) {
        seen.push(request)
        yield { kind: 'assistant_text_delta', text: 'private output' }
        yield { kind: 'usage', usage: { ...emptyUsageSnapshot(), promptTokens: 2, completionTokens: 1, totalTokens: 3, turns: 1 } }
        yield { kind: 'completed', stopReason: 'stop' }
      } }
    } as unknown as ServerRuntime
    for (const stream of [false, true]) {
      for (const [handler, shape] of [[gatewayChatCompletions, 'chat'], [gatewayResponses, 'responses'], [gatewayMessages, 'anthropic']] as const) {
        const request = new Request('http://127.0.0.1/v1/test', {
          method: 'POST', headers: { authorization: 'Bearer public', 'content-type': 'application/json',
            'x-kun-gateway-session-id': 'victim-thread', 'x-kun-thread-id': 'victim-thread' },
          body: JSON.stringify({ model: 'provider/model', stream, ...(shape === 'responses'
            ? { input: 'private input' }
            : { messages: [{ role: 'user', content: 'private input' }], ...(shape === 'anthropic' ? { max_tokens: 32 } : {}) }) })
        })
        const response = await handler(runtime, request)
        expect(response.status).toBe(200)
        if (response instanceof Response) await response.text()
      }
    }
    expect(seen).toHaveLength(6)
    expect(new Set(seen.map((request) => request.turnId)).size).toBe(6)
    expect(seen.every((request) => request.threadId === gatewayAuditThreadId(client.clientId))).toBe(true)
    const records = await f.sessionStore.loadUsageRecords({ threadId: gatewayAuditThreadId(client.clientId) })
    expect(records).toHaveLength(6)
    expect(records.every((record) => record.usage.gateway?.status === 'completed')).toBe(true)
    expect(JSON.stringify(records)).not.toMatch(/private input|private output|victim-thread/)
  })

  it('persists serializer failures exactly once before and after upstream completion in every wire API', async () => {
    const f = await fixture()
    let output: ModelStreamChunk[] = []
    const runtime = {
      ...f,
      modelConnections: { snapshot: async () => ({ providers: [{
        id: 'provider', kind: 'http', authType: 'api-key', configured: true,
        credentialStatus: 'ready', models: ['model'], selectedModel: 'model'
      }], failover: [] }) },
      modelGateway: {
        enabled: () => true, exposeProviderModels: () => true, pools: () => [],
        credentials: { verify: (key: string) => key === 'public', identify: () => client }, usage: f.service
      },
      modelClient: { async *stream() { yield* output } }
    } as unknown as ServerRuntime
    for (const stream of [false, true]) {
      for (const [handler, shape] of [[gatewayChatCompletions, 'chat'], [gatewayResponses, 'responses'], [gatewayMessages, 'anthropic']] as const) {
        for (const invalid of ['image', 'tool']) {
          output = invalid === 'image'
            ? [{ kind: 'image_generation_complete', imageBase64: 'private image', mimeType: 'image/png' }]
            : [{ kind: 'tool_call_delta', callId: 'call', toolName: 'run', argumentsDelta: '{"bad":' }, { kind: 'completed', stopReason: 'tool_calls' }]
          const response = await handler(runtime, new Request('http://127.0.0.1/v1/test', {
            method: 'POST', headers: { authorization: 'Bearer public', 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'provider/model', stream, ...(shape === 'responses' ? { input: 'hello' }
              : { messages: [{ role: 'user', content: 'hello' }], max_tokens: 32 }) })
          }))
          if (response instanceof Response) expect(await response.text()).toMatch(/error|response.failed/)
          else expect(response.status).toBe(502)
        }
      }
    }
    const records = await f.sessionStore.loadUsageRecords({ threadId: gatewayAuditThreadId(client.clientId) })
    expect(records).toHaveLength(12)
    expect(new Set(records.map((record) => record.usage.gateway?.requestId)).size).toBe(12)
    expect(records.every((record) => record.usage.gateway?.status === 'failed' && record.usage.hasError)).toBe(true)
  })

  it('lets admitted streams complete after revocation while new calls reject the revoked key', async () => {
    for (const handler of [gatewayChatCompletions, gatewayMessages]) {
      const f = await fixture()
      const credentials = new GatewayCredentialService(f.dataDir, createAesEncryptor(randomBytes(32)))
      await credentials.initialize()
      await credentials.ensure() // A live shared key must never rescue an invalid client key.
      // This fixture exercises migration/revocation of an existing unrestricted client.
      const issued = await credentials.createClient('Streaming client', 'legacy-unrestricted')
      let release!: () => void
      const resume = new Promise<void>((resolve) => { release = resolve })
      let calls = 0
      const runtime = {
        ...f,
        modelConnections: { snapshot: async () => ({ providers: [{
          id: 'provider', kind: 'http', authType: 'api-key', configured: true,
          credentialStatus: 'ready', models: ['model'], selectedModel: 'model'
        }], failover: [] }) },
        modelGateway: {
          enabled: () => credentials.hasActiveCredentials(), exposeProviderModels: () => true,
          pools: () => [], credentials, usage: f.service
        },
        modelClient: { async *stream() {
          calls += 1
          yield { kind: 'assistant_text_delta', text: 'started' }
          await resume
          yield { kind: 'assistant_text_delta', text: 'finished' }
          yield { kind: 'usage', usage: { ...emptyUsageSnapshot(), promptTokens: 2, completionTokens: 2, totalTokens: 4, turns: 1 } }
          yield { kind: 'completed', stopReason: 'stop' }
        } }
      } as unknown as ServerRuntime
      const request = () => new Request('http://127.0.0.1/v1/test', {
        method: 'POST', headers: { authorization: `Bearer ${issued.key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'provider/model', stream: true, max_tokens: 32, messages: [{ role: 'user', content: 'hello' }] })
      })
      const active = await handler(runtime, request())
      expect(active).toBeInstanceOf(Response)
      const reader = (active as Response).body!.getReader()
      const decoder = new TextDecoder()
      let wire = ''
      while (!wire.includes('started')) {
        const part = await reader.read()
        expect(part.done).toBe(false)
        wire += decoder.decode(part.value)
      }
      await credentials.revokeClient(issued.client.clientId)
      expect((await handler(runtime, request())).status).toBe(401)
      expect(credentials.hasActiveCredentials()).toBe(true)
      expect(calls).toBe(1)
      release()
      for (;;) {
        const part = await reader.read()
        if (part.done) break
        wire += decoder.decode(part.value)
      }
      expect(wire).toContain('finished')
      const records = await f.sessionStore.loadUsageRecords({ threadId: gatewayAuditThreadId(issued.client.clientId) })
      expect(records).toHaveLength(1)
      expect(records[0].usage.gateway?.status).toBe('completed')
    }
  })

  it('persists a genuine disconnect as cancelled even when the upstream is stuck', async () => {
    const f = await fixture()
    const recorder = await f.service.begin(input)
    const upstream: AsyncIterableIterator<ModelStreamChunk> = {
      [Symbol.asyncIterator]() { return this },
      next: () => new Promise<IteratorResult<ModelStreamChunk>>(() => undefined),
      return: () => new Promise<IteratorResult<ModelStreamChunk>>(() => undefined)
    }
    const stream = wrapGatewayUsage(upstream, recorder)
    const iterator = stream[Symbol.asyncIterator]()
    const pending = iterator.next()
    await Promise.resolve()
    await iterator.return?.()
    await pending
    const records = await f.sessionStore.loadUsageRecords({ threadId: recorder.attribution.threadId })
    expect(records).toHaveLength(1)
    expect(records[0].usage.gateway?.status).toBe('cancelled')
  })

  it('namespaces sessions by authenticated client and rejects invalid identifiers before writing', async () => {
    const f = await fixture()
    expect(gatewaySessionId('one', 'actual-kun-thread')).not.toBe(gatewaySessionId('two', 'actual-kun-thread'))
    expect(gatewaySessionId('one', 'actual-kun-thread')).not.toBe('actual-kun-thread')
    for (const sessionHeader of ['', '../thread', 'a'.repeat(129), 'line\nbreak']) {
      await expect(f.service.begin({ ...input, sessionHeader })).rejects.toThrow('x-kun-gateway-session-id')
    }
    expect(await f.threadStore.list()).toEqual([])
  })
})
