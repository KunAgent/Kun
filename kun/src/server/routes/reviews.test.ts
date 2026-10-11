import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Router } from '../router.js'
import type { JsonResponse } from '../response.js'
import type { ServerRuntime } from './server-runtime.js'
import type { TaskWorkspaceRecord } from '../../contracts/task-workspace.js'
import { FileReviewStore } from '../../ade/review-store.js'
import { adeReviewFile } from '../../ade/ade-paths.js'
import { InMemoryArtifactStore } from '../../artifacts/artifact-store.js'
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
  nowIso?: () => string
}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-reviews-route-'))
  dirs.push(dataDir)
  const artifacts = new InMemoryArtifactStore()
  const reviews = new FileReviewStore(dataDir, options?.nowIso ?? (() => NOW), nextId, undefined, artifacts)
  const dispatched: Array<{ workerId: string; input: unknown }> = []
  const manager = {
    newWorkRefusal: async () => null,
    teamControls: {
      workerById: async () => ({ team: { managerThreadId: 't1' } }),
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
    nowIso: options?.nowIso ?? (() => NOW),
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
  return { reviews, request, dispatched, artifacts }
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

  it('returns the durable receipt for the same client request without dispatching twice', async () => {
    const { request, dispatched } = await harness()
    const created = json(await request('POST', `/v1/reviews/${WS}/comments`, commentBody))
    const commentId = (created.comment as { commentId: string }).commentId
    const payload = {
      commentIds: [commentId], target: { kind: 'worker', workerId: 'w7' },
      clientRequestId: 'review-send-1'
    }
    const first = json(await request('POST', `/v1/reviews/${WS}/send`, payload))
    const second = json(await request('POST', `/v1/reviews/${WS}/send`, payload))
    expect(second.request).toEqual(first.request)
    expect(second.dispatchId).toBe('dsp_1')
    expect(dispatched).toHaveLength(1)
    const conflict = await request('POST', `/v1/reviews/${WS}/send`, {
      ...payload, note: 'different'
    })
    expect(conflict.status).toBe(409)
    expect(json(conflict)).toMatchObject({ details: { reason: 'idempotency_conflict' } })
  })

  it('keeps an in-flight reservation across retries and never starts a second dispatch', async () => {
    let release: ((value: unknown) => void) | undefined
    const gate = new Promise((resolve) => { release = resolve })
    const guiDispatch = vi.fn(async () => gate)
    const { request, reviews } = await harness({
      guiDispatch, nowIso: () => new Date().toISOString()
    })
    const created = json(await request('POST', `/v1/reviews/${WS}/comments`, commentBody))
    const commentId = (created.comment as { commentId: string }).commentId
    const payload = {
      commentIds: [commentId], target: { kind: 'worker', workerId: 'w7' },
      clientRequestId: 'review-send-inflight'
    }
    const first = request('POST', `/v1/reviews/${WS}/send`, payload)
    await vi.waitFor(() => expect(guiDispatch).toHaveBeenCalledTimes(1))
    const retry = await request('POST', `/v1/reviews/${WS}/send`, payload)
    expect(retry.status).toBe(409)
    expect(json(retry)).toMatchObject({ details: { reason: 'send_reserved' } })
    expect((await reviews.list(WS)).reservations).toHaveLength(1)
    release?.({ ok: true, dispatchId: 'dsp_once', userReport: 'queued' })
    expect((await first).status).toBe(200)
    expect(guiDispatch).toHaveBeenCalledTimes(1)
    expect((await reviews.list(WS)).reservations).toHaveLength(0)
  })

  it('preserves an uncertain reservation after a dispatch transport failure', async () => {
    const guiDispatch = vi.fn(async () => { throw new Error('transport lost') })
    const { request, reviews } = await harness({ guiDispatch })
    const created = json(await request('POST', `/v1/reviews/${WS}/comments`, commentBody))
    const commentId = (created.comment as { commentId: string }).commentId
    const payload = {
      commentIds: [commentId], target: { kind: 'worker', workerId: 'w7' },
      clientRequestId: 'review-send-uncertain'
    }
    const first = await request('POST', `/v1/reviews/${WS}/send`, payload)
    expect(first.status).toBe(409)
    expect(json(first)).toMatchObject({ details: { reason: 'send_uncertain' } })
    const retry = await request('POST', `/v1/reviews/${WS}/send`, payload)
    expect(retry.status).toBe(409)
    expect(json(retry)).toMatchObject({ details: { reason: 'send_uncertain' } })
    expect(guiDispatch).toHaveBeenCalledTimes(1)
    expect((await reviews.list(WS)).reservations).toHaveLength(1)
  })

  it('rejects a stale expected revision before reserving or dispatching', async () => {
    const { request, dispatched, reviews } = await harness()
    const created = json(await request('POST', `/v1/reviews/${WS}/comments`, commentBody))
    const commentId = (created.comment as { commentId: string }).commentId
    const stale = await request('POST', `/v1/reviews/${WS}/send`, {
      commentIds: [commentId], target: { kind: 'worker', workerId: 'w7' },
      clientRequestId: 'review-stale',
      expectedRevision: {
        version: 1, target: { kind: 'task-workspace', workspaceId: WS },
        completeness: 'complete', contentHash: 'a'.repeat(64),
        fileCount: 0, capturedAt: NOW
      }
    })
    expect(stale.status).toBe(409)
    expect(json(stale)).toMatchObject({ details: { reason: 'revision_stale' } })
    expect(dispatched).toHaveLength(0)
    expect((await reviews.list(WS)).reservations).toHaveLength(0)
  })

  it('does not dispatch or overwrite a corrupt existing review file', async () => {
    const { request, dispatched } = await harness()
    const path = adeReviewFile(dirs.at(-1)!, WS)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, '{invalid-json')
    const response = await request('POST', `/v1/reviews/${WS}/send`, {
      commentIds: [], target: { kind: 'worker', workerId: 'w7' }, note: 'fix'
    })
    expect(response.status).toBe(503)
    expect(json(response).code).toBe('review_store_unavailable')
    expect(dispatched).toHaveLength(0)
    expect(await readFile(path, 'utf8')).toBe('{invalid-json')
  })

  it('does not dispatch after an existing review file read failure', async () => {
    const { request, dispatched } = await harness()
    const path = adeReviewFile(dirs.at(-1)!, WS)
    await mkdir(path, { recursive: true })
    const response = await request('POST', `/v1/reviews/${WS}/send`, {
      commentIds: [], target: { kind: 'worker', workerId: 'w7' }, note: 'fix'
    })
    expect(response.status).toBe(503)
    expect(dispatched).toHaveLength(0)
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
    expect(body.request).toMatchObject({ workspaceId: WS })
    expect(body.request).not.toHaveProperty('requestText')
    expect(ctx).toMatchObject({ workspaceId: WS })
    const listed = json(await request('GET', `/v1/reviews/${WS}/comments`))
    expect((listed.requests as unknown[])[0]).not.toHaveProperty('requestText')
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

  it('accepts note-only sends for CI failure feedback', async () => {
    const { request, reviews, dispatched } = await harness()
    const res = await request('POST', `/v1/reviews/${WS}/send`, {
      commentIds: [],
      note: 'CI check "unit" failed: https://ci/1',
      target: { kind: 'worker', workerId: 'w7' }
    })
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.dispatchId).toBe('dsp_1')
    expect(dispatched).toHaveLength(1)
    const task = (dispatched[0]!.input as { task: string }).task
    expect(task).toContain('CI check "unit" failed: https://ci/1')
    const stored = await reviews.list(WS)
    expect(stored.requests).toHaveLength(1)
    expect(stored.requests[0]).toMatchObject({
      round: 1, commentIds: [], note: 'CI check "unit" failed: https://ci/1'
    })

    const noNote = await request('POST', `/v1/reviews/${WS}/send`, {
      commentIds: [],
      target: { kind: 'manager' }
    })
    expect(noNote.status).toBe(400)
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
  it('delivers large worker batches via a complete artifact and keeps repeated lists small', async () => {
    const { request, reviews, dispatched, artifacts } = await harness()
    const comments = []
    for (let index = 0; index < 12; index += 1) {
      comments.push(await reviews.create(WS, {
        ...commentBody, side: 'new', line: index + 1, body: 'B'.repeat(3_980) + ` LAST-${index}`
      }))
    }
    const result = await request('POST', `/v1/reviews/${WS}/send`, {
      commentIds: comments.map((comment) => comment.commentId),
      target: { kind: 'worker', workerId: 'worker' }, clientRequestId: 'large-worker-batch'
    })
    expect(result.status).toBe(200)
    const receipt = json(result).request as { requestArtifactId: string }
    expect((dispatched[0].input as { task: string }).task).toContain(receipt.requestArtifactId)
    expect((dispatched[0].input as { task: string }).task.length).toBeLessThan(32_000)
    const fullText = await artifacts.get(receipt.requestArtifactId)
    expect(fullText?.length).toBeGreaterThan(32_000)
    expect(fullText).toContain('LAST-11')
    const listed = json(await request('GET', `/v1/reviews/${WS}/comments`))
    expect((listed.requests as unknown[])[0]).not.toHaveProperty('requestText')
    expect((await reviews.list(WS)).requests[0].requestText).toBe(fullText)
  })

})
