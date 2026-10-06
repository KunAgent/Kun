import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { KunCapabilitiesConfig } from '../contracts/capabilities.js'
import type { MemoryRecord } from '../contracts/memory.js'
import type { MemoryHistoryResult, MemoryLifecycleResult } from '../contracts/memory-lifecycle.js'
import { heartbeatRuntimeWithManager, ensureServiceManager } from '../manager/manager-client.js'
import { startServiceManager, type ServiceManagerHandle } from '../manager/service-manager.js'
import { memoryRecordPath } from '../memory/memory-canonical-files.js'
import { startKunServe, type KunServeHandle } from './runtime-factory.js'

type Entry = { memory: MemoryRecord; fingerprint: string }
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-memory-managed-runtime-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  let modelRequests = 0
  const model = createServer((_request, response) => {
    modelRequests += 1
    response.writeHead(500)
    response.end('Memory management must not invoke a model')
  })
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise<void>((resolve, reject) => model.close((error) => error ? reject(error) : resolve())))
  const address = model.address()
  if (!address || typeof address === 'string') throw new Error('model trap unavailable')
  const dataDir = join(root, 'data'), controlDir = join(root, 'control'), settingsPath = join(root, 'settings.json')
  let manager: ServiceManagerHandle | undefined
  let runtime: KunServeHandle | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let generation = 0
  const stop = async () => {
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = undefined
    await runtime?.close()
    runtime = undefined
    await manager?.close()
    manager = undefined
  }
  cleanup.push(stop)
  const start = async () => {
    manager = await startServiceManager({ controlDir, dataDir, settingsPath,
      managerToken: 'synthetic-memory-manager', instanceId: 'memory-manager-' + ++generation,
      startedAt: new Date().toISOString() })
    const connection = await ensureServiceManager({ flavor: 'development', controlDir, dataDir, settingsPath })
    runtime = await startKunServe({ host: '127.0.0.1', port: 0, dataDir,
      runtimeToken: 'synthetic-memory-runtime', apiKey: 'synthetic-not-a-credential',
      baseUrl: `http://127.0.0.1:${address.port}`, model: 'synthetic-no-model',
      approvalPolicy: 'auto', sandboxMode: 'workspace-write', tokenEconomyMode: false, insecure: false,
      runtimeFlavor: 'development', discoveryDir: join(root, 'discovery'), serviceManager: connection,
      capabilities: KunCapabilitiesConfig.parse({ memory: { enabled: true, distillation: { enabled: false } } }) })
    const instanceId = runtime.instanceId
    heartbeat = setInterval(() => { void heartbeatRuntimeWithManager({ manager: connection,
      flavor: 'development', instanceId }).catch(() => undefined) }, 5000)
    heartbeat.unref()
  }
  const request = async (path: string, body?: unknown, method?: string) => {
    const response = await fetch(`http://${runtime!.host}:${runtime!.port}${path}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { authorization: 'Bearer synthetic-memory-runtime', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000)
    })
    return { response, value: await response.json() }
  }
  const api = async <T>(path: string, body?: unknown, method?: string): Promise<T> => {
    const result = await request(path, body, method)
    expect(result.response.ok, path + ': ' + JSON.stringify(result.value)).toBe(true)
    return result.value as T
  }
  await start()
  return { dataDir, api, request, modelRequests: () => modelRequests,
    managerRequest: async (body: unknown) => fetch(`${manager!.discovery.baseUrl}/v1/data/memory/update`, {
      method: 'POST', headers: { authorization: 'Bearer synthetic-memory-manager', 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
    }),
    restart: async () => { await stop(); await start() },
    async seedSource(roomId: string, messageId: string, content: string) {
      // Seed a finalized source message through the real fenced Manager room
      // store without admitting a chat turn. Memory operations all use HTTP.
      const rooms = runtime!.runtime.rooms!
      await rooms.exclusive(() => rooms.service.append(roomId, messageId, content))
    } }
}

describe('memory lifecycle through full managed Runtime HTTP composition', () => {
  it('persists ordinary and Agent revisions, restart barriers, erasure and replay without a model', async () => {
    const f = await fixture()
    const input = { content: 'SYNTHETIC_WORKSPACE_FACT_41', scope: 'workspace', workspace: f.dataDir }
    const query = '?workspace=' + encodeURIComponent(f.dataDir)
    let ordinary = (await f.api<{ memory: MemoryRecord }>('/v1/memory', input)).memory
    const ordinaryId = ordinary.id, ordinaryPath = `/v1/memory/${ordinaryId}`
    const missing = await f.request('/v1/memory/mem_missing/history' + query)
    const outOfScope = await f.request(ordinaryPath + '/history?workspace=' + encodeURIComponent(join(f.dataDir, 'other')))
    expect(missing.response.status).toBe(404)
    expect(outOfScope.response.status).toBe(404)
    expect(outOfScope.value).toEqual(missing.value)
    const sentinel = (await f.api<{ memory: MemoryRecord }>('/v1/memory', {
      ...input, content: 'SYNTHETIC_UNRELATED_FACT_82'
    })).memory
    ordinary = (await f.api<{ memory: MemoryRecord }>(ordinaryPath + query, {
      content: 'SYNTHETIC_WORKSPACE_CORRECTION_42', expectedRevision: ordinary.revision
    }, 'PATCH')).memory
    expect(ordinary.revision).toBe(2)
    expect((await f.request(ordinaryPath + query, { content: 'Stale write', expectedRevision: 1 }, 'PATCH')).response.status).toBe(409)
    const history = await f.api<MemoryHistoryResult>(ordinaryPath + '/history' + query)
    expect(history.history[0].snapshot.content).toBe(input.content)
    for (const action of ['rollback', 'disable', 'restore'] as const) {
      const result = await f.api<MemoryLifecycleResult>(ordinaryPath + '/lifecycle' + query, {
        action, expectedRevision: ordinary.revision, ...(action === 'rollback' ? { targetRevision: 1 } : {})
      })
      ordinary = result.memory!
    }
    expect(ordinary).toMatchObject({ content: input.content, revision: 5 })
    expect(ordinary.disabledAt).toBeUndefined()

    const { agent } = await f.api<{ agent: { id: string } }>('/v1/agents', { clientRequestId: 'synthetic-agent', name: 'Memory fixture' })
    const { room } = await f.api<{ room: { id: string } }>(`/v1/agents/${agent.id}/conversation`, {})
    const sourceId = 'synthetic-source-message'
    await f.seedSource(room.id, sourceId, 'SYNTHETIC_AGENT_SOURCE_93')
    const agentPath = `/v1/agents/${agent.id}/memories`
    const agentInput = { clientRequestId: 'synthetic-agent-memory', conversationId: room.id,
      sourceMessageIds: [sourceId], content: 'SYNTHETIC_AGENT_FACT_94', type: 'fact' }
    let owned = await f.api<Entry>(agentPath, agentInput)
    const ownedId = owned.memory.id, ownedPath = `${agentPath}/${ownedId}`
    const agentMissing = await f.request(`${agentPath}/mem_missing/history`)
    const otherOwner = await f.request(`${agentPath}/${ordinaryId}/history`)
    expect(agentMissing.response.status).toBe(404)
    expect(otherOwner.response.status).toBe(404)
    expect(otherOwner.value).toEqual(agentMissing.value)
    const originalFingerprint = owned.fingerprint
    owned = await f.api<Entry>(ownedPath, { clientRequestId: 'edit', expectedFingerprint: owned.fingerprint,
      content: 'SYNTHETIC_AGENT_CORRECTION_95' }, 'PATCH')
    expect(owned.memory.revision).toBe(2)
    // Simulate a second consumer winning after the Agent's preflight read.
    // The authoritative Manager fence must reject the old fingerprint even
    // when the caller supplies the current numeric revision.
    const raced = await f.managerRequest({ config: KunCapabilitiesConfig.parse({ memory: { enabled: true } }).memory,
      value: { id: ownedId, patch: { content: 'Racing overwrite', expectedRevision: 2 },
        access: { agent: { agentId: agent.id, manage: true, expectedFingerprint: originalFingerprint } } } })
    expect(raced.status).toBe(409)
    expect(await raced.json()).toMatchObject({ code: 'memory_revision_conflict' })
    expect((await f.api<Entry>(ownedPath)).memory.content).toBe('SYNTHETIC_AGENT_CORRECTION_95')
    expect((await f.request(ownedPath, { clientRequestId: 'stale', expectedFingerprint: originalFingerprint,
      content: 'Stale Agent write' }, 'PATCH')).response.status).toBe(409)
    expect((await f.api<MemoryHistoryResult>(ownedPath + '/history')).history[0].snapshot.content).toBe(agentInput.content)
    for (const [clientRequestId, patch] of [
      ['rollback', { rollbackRevision: 1 }], ['disable', { disabled: true }], ['restore', { disabled: false }]
    ] as const) {
      owned = await f.api<Entry>(ownedPath, { clientRequestId, expectedFingerprint: owned.fingerprint, ...patch }, 'PATCH')
    }
    expect(owned.memory).toMatchObject({ content: agentInput.content, revision: 5 })
    expect((await f.api<{ memories: MemoryRecord[] }>('/v1/memory?all=true')).memories.map((memory) => memory.id))
      .not.toContain(ownedId)
    ordinary = (await f.api<MemoryLifecycleResult>(ordinaryPath + '/lifecycle' + query, {
      action: 'forget', expectedRevision: ordinary.revision
    })).memory!
    owned = await f.api<Entry>(ownedPath, { clientRequestId: 'forget', expectedFingerprint: owned.fingerprint, forget: true }, 'PATCH')
    expect(JSON.parse(await readFile(memoryRecordPath(join(f.dataDir, 'memory'), ordinaryId), 'utf8')))
      .toMatchObject({ revision: ordinary.revision, deletedAt: ordinary.deletedAt })

    await f.restart()
    const reopened = await f.api<{ memories: MemoryRecord[] }>('/v1/memory' + query + '&include_deleted=true')
    expect(reopened.memories.find((memory) => memory.id === ordinaryId)).toMatchObject({ revision: 6, deletedAt: ordinary.deletedAt })
    owned = await f.api<Entry>(ownedPath)
    expect(owned.memory).toMatchObject({ revision: 6, content: agentInput.content })
    expect(owned.memory.deletedAt).toBeTruthy()
    expect((await f.request('/v1/memory', input)).response.status).toBe(409)
    expect((await f.request(agentPath, agentInput)).response.status).toBe(409)

    const erase = { action: 'erase', expectedRevision: ordinary.revision,
      confirmation: { memoryId: ordinaryId, irreversible: true } }
    const erased = await f.api<MemoryLifecycleResult>(ordinaryPath + '/lifecycle' + query, erase)
    expect(erased).toMatchObject({ erased: true, affectedIds: [ordinaryId] })
    expect(await f.api(ordinaryPath + '/lifecycle' + query, erase)).toEqual(erased)
    expect((await f.request(ordinaryPath + '/lifecycle?workspace=' + encodeURIComponent(join(f.dataDir, 'other')), erase)).response.status).toBe(404)
    expect((await f.request(ordinaryPath + '/lifecycle' + query, { ...erase, expectedRevision: erase.expectedRevision + 1 })).response.status).toBe(404)
    const agentErase = { clientRequestId: 'erase', expectedFingerprint: owned.fingerprint, erase: true,
      eraseConfirmation: { memoryId: ownedId, irreversible: true } }
    const agentErased = await f.api(ownedPath, agentErase, 'PATCH')
    expect(agentErased).toMatchObject({ erased: true, affectedIds: [ownedId] })
    expect(await f.api(ownedPath, agentErase, 'PATCH')).toEqual(agentErased)
    for (const id of [ordinaryId, ownedId]) {
      await expect(readFile(memoryRecordPath(join(f.dataDir, 'memory'), id))).rejects.toMatchObject({ code: 'ENOENT' })
    }
    expect((await f.request(ordinaryPath + '/history' + query)).response.status).toBe(404)
    expect((await f.request(ownedPath + '/history')).response.status).toBe(404)
    expect((await f.api<{ memories: MemoryRecord[] }>('/v1/memory' + query)).memories.map((memory) => memory.id)).toEqual([sentinel.id])
    expect((await f.api<{ messages: Array<{ id: string }> }>(`/v1/rooms/${room.id}/messages`)).messages.map((message) => message.id)).toContain(sourceId)
    expect(f.modelRequests()).toBe(0)
  }, 60000)
})
