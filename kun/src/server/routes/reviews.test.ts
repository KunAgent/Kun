import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Router } from '../router.js'
import type { JsonResponse } from '../response.js'
import type { ServerRuntime } from './server-runtime.js'
import type { TaskWorkspaceRecord } from '../../contracts/task-workspace.js'
import { FileReviewStore } from '../../ade/review-store.js'
import { registerReviewRoutes } from './register-review-routes.js'

const NOW = '2026-09-01T12:00:00.000Z'
const WS = 'tws_routes0001'
const dirs: string[] = []
let seq = 0

const nextId = (prefix: 'rvc' | 'rvq'): string =>
  `${prefix}_${(++seq).toString(36)}aaaaaaa`.slice(0, 40)

const commentBody = {
  path: 'src/a.ts',
  side: 'new',
  line: 3,
  anchor: { lineText: 'const x = 1', before: [], after: [] },
  body: 'rename this'
}

const workspaceRecord = (state: TaskWorkspaceRecord['state']): TaskWorkspaceRecord => ({
  workspaceId: WS,
  ownerThreadId: 't1',
  isolation: 'worktree',
  sourceRoot: '/src',
  path: '/ws',
  startFrom: { kind: 'current-head' },
  state,
  setup: { status: 'skipped' },
  changedFiles: [],
  createdAt: NOW,
  updatedAt: NOW
})

async function harness(options?: {
  guiDispatch?: (workerId: string, input: unknown) => Promise<unknown>
  guiCreateWorker?: (ws: TaskWorkspaceRecord, input: unknown, signal: AbortSignal) => Promise<unknown>
  workspaceState?: TaskWorkspaceRecord['state']
}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-reviews-route-'))
  dirs.push(dataDir)
  const reviews = new FileReviewStore(dataDir, () => NOW, nextId)
  const dispatched: Array<{ workerId: string; input: unknown }> = []
  const manager = {
    teamControls: {
      guiDispatch: async (workerId: string, input: unknown) => {
        dispatched.push({ workerId, input })
        return options?.guiDispatch
          ? options.guiDispatch(workerId, input)
          : { ok: true, dispatchId: 'dsp_1', userReport: 'queued' }
      }
    },
    guiCreateWorker: async (ws: TaskWorkspaceRecord, input: unknown, signal: AbortSignal) =>
      options?.guiCreateWorker
        ? options.guiCreateWorker(ws, input, signal)
        : { ok: true, workerId: 'w_new', dispatchId: 'dsp_2', userReport: 'created' }
  }
  const taskWorkspaces = {
    get: (id: string) =>
      id === WS ? workspaceRecord(options?.workspaceState ?? 'ready') : undefined
  }
  const router = new Router()
  registerReviewRoutes(router, {
    runtimeToken: 'test-token',
    insecure: false,
    nowIso: () => NOW,
    ade: { stores: { reviews }, manager },
    taskWorkspaces
  } as unknown as ServerRuntime)
  const request = async (method: string, path: string, body?: unknown, authorized = true) => {
    const route = router.match(method, new URL(path, 'http://local.test').pathname)
    expect(route, `${method} ${path} should route`).toBeTruthy()
    return route!.handler(
      new Request(`http://local.test${path}`, {
        method,
        headers: {
          ...(authorized ? { authorization: 'Bearer test-token' } : {}),
          'content-type': 'application/json'
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
      }),
      { params: route!.params }
    ) as Promise<JsonResponse>
  }
  return { reviews, request, dispatched }
}

const json = (res: JsonResponse): Record<string, unknown> =>
  JSON.parse(res.body) as Record<string, unknown>

afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true })
})

describe('review routes', () => {
  it('creates, lists, and patches comments', async () => {
    const { request } = await harness()
    const created = await json(await request('POST', `/v1/reviews/${WS}/comments`, commentBody))
    expect((created.comment as { commentId: string }).commentId).toMatch(/^rvc_/)

    const listed = await json(await request('GET', `/v1/reviews/${WS}/comments`))
    expect(listed.comments).toHaveLength(1)

    const commentId = (created.comment as { commentId: string }).commentId
    const patched = await json(await request(
      'PATCH', `/v1/reviews/${WS}/comments/${commentId}`, { state: 'resolved' }
    ))
    expect((patched.comment as { state: string }).state).toBe('resolved')
  })

  it('rejects invalid bodies and unknown comment ids', async () => {
    const { request } = await harness()
    const bad = await request('POST', `/v1/reviews/${WS}/comments`, { path: 'x' })
    expect(bad.status).toBe(400)
    const missing = await request('PATCH', `/v1/reviews/${WS}/comments/rvc_missing01`, { body: 'x' })
    expect(missing.status).toBe(404)
    const unauth = await request('GET', `/v1/reviews/${WS}/comments`, undefined, false)
    expect(unauth.status).toBe(401)
  })

  it('sends to a worker via guiDispatch and marks comments sent', async () => {
    const { request, reviews, dispatched } = await harness()
    const created = await json(await request('POST', `/v1/reviews/${WS}/comments`, commentBody))
    const commentId = (created.comment as { commentId: string }).commentId
    const res = await request('POST', `/v1/reviews/${WS}/send`, {
      commentIds: [commentId],
      target: { kind: 'worker', workerId: 'w7' },
      note: 'please fix'
    })
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.dispatchId).toBe('dsp_1')
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].workerId).toBe('w7')
    expect((dispatched[0].input as { task: string }).task).toContain('<kun_review_request round="1"')
    expect((dispatched[0].input as { task: string }).task).toContain('please fix')
    const sent = (await reviews.list(WS)).comments[0]
    expect(sent.state).toBe('sent')
    expect(sent.sentInRequestId).toMatch(/^rvq_/)
  })

  it('sends to the manager as composerContext without dispatching', async () => {
    const { request, dispatched } = await harness()
    const created = await json(await request('POST', `/v1/reviews/${WS}/comments`, commentBody))
    const commentId = (created.comment as { commentId: string }).commentId
    const body = await json(await request('POST', `/v1/reviews/${WS}/send`, {
      commentIds: [commentId],
      target: { kind: 'manager' }
    }))
    expect(body.dispatchId).toBeUndefined()
    const ctx = body.composerContext as { kind: string; body: string }
    expect(ctx.kind).toBe('review_request')
    expect(ctx.body).toContain('<kun_review_request round="1"')
    expect(dispatched).toHaveLength(0)
  })

  it('creates a new worker reusing the same task workspace', async () => {
    let createdWith: unknown
    const { request } = await harness({
      guiCreateWorker: async (ws, input) => {
        createdWith = { ws: ws.workspaceId, input }
        return { ok: true, workerId: 'w_reviewer', dispatchId: 'dsp_9', userReport: 'created' }
      }
    })
    const created = await json(await request('POST', `/v1/reviews/${WS}/comments`, commentBody))
    const commentId = (created.comment as { commentId: string }).commentId
    const body = await json(await request('POST', `/v1/reviews/${WS}/send`, {
      commentIds: [commentId],
      target: { kind: 'new-worker', harnessId: 'claude-code' }
    }))
    expect(body.workerId).toBe('w_reviewer')
    const seen = createdWith as { ws: string; input: { harnessId: string; task: string } }
    expect(seen.ws).toBe(WS)
    expect(seen.input.harnessId).toBe('claude-code')
    expect(seen.input.task).toContain('<kun_review_request')
  })

  it('rejects a send when the workspace is not reusable', async () => {
    const { request } = await harness({ workspaceState: 'removed' })
    const created = await json(await request('POST', `/v1/reviews/${WS}/comments`, commentBody))
    const commentId = (created.comment as { commentId: string }).commentId
    const res = await request('POST', `/v1/reviews/${WS}/send`, {
      commentIds: [commentId],
      target: { kind: 'new-worker' }
    })
    expect(res.status).toBe(404)
  })

  it('rejects sends for resolved-only or unknown comment sets', async () => {
    const { request } = await harness()
    const created = await json(await request('POST', `/v1/reviews/${WS}/comments`, commentBody))
    const commentId = (created.comment as { commentId: string }).commentId
    await request('PATCH', `/v1/reviews/${WS}/comments/${commentId}`, { state: 'resolved' })
    const resolvedOnly = await request('POST', `/v1/reviews/${WS}/send`, {
      commentIds: [commentId],
      target: { kind: 'manager' }
    })
    expect(resolvedOnly.status).toBe(409)
    const unknown = await request('POST', `/v1/reviews/${WS}/send`, {
      commentIds: ['rvc_zzzzzzzz'],
      target: { kind: 'manager' }
    })
    expect(unknown.status).toBe(400)
  })

  it('propagates dispatch refusal from the manager', async () => {
    const { request } = await harness({
      guiDispatch: async () => ({ ok: false, userReport: 'worker under user control' })
    })
    const created = await json(await request('POST', `/v1/reviews/${WS}/comments`, commentBody))
    const commentId = (created.comment as { commentId: string }).commentId
    const res = await request('POST', `/v1/reviews/${WS}/send`, {
      commentIds: [commentId],
      target: { kind: 'worker', workerId: 'w7' }
    })
    expect(res.status).toBe(409)
    expect((await json(res)).message).toBe('worker under user control')
  })
})
