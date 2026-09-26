import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Router } from '../router.js'
import type { JsonResponse } from '../response.js'
import type { ServerRuntime } from './server-runtime.js'
import type { WorkerNotice } from '../../contracts/ade.js'
import { FileWorkerNoticeStore } from '../../ade/worker-notice-store.js'
import { registerTeamsRoutes } from './register-teams-routes.js'

const NOW = '2026-09-26T00:00:00.000Z'
const MANAGER = 'thr_mgr'
const tempDirs: string[] = []

afterEach(async () => {
  while (tempDirs.length) await rm(tempDirs.pop()!, { recursive: true, force: true })
})

function notice(id: string): WorkerNotice {
  return {
    noticeId: id,
    teamId: MANAGER,
    workerId: 'wrk_1',
    kind: 'dispatch_completed',
    title: `dispatch ${id}`,
    createdAt: NOW,
    attempts: 0
  }
}

async function harness(options: { withCoordinator?: boolean; manager?: unknown } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-teams-routes-'))
  tempDirs.push(dataDir)
  const notices = new FileWorkerNoticeStore(dataDir, () => NOW)
  const holdNotices = vi.fn((threadId: string, holdMs: number) => ({
    heldUntil: new Date(Date.parse(NOW) + holdMs).toISOString()
  }))
  const router = new Router()
  registerTeamsRoutes(router, {
    runtimeToken: 'test-token',
    insecure: false,
    ade: {
      stores: { notices },
      ...(options.withCoordinator === false
        ? {}
        : { noticeCoordinator: { holdNotices } }),
      ...(options.manager ? { manager: options.manager } : {})
    }
  } as unknown as ServerRuntime)
  const request = async (method: string, path: string, body?: unknown, authorized = true) => {
    const route = router.match(method, new URL(path, 'http://local.test').pathname)!
    expect(route, `${method} ${path} should route`).toBeTruthy()
    return route.handler(
      new Request(`http://local.test${path}`, {
        method,
        headers: {
          ...(authorized ? { authorization: 'Bearer test-token' } : {}),
          'content-type': 'application/json'
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
      }),
      { params: route.params }
    ) as Promise<JsonResponse>
  }
  return { notices, holdNotices, request }
}

describe('teams routes', () => {
  it('applies a notice hold and echoes the clamped window', async () => {
    const { holdNotices, request } = await harness()
    const res = await request('POST', `/v1/teams/${MANAGER}/notice-hold`, { holdMs: 45_000 })
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.holdMs).toBe(45_000)
    expect(typeof body.heldUntil).toBe('string')
    expect(holdNotices).toHaveBeenCalledWith(MANAGER, 45_000)
  })

  it('rejects invalid holdMs values', async () => {
    const { holdNotices, request } = await harness()
    for (const holdMs of [0, 60_001, 1.5, 'x', undefined]) {
      const res = await request('POST', `/v1/teams/${MANAGER}/notice-hold`, { holdMs })
      expect(res.status, `holdMs=${String(holdMs)}`).toBe(400)
    }
    expect(holdNotices).not.toHaveBeenCalled()
  })

  it('requires authorization and reports ade unavailability', async () => {
    const { request } = await harness()
    expect(
      (await request('POST', `/v1/teams/${MANAGER}/notice-hold`, { holdMs: 1_000 }, false)).status
    ).toBe(401)
    expect((await request('GET', `/v1/teams/${MANAGER}/pending-notices`, undefined, false)).status).toBe(401)
    const missing = await harness({ withCoordinator: false })
    expect(
      (await missing.request('POST', `/v1/teams/${MANAGER}/notice-hold`, { holdMs: 1_000 })).status
    ).toBe(503)
  })

  it('serves pending notices with the rendered kun_worker_updates text', async () => {
    const { notices, request } = await harness()
    await notices.enqueue(notice('ntc_1'))
    await notices.enqueue(notice('ntc_2'))
    const res = await request('GET', `/v1/teams/${MANAGER}/pending-notices`)
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.notices.map((entry: WorkerNotice) => entry.noticeId)).toEqual(['ntc_1', 'ntc_2'])
    expect(body.text).toContain('<kun_worker_updates>')
    expect(body.displayText).toBe('2 worker updates')
  })

  it('renders zh text when the language query asks for it', async () => {
    const { notices, request } = await harness()
    await notices.enqueue(notice('ntc_1'))
    const res = await request('GET', `/v1/teams/${MANAGER}/pending-notices?language=zh-CN`)
    const body = JSON.parse(res.body)
    expect(body.text).toContain('- [完成]')
    expect(body.displayText).toBe('1 个 worker 有更新')
  })

  it('returns an empty list without text when nothing is pending', async () => {
    const { notices, request } = await harness()
    await notices.enqueue(notice('ntc_1'))
    await notices.ack(MANAGER, ['ntc_1'])
    const res = await request('GET', `/v1/teams/${MANAGER}/pending-notices`)
    const body = JSON.parse(res.body)
    expect(body.notices).toEqual([])
    expect(body.text).toBeUndefined()
  })

  it('records a user verdict and maps refusals (10 §4.3)', async () => {
    const setVerdict = vi.fn(async (input: Record<string, unknown>) =>
      input.dispatchId === 'dsp_ghost'
        ? { ok: false, refusal: 'dispatch_not_found', userReport: 'not found' }
        : input.status === 'rejected'
          ? { ok: false, refusal: 'user_verdict_locked', userReport: 'locked' }
          : {
              ok: true,
              dispatchId: input.dispatchId,
              verdict: { status: input.status, decidedBy: 'user', checks: [] },
              userReport: 'Verdict recorded: passed.'
            })
    const { request } = await harness({ manager: { verdicts: { setVerdict } } })

    const res = await request('POST', '/v1/teams/dispatches/dsp_1/verdict', {
      status: 'passed',
      notes: 'lgtm'
    })
    expect(res.status).toBe(200)
    expect(setVerdict).toHaveBeenCalledWith({
      dispatchId: 'dsp_1',
      status: 'passed',
      notes: 'lgtm',
      decidedBy: 'user'
    })
    const body = JSON.parse(res.body)
    expect(body.verdict).toMatchObject({ status: 'passed', decidedBy: 'user' })

    expect(
      (await request('POST', '/v1/teams/dispatches/dsp_ghost/verdict', { status: 'passed' })).status
    ).toBe(404)
    expect(
      (await request('POST', '/v1/teams/dispatches/dsp_1/verdict', { status: 'rejected' })).status
    ).toBe(409)
    for (const invalid of [{}, { status: 'pending' }, { status: 'passed', extra: 1 }]) {
      expect(
        (await request('POST', '/v1/teams/dispatches/dsp_1/verdict', invalid)).status,
        JSON.stringify(invalid)
      ).toBe(400)
    }
    expect(
      (await request('POST', '/v1/teams/dispatches/dsp_1/verdict', { status: 'passed' }, false))
        .status
    ).toBe(401)
  })

  it('serves a worker record with its owning team (09 §9 banner)', async () => {
    const worker = {
      workerId: 'wrk_1',
      label: 'backend',
      control: 'manager',
      state: 'active',
      route: { harnessId: 'kun', model: 'deepseek-chat', credentialMode: 'api-key' },
      permissionMode: 'safe'
    }
    const workerById = vi.fn(async (workerId: string) =>
      workerId === 'wrk_1' ? { team: { teamId: 'team_1' }, worker } : null)
    const { request } = await harness({ manager: { teamControls: { workerById } } })
    const res = await request('GET', '/v1/teams/workers/wrk_1')
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.worker.label).toBe('backend')
    expect(body.team.teamId).toBe('team_1')
    expect((await request('GET', '/v1/teams/workers/wrk_ghost')).status).toBe(404)
    expect((await request('GET', '/v1/teams/workers/wrk_1', undefined, false)).status).toBe(401)
  })

  it('stops a worker turn and maps refusals (09 §9)', async () => {
    const stopWorker = vi.fn(async (workerId: string) =>
      workerId === 'wrk_gone'
        ? { ok: false, refusal: 'worker_not_found' }
        : workerId === 'wrk_idle'
          ? { ok: true, stopped: false }
          : { ok: true, stopped: true })
    const { request } = await harness({ manager: { teamControls: { stopWorker } } })
    const stopped = await request('POST', '/v1/teams/workers/wrk_1/stop')
    expect(stopped.status).toBe(200)
    expect(JSON.parse(stopped.body)).toMatchObject({ ok: true, stopped: true })
    expect(JSON.parse((await request('POST', '/v1/teams/workers/wrk_idle/stop')).body))
      .toMatchObject({ ok: true, stopped: false })
    expect((await request('POST', '/v1/teams/workers/wrk_gone/stop')).status).toBe(404)
    expect((await request('POST', '/v1/teams/workers/wrk_1/stop', {}, false)).status).toBe(401)
  })
})
