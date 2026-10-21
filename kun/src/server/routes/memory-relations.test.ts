import { describe, expect, it, vi } from 'vitest'
import { MemoryRecord } from '../../contracts/memory.js'
import type { MemoryStore } from '../../memory/memory-store.js'
import { MemoryRelationConflictError } from '../../memory/memory-relations.js'
import { Router } from '../router.js'
import { memoryRelations } from './memory-relations.js'
import { registerResourceRoutes } from './register-resource-routes.js'
import type { ServerRuntime } from './server-runtime.js'

const request = (value: unknown) => new Request('http://kun.local/v1/memory/relations', {
  method: 'POST', body: JSON.stringify(value)
})

describe('Memory relation HTTP boundary', () => {
  it('requires authentication on both registered endpoints', async () => {
    const router = new Router()
    registerResourceRoutes(router, { runtimeToken: 'private', insecure: false } as ServerRuntime)
    for (const path of ['/v1/memory/relations', '/v1/memory/relations/analyze']) {
      const route = router.match('POST', path)!
      expect((await route.handler(new Request('http://kun.local' + path, { method: 'POST' }), { params: {} })).status).toBe(401)
    }
  })

  it('only accepts listing or review, never caller-invented proposals or privileges', async () => {
    const relations = vi.fn(async () => ({ relations: [] }))
    const runtime = { memoryStore: { relations } as unknown as MemoryStore } as ServerRuntime
    for (const value of [
      { action: 'propose', proposals: [], access: {} },
      { action: 'list', memoryId: 'mem_a', access: { agent: { manage: true } } },
      { action: 'list', memoryId: 'mem_a', access: {}, limit: 201 },
      { action: 'list', memoryId: 'mem_a', access: {}, before: { id: '../secret', createdAt: 'yesterday' } },
      { action: 'list', memoryId: '../secret', access: {} }
    ]) expect((await memoryRelations(runtime, request(value), false)).status).toBe(400)
    expect(relations).not.toHaveBeenCalled()
    const value = { action: 'list', memoryId: 'mem_a', access: { workspace: '/workspace' }, limit: 20,
      status: 'accepted', before: { createdAt: '2026-10-21T00:00:00Z', id: 'relation_' + 'a'.repeat(64) } }
    expect((await memoryRelations(runtime, request(value), false)).status).toBe(200)
    expect(relations).toHaveBeenCalledWith(value, expect.any(AbortSignal))
  })

  it('requires explicit revision and a configured model before analysis', async () => {
    const runtime = { memoryStore: { relations: vi.fn() } as unknown as MemoryStore } as ServerRuntime
    expect((await memoryRelations(runtime, request({ memoryId: 'mem_a', access: {} }), true)).status).toBe(400)
    expect((await memoryRelations(runtime, request({ memoryId: 'mem_a', expectedRevision: 1, access: {} }), true)).status).toBe(503)
  })

  it('returns conflict for stale decisions and never echoes private error payloads', async () => {
    const relations = vi.fn().mockRejectedValueOnce(new MemoryRelationConflictError())
      .mockRejectedValueOnce(new Error('password=private-content'))
    const runtime = { memoryStore: { relations } as unknown as MemoryStore } as ServerRuntime
    const value = { action: 'review', id: 'relation_' + 'a'.repeat(64), decision: 'accepted', access: {} }
    expect((await memoryRelations(runtime, request(value), false)).status).toBe(409)
    const failure = await memoryRelations(runtime, request(value), false)
    expect(failure.status).toBe(503)
    expect(failure.body).not.toContain('private-content')
  })

  it('admits only one analysis per runtime and releases the slot after completion', async () => {
    const record = MemoryRecord.parse({ id: 'mem_a', content: 'A recorded fact.', scope: 'user',
      createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z' })
    let release!: (value: MemoryRecord) => void
    const pending = new Promise<MemoryRecord>((resolve) => { release = resolve })
    const getById = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(record)
    const runtime = { memoryStore: {
      relations: vi.fn(), getById, list: vi.fn(async () => [])
    }, defaultModel: 'fixture', modelClient: {} } as unknown as ServerRuntime
    const value = { memoryId: record.id, expectedRevision: 1, access: {} }
    const first = memoryRelations(runtime, request(value), true)
    await vi.waitFor(() => expect(getById).toHaveBeenCalledOnce())
    expect((await memoryRelations(runtime, request(value), true)).status).toBe(409)
    release(record)
    expect((await first).status).toBe(200)
    expect((await memoryRelations(runtime, request(value), true)).status).toBe(200)
  })
})
