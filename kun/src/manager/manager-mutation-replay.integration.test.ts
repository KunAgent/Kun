import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MANAGER_MUTATION_REPLAY_CAPABILITY } from '../contracts/manager-request-replay.js'
import type { ServiceManagerConnection } from './manager-client.js'
import { ManagerSharedDataStore } from './shared-data-store.js'
import { ServiceManagerState } from './service-manager-state.js'
import { buildServiceManagerRouter } from './service-manager-router.js'
import { callManagerStore } from './remote-data-store-request.js'
import { runWithTurnMutationFence } from './turn-mutation-context.js'

describe('Manager acknowledged mutation transport recovery', () => {
  it('recovers lost sequence/event acknowledgements without duplicating durable events and still rejects stale fences', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-mutation-replay-'))
    const sharedData = await ManagerSharedDataStore.create(root)
    const state = new ServiceManagerState()
    state.register({
      flavor: 'production', instanceId: 'runtime', pid: process.pid, startedAt: new Date().toISOString(),
      host: '127.0.0.1', port: 18899, baseUrl: 'http://127.0.0.1:18899', runtimeToken: 'test-runtime-token'
    })
    const lease = state.acquireLease({
      threadId: 'thread', turnId: 'turn', ownerFlavor: 'production', ownerInstanceId: 'runtime'
    })
    const router = buildServiceManagerRouter({
      managerToken: 'test-token', instanceId: 'manager', startedAt: new Date().toISOString(), state, sharedData
    })
    const requests = new Map<string, unknown[]>()
    const server = createServer((incoming, outgoing) => {
      void (async () => {
        const chunks: Buffer[] = []
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
        const body = Buffer.concat(chunks).toString()
        const path = incoming.url!
        const seen = requests.get(path) ?? []
        seen.push(JSON.parse(body))
        requests.set(path, seen)
        const request = new Request(`http://127.0.0.1${path}`, {
          method: 'POST', headers: { authorization: incoming.headers.authorization! }, body
        })
        const match = router.match('POST', path)!
        const response = await match.handler(request, { params: match.params })
        if (response instanceof Response) throw new Error('Expected Manager JSON response')
        // The mutation has completed. Only its acknowledgement is lost.
        if (response.status === 200 && seen.length <= (path.endsWith('/appendEvent') ? 3 : 1)) {
          incoming.socket.destroy()
          return
        }
        outgoing.writeHead(response.status, response.headers)
        outgoing.end(response.body)
      })().catch(() => { outgoing.writeHead(500); outgoing.end() })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No test port')
    const manager = { discovery: {
      instanceId: 'manager', managerToken: 'test-token', baseUrl: `http://127.0.0.1:${address.port}`,
      capabilities: [MANAGER_MUTATION_REPLAY_CAPABILITY]
    } } as ServiceManagerConnection
    try {
      await runWithTurnMutationFence(lease, async () => {
        const seq = await callManagerStore(manager, 'session', 'allocateEventSeq', { threadId: 'thread' })
        expect(seq).toBe(1)
        await callManagerStore(manager, 'session', 'appendEvent', {
          threadId: 'thread',
          event: { kind: 'turn_started', threadId: 'thread', turnId: 'turn', seq, timestamp: new Date().toISOString() }
        })
        expect(await callManagerStore(manager, 'session', 'allocateEventSeq', { threadId: 'thread' })).toBe(2)
      })
      const lines = (await readFile(join(root, 'threads/thread/events.jsonl'), 'utf8')).trim().split('\n')
      expect(lines).toHaveLength(1)
      expect(JSON.parse(lines[0]!)).toMatchObject({ kind: 'turn_started', seq: 1 })
      for (const path of ['/v1/data/session/appendEvent', '/v1/data/session/allocateEventSeq']) {
        expect(requests.get(path)![0]).toEqual(requests.get(path)![1])
      }
      expect(requests.get('/v1/data/session/appendEvent')).toHaveLength(4)
      state.releaseLease(lease)
      state.acquireLease({ threadId: 'thread', turnId: 'next', ownerFlavor: 'production', ownerInstanceId: 'runtime' })
      const old = requests.get('/v1/data/session/appendEvent')![0]
      const response = await fetch(`${manager.discovery.baseUrl}/v1/data/session/appendEvent`, {
        method: 'POST', headers: { authorization: 'Bearer test-token' }, body: JSON.stringify(old)
      })
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ code: 'stale_turn_fence' })
    } finally {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await sharedData.close()
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})
