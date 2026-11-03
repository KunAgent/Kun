import { describe, expect, it, vi } from 'vitest'
import { MemoryRecord } from '../../contracts/memory.js'
import { emptyMemoryRelationContext } from '../../contracts/memory-working-context.js'
import { MemoryWorkingContextPreview } from '../../contracts/memory-working-context-preview.js'
import { Router } from '../router.js'
import { registerResourceRoutes } from './register-resource-routes.js'
import { previewMemoryWorkingContext } from './memory-working-context.js'
import type { ServerRuntime } from './server-runtime.js'

const request = (input: unknown) => new Request('http://kun.local/v1/memory/context/preview', {
  method: 'POST', body: JSON.stringify(input)
})
const input = { query: 'database', workspace: '/synthetic-context' }
const record = MemoryRecord.parse({ id: 'mem_a', content: 'Database version 17.', scope: 'user',
  createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z' })

describe('read-only context preview boundary', () => {
  it('requires authentication and disallows caller-provided selections and authority', async () => {
    const router = new Router()
    registerResourceRoutes(router, { runtimeToken: 'private', insecure: false } as ServerRuntime)
    const route = router.match('POST', '/v1/memory/context/preview')!
    expect((await route.handler(request(input), { params: {} })).status).toBe(401)
    const retrieve = vi.fn()
    const runtime = { memoryStore: { retrieve } } as unknown as ServerRuntime
    for (const body of [{ ...input, selected: [record] }, { ...input, authority: 'directive' },
      { ...input, query: '' }, { ...input, workspace: '' }]) {
      expect((await previewMemoryWorkingContext(runtime, request(body))).status).toBe(400)
    }
    expect(retrieve).not.toHaveBeenCalled()
  })

  it('selects through the normal reference pipeline without recording use or feedback', async () => {
    const memoryStore = { retrieve: vi.fn(async () => [record]), setLastInjected: vi.fn(),
      listDirectives: vi.fn(), relationContext: vi.fn(async () => emptyMemoryRelationContext('ready')) }
    const recordRetrieved = vi.fn()
    const runtime = { memoryStore, memoryFeedback: { recordRetrieved } } as unknown as ServerRuntime
    const response = await previewMemoryWorkingContext(runtime, request(input))
    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    const result = MemoryWorkingContextPreview.parse(JSON.parse(response.body))
    expect(result.memories).toEqual([record])
    expect(memoryStore.retrieve).toHaveBeenCalledWith(expect.objectContaining({ ...input, purpose: 'preview' }))
    expect(memoryStore.setLastInjected).not.toHaveBeenCalled()
    expect(memoryStore.listDirectives).not.toHaveBeenCalled()
    expect(recordRetrieved).not.toHaveBeenCalled()
  })

  it('redacts retrieval failures and falls back if only annotation projection fails', async () => {
    const retrieve = vi.fn().mockRejectedValueOnce(new Error('private-local-path'))
      .mockResolvedValue([record])
    const runtime = { memoryStore: { retrieve, setLastInjected: vi.fn(),
      relationContext: vi.fn().mockRejectedValue(new Error('secret-token')) } } as unknown as ServerRuntime
    const failed = await previewMemoryWorkingContext(runtime, request(input))
    expect(failed.status).toBe(503)
    expect(failed.body).not.toContain('private-local-path')
    const fallback = await previewMemoryWorkingContext(runtime, request(input))
    expect(fallback.status).toBe(200)
    expect(JSON.parse(fallback.body).relations.state).toBe('unavailable')
    expect(fallback.body).not.toContain('secret-token')
  })
})
