import { describe, expect, it, vi } from 'vitest'
import { MemoryForgottenError } from '../memory/memory-forgetting.js'
import { MemoryErasureIncompleteError } from '../memory/memory-erasure-error.js'
import { MemoryNotFoundError } from '../memory/memory-not-found-error.js'
import { MemoryRevisionConflictError } from '../memory/memory-revisions.js'
import { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import type { MemoryStore } from '../memory/memory-store.js'
import { dispatchRequest } from '../server/http-server.js'
import { Router } from '../server/router.js'
import { memoryHistory, memoryLifecycle } from '../server/routes/memory-lifecycle.js'
import { createMemory, deleteMemory, updateMemory } from '../server/routes/memory.js'
import { registerRoomRoutes } from '../server/routes/register-room-routes.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
import { requestManagerJson, type ServiceManagerConnection } from './manager-client.js'
import { managerMemoryErrorResponse, restoreManagerMemoryError } from './manager-memory-errors.js'
import { executeMemoryLifecycleOperation } from './memory-lifecycle-owner.js'
import { ManagerRemoteMemoryStore } from './remote-data-stores.js'
import { ServiceManagerHttpError } from './usage-errors.js'

const manager = { discovery: { baseUrl: 'http://127.0.0.1:19001', managerToken: 'synthetic-test-token' } } as ServiceManagerConnection

describe('structured Manager memory errors', () => {
  it.each([
    [new MemoryNotFoundError(), 404, 'memory_not_found'],
    [new MemoryForgottenError(), 409, 'memory_forgotten'],
    [new MemoryErasureIncompleteError(), 503, 'memory_erasure_incomplete'],
    [new MemoryRevisionConflictError('requested revision is outside the retained history'), 409, 'memory_revision_conflict']
  ] as const)('round-trips %s through the real client with its status and typed code', async (error, status, code) => {
    const response = managerMemoryErrorResponse(error)!
    expect(response.status).toBe(status)
    expect(JSON.parse(response.body)).toEqual({ code, message: error.message })
    const fetch = vi.fn(async () => new Response(response.body, { status: response.status, headers: response.headers }))
    const result = await requestManagerJson(manager, '/v1/data/memory/update', { method: 'POST', fetch }).catch((error: unknown) => error)
    expect(result).toBeInstanceOf(error.constructor)
    expect(result).toMatchObject({ message: error.message })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    [500, { code: 'internal_error', message: 'memory not found; memory changed' }],
    [500, { code: 'memory_not_found', message: 'memory not found' }],
    [404, { code: 'memory_revision_conflict', message: 'memory changed' }],
    [409, { code: 'future_error', message: 'memory changed' }],
    [500, { code: 'memory_erasure_incomplete', message: 'incomplete' }],
    [409, { code: 'memory_forgotten' }]
  ])('preserves an unrecognized or inconsistent HTTP %s response', async (status, body) => {
    const fetch = vi.fn(async () => Response.json(body, { status }))
    await expect(requestManagerJson(manager, '/v1/data/memory/update', { method: 'POST', fetch }))
      .rejects.toBeInstanceOf(ServiceManagerHttpError)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not classify plain errors by message or hide unknown route failures', async () => {
    const failure = new Error('memory not found; memory changed; unrelated storage failure')
    expect(managerMemoryErrorResponse(failure)).toBeUndefined()
    expect(restoreManagerMemoryError(failure)).toBeUndefined()
    const reject = async () => { throw failure }
    const store = { create: reject, update: reject, history: reject, lifecycle: reject } as unknown as MemoryStore
    const request = (body?: unknown) => new Request('http://localhost/v1/memory/mem_test?expected_revision=1', {
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
    })
    await expect(createMemory(store, request({ content: 'Synthetic fact' }))).rejects.toBe(failure)
    await expect(updateMemory(store, 'mem_test', request({ content: 'Synthetic edit', expectedRevision: 1 }))).rejects.toBe(failure)
    await expect(deleteMemory(store, 'mem_test', request())).rejects.toBe(failure)
    await expect(memoryHistory(store, 'mem_test', request())).rejects.toBe(failure)
    await expect(memoryLifecycle(store, 'mem_test', request({ action: 'forget', expectedRevision: 1 }))).rejects.toBe(failure)
  })

  it('keeps incomplete ordinary erasure retryable through the existing owner result envelope', async () => {
    const request = { action: 'erase', expectedRevision: 1, confirmation: { memoryId: 'mem_test', irreversible: true } }
    const store = { lifecycle: async () => { throw new MemoryErasureIncompleteError() } } as unknown as MemoryStore
    const result = await executeMemoryLifecycleOperation(store, 'lifecycle', { id: 'mem_test', request })
    expect(result).toMatchObject({ ok: false, incomplete: true })
    const remote = new ManagerRemoteMemoryStore(manager, MemoryCapabilityConfig.parse({ enabled: true }))
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ result })))
    try {
      const response = await memoryLifecycle(remote, 'mem_test', new Request('http://localhost/v1/memory/mem_test/lifecycle', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request)
      }))
      expect(response.status).toBe(503)
    } finally { vi.unstubAllGlobals() }
  })

  it('returns retryable 503 for an incomplete Agent erase instead of success or generic 500', async () => {
    const router = new Router()
    registerRoomRoutes(router, { runtimeToken: 'synthetic-runtime-token', insecure: false,
      rooms: { deps: {}, service: { setDirectModelResolver: vi.fn(), setMemberAvatarValidator: vi.fn(), setContentReferenceValidator: vi.fn() },
        exclusive: (operation: () => Promise<unknown>) => operation(),
        agentMemory: { edit: async () => { throw new MemoryErasureIncompleteError() } } }
    } as unknown as ServerRuntime)
    const response = await dispatchRequest(router, new Request('http://localhost/v1/agents/agent_test/memories/mem_test', {
      method: 'PATCH', headers: { authorization: 'Bearer synthetic-runtime-token', 'content-type': 'application/json' }, body: '{}'
    }))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'capability_unavailable', message: expect.stringContaining('incomplete') })
  })
})
