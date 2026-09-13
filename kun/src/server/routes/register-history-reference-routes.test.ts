import { describe, expect, it, vi } from 'vitest'
import { Router } from '../router.js'
import type { JsonResponse } from '../response.js'
import type { ServerRuntime } from './server-runtime.js'
import { HistoryReferenceError, type HistoryReferenceService } from '../../history/history-reference-service.js'
import { registerHistoryReferenceRoutes } from './register-history-reference-routes.js'

function harness(enabled = true) {
  const history = {
    assertEnabled: vi.fn(() => {
      if (!enabled) throw new HistoryReferenceError('history_reference_disabled', 'Enable the experiment', 403)
    }),
    discover: vi.fn(async () => []),
    preview: vi.fn(async () => ({ cutoffs: [], page: { turns: [] } })),
    createBranch: vi.fn(async () => ({ thread: { id: 'new-thread', historyRefId: 'ref-1' } })),
    get: vi.fn(async () => ({ id: 'ref-1' })),
    status: vi.fn(async () => ({ status: 'available', warnings: [] })),
    page: vi.fn(async () => ({ turns: [], hasMore: false })),
    relink: vi.fn(async () => ({ id: 'ref-1' })),
    attachment: vi.fn(async () => ({ name: 'image', mimeType: 'image/png', dataBase64: 'data' }))
  }
  const router = new Router()
  registerHistoryReferenceRoutes(router, { runtimeToken: 'test-token', insecure: false,
    historyReferences: history as unknown as HistoryReferenceService } as ServerRuntime)
  const request = async (method: string, path: string, body?: unknown, authorized = true) => {
    const route = router.match(method, new URL(path, 'http://local.test').pathname)!
    return route.handler(new Request(`http://local.test${path}`, { method,
      headers: { ...(authorized ? { authorization: 'Bearer test-token' } : {}), 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}) }), { params: route.params }) as Promise<JsonResponse>
  }
  return { history, request }
}

describe('history reference routes', () => {
  it('requires authorization and rejects disabled source operations before any scan', async () => {
    const { history, request } = harness(false)
    expect((await request('GET', '/v1/history-sources/codex/sessions', undefined, false)).status).toBe(401)
    const disabled = await request('GET', '/v1/history-sources/codex/sessions')
    expect(disabled.status).toBe(403)
    expect(JSON.parse(disabled.body)).toMatchObject({ code: 'history_reference_disabled' })
    expect(history.discover).not.toHaveBeenCalled()
    expect((await request('POST', '/v1/threads/reference-branches', {
      path: '/codex/rollout.jsonl', idempotencyKey: 'attempt'
    })).status).toBe(403)
    expect(history.createBranch).not.toHaveBeenCalled()
  })

  it('validates the source and creation inputs without accepting Codex policies or instructions', async () => {
    const { history, request } = harness()
    expect((await request('POST', '/v1/threads/reference-branches', {
      path: '/codex/rollout.jsonl', referenceId: 'ref-1', idempotencyKey: 'attempt'
    })).status).toBe(400)
    expect((await request('POST', '/v1/threads/reference-branches', {
      path: '/codex/rollout.jsonl', idempotencyKey: 'attempt', approvalPolicy: 'never'
    })).status).toBe(400)
    expect((await request('POST', '/v1/threads/reference-branches', {
      path: '/codex/rollout.jsonl', idempotencyKey: 'attempt'
    })).status).toBe(200)
    expect(history.createBranch).toHaveBeenCalledTimes(1)
  })

  it('reads only indexed source attachments and validates attachment indexes', async () => {
    const { history, request } = harness()
    expect((await request('GET', '/v1/history-sources/ref-1/attachments/item-1/0')).status).toBe(200)
    expect(history.attachment).toHaveBeenCalledWith('ref-1', 'item-1', 0)
    expect((await request('GET', '/v1/history-sources/ref-1/attachments/item-1/100')).status).toBe(400)
  })

  it('validates exact-record pagination and never accepts arbitrary paths', async () => {
    const { history, request } = harness()
    expect((await request('GET', '/v1/history-sources/ref-1/timeline?turnId=turn-1&itemId=item-1&contentOffset=16384')).status).toBe(200)
    expect(history.page).toHaveBeenCalledWith('ref-1', {
      threadId: 'source:ref-1', turnId: 'turn-1', itemId: 'item-1', contentOffset: 16384
    })
    for (const query of ['contentOffset=0', 'itemId=x&contentOffset=-1', 'itemId=x&contentOffset=1.5',
      'itemId=x&contentOffset=NaN', 'itemId=x&contentOffset=999999999', 'itemId=x&path=%2Fprivate.jsonl']) {
      expect((await request('GET', `/v1/history-sources/ref-1/timeline?${query}`)).status).toBe(400)
    }
    expect(history.page).toHaveBeenCalledTimes(1)
  })

  it('parses filtering and returns paged read-only source projections', async () => {
    const { history, request } = harness()
    expect((await request('GET', '/v1/history-sources/codex/sessions?cwd=%2Fproject&includeArchived=true&limit=20')).status).toBe(200)
    expect(history.discover).toHaveBeenCalledWith({ cwd: '/project', includeArchived: true, limit: 20 })
    expect((await request('GET', '/v1/history-sources/ref-1/timeline?limit=10&cursor=opaque')).status).toBe(200)
    expect(history.page).toHaveBeenCalledWith('ref-1', { threadId: 'source:ref-1', limit: 10, cursor: 'opaque' })
  })
})
