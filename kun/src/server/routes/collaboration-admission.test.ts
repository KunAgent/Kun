import { afterEach, describe, expect, it } from 'vitest'
import { Router } from '../router.js'
import type { JsonResponse } from '../response.js'
import type { ServerRuntime } from './server-runtime.js'
import { registerTeamsRoutes } from './register-teams-routes.js'
import { registerReviewRoutes } from './register-review-routes.js'
import { ManagerRuntime } from '../../ade/manager-runtime.js'
import { FileReviewStore } from '../../ade/review-store.js'
import {
  makeHarness, managerCtx, seedDispatch, seedWorker, setupAdeStores,
  teardownAdeStores, type AdeStores, NOW
} from '../../ade/manager-controls-test-support.js'
import { newManagerWorkRefusal } from '../../ade/new-work-admission.js'

const fixtures: AdeStores[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(teardownAdeStores))
})

async function harness() {
  const stores = await setupAdeStores()
  fixtures.push(stores)
  const controls = makeHarness(stores)
  let enabled = true
  const deps = { ...controls.deps, canStartNewWork: () => enabled }
  const manager = new ManagerRuntime(deps)
  const reviews = new FileReviewStore(stores.dataDir, () => NOW,
    (prefix) => `${prefix}_00000001`)
  const router = new Router()
  const runtime = {
    runtimeToken: 'token', insecure: false, nowIso: () => NOW,
    ade: { manager, stores: { ...stores, reviews } },
    taskWorkspaces: controls.taskWorkspaces
  } as unknown as ServerRuntime
  registerTeamsRoutes(router, runtime)
  registerReviewRoutes(router, runtime)
  await seedWorker(stores)
  const request = async (path: string, body?: unknown): Promise<JsonResponse> => {
    const route = router.match('POST', path)!
    return route.handler(new Request(`http://local${path}`, {
      method: 'POST', headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {})
    }), { params: route.params }) as Promise<JsonResponse>
  }
  return { stores, reviews, request, manager, controls, deps, setEnabled: (next: boolean) => { enabled = next } }
}

describe('new collaboration admission across HTTP and model operations', () => {
  it.each(['global', 'task'] as const)('blocks new work when %s collaboration closes before creating receipts or dispatches', async (scope) => {
    const h = await harness()
    if (scope === 'global') h.setEnabled(false)
    else {
      const thread = (await h.stores.threads.get('thr_mgr'))!
      await h.stores.threads.upsert({ ...thread, collaboration: { enabled: false, everEnabled: true } })
    }
    const dispatch = await h.request('/v1/teams/workers/wrk_1/dispatch', { task: 'must not run' })
    expect(dispatch.status).toBe(409)
    expect(JSON.parse(dispatch.body).message).toContain('collaboration_disabled')
    for (const target of [{ kind: 'worker', workerId: 'wrk_1' }, { kind: 'new-worker' }]) {
      const sent = await h.request('/v1/reviews/tws_1/send', {
        commentIds: [], note: 'fix CI', target, clientRequestId: `closed-${target.kind}`
      })
      expect(sent.status).toBe(409)
      expect(JSON.parse(sent.body).details.reason).toBe('collaboration_disabled')
    }
    expect(await h.manager.controls.workerSend(managerCtx(), { workerId: 'wrk_1', task: 'no' }))
      .toMatchObject({ ok: false, refusal: 'collaboration_disabled' })
    expect(await h.manager.createWorker(managerCtx(), { label: 'new', task: 'no' }, { workspace: '/repo' } as never))
      .toMatchObject({ ok: false, refusal: 'collaboration_disabled' })
    expect(await h.manager.reviews.request(managerCtx(), { workerId: 'wrk_1' }, { workspace: '/repo' } as never))
      .toMatchObject({ ok: false, refusal: 'admission' })
    expect((await h.reviews.list('tws_1')).reservations).toHaveLength(0)
    expect((await h.reviews.list('tws_1')).requests).toHaveLength(0)
    expect(await h.stores.dispatches.list('thr_mgr')).toHaveLength(0)
    expect((await h.stores.teams.get('thr_mgr'))?.workers).toHaveLength(1)
    expect(h.controls.delegation.runChild).not.toHaveBeenCalled()
  })

  it('keeps controls and manager review preparation available after the global switch closes', async () => {
    const h = await harness()
    h.setEnabled(false)
    await seedDispatch(h.stores, { dispatchId: 'dsp_done', state: 'completed', outcome: 'completed' })
    await h.stores.questions.create('thr_mgr', {
      questionId: 'q_1', workerId: 'wrk_1', dispatchId: 'dsp_done',
      question: 'Proceed?', state: 'open', deadline: NOW, createdAt: NOW, updatedAt: NOW
    })
    expect((await h.request('/v1/teams/workers/wrk_1/stop')).status).toBe(200)
    expect((await h.request('/v1/teams/workers/wrk_1/take-over')).status).toBe(200)
    expect((await h.stores.threads.get('wrk_1'))?.executionUnit?.control).toBe('user')
    expect((await h.request('/v1/teams/questions/q_1/answer', { answer: 'yes' })).status).toBe(200)
    expect((await h.request('/v1/teams/dispatches/dsp_done/verdict', { status: 'needs_changes', notes: 'fix tests' })).status).toBe(200)
    const managerReview = await h.request('/v1/reviews/tws_1/send', {
      target: { kind: 'manager' }, commentIds: [], note: 'Please inspect the existing diff'
    })
    expect(managerReview.status).toBe(200)
    expect(h.controls.delegation.runChild).not.toHaveBeenCalled()
  })

  it('does not treat prior collaboration, a worker role, or a native provider as an active grant', async () => {
    const h = await harness()
    const manager = (await h.stores.threads.get('thr_mgr'))!
    await h.stores.threads.upsert({ ...manager, workspaceMode: 'code', collaboration: { enabled: false, everEnabled: true } })
    expect(await newManagerWorkRefusal(h.deps, 'thr_mgr')).toMatchObject({ refusal: 'collaboration_disabled' })
    expect(await newManagerWorkRefusal(h.deps, 'wrk_1')).toMatchObject({ refusal: 'collaboration_disabled' })
    await h.stores.threads.upsert({ ...manager, collaboration: { enabled: true } })
    expect(await newManagerWorkRefusal({ ...h.deps,
      providerPool: async () => ({ kind: 'cursor-sdk', models: ['auto'] })
    }, 'thr_mgr')).toMatchObject({ refusal: 'collaboration_disabled' })
    expect(await newManagerWorkRefusal(h.deps, 'thr_mgr')).toBeNull()
  })
})
