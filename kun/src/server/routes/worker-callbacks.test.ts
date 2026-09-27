import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Router } from '../router.js'
import type { JsonResponse } from '../response.js'
import type { ServerRuntime } from './server-runtime.js'
import type { ThreadRecord } from '../../contracts/threads.js'
import type { TurnItem } from '../../contracts/items.js'
import type { DispatchRecord } from '../../contracts/ade.js'
import { ActivityStore } from '../../services/activity-store.js'
import { TerminalAgentRegistry } from '../../services/terminal-agent-registry.js'
import { WorkerCallbackService } from '../../services/worker-callback-service.js'
import { HarnessTokenService } from '../../harness/harness-token-service.js'
import type { HarnessTokenScope } from '../../harness/harness-token-service.js'
import { FileTeamStore } from '../../ade/team-store.js'
import { FileDispatchStore } from '../../ade/dispatch-store.js'
import { FileQuestionStore } from '../../ade/question-store.js'
import { FileWorkerNoticeStore } from '../../ade/worker-notice-store.js'
import { registerWorkerCallbackRoutes } from './register-worker-callback-routes.js'

const NOW = '2026-10-01T00:00:00.000Z'
const MANAGER = 'thr_mgr'
const WORKER = 'wrk_1'
const dirs: string[] = []

afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true })
})

function workerThread(): ThreadRecord {
  return {
    id: WORKER,
    executionUnit: {
      kind: 'worker',
      teamId: MANAGER,
      managerThreadId: MANAGER,
      label: 'implementer',
      lifecycle: 'persistent',
      control: 'manager'
    }
  } as unknown as ThreadRecord
}

async function harness(opts: { thread?: ThreadRecord | null; items?: TurnItem[] } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-wcb-routes-'))
  dirs.push(dataDir)
  const teams = new FileTeamStore(dataDir, () => NOW)
  const dispatches = new FileDispatchStore(dataDir, () => NOW)
  const questions = new FileQuestionStore(dataDir, () => NOW)
  const notices = new FileWorkerNoticeStore(dataDir, () => NOW)
  await teams.ensure(MANAGER)
  const dispatch: DispatchRecord = {
    dispatchId: 'dsp_1',
    teamId: MANAGER,
    workerId: WORKER,
    parentTurnId: 'turn_mgr_1',
    title: 'fix login',
    task: 'repair the login redirect',
    mode: 'queue',
    state: 'accepted',
    createdAt: NOW,
    updatedAt: NOW
  }
  await dispatches.create(dispatch)
  const store = new ActivityStore({ nowIso: () => NOW })
  const registry = new TerminalAgentRegistry({
    dataDir,
    activity: store,
    nowIso: () => NOW,
    idGenerator: (() => { let n = 0; return () => `tu_${++n}` })()
  })
  const callbacks = new WorkerCallbackService({
    threadStore: { get: async () => opts.thread === undefined ? workerThread() : opts.thread },
    sessionStore: {
      loadItems: async () => opts.items ?? []
    },
    teams,
    dispatches,
    questions,
    notices,
    activity: store,
    nowIso: () => NOW,
    nowMs: () => Date.now(),
    idGenerator: (() => { let n = 0; return () => `q_${++n}` })()
  })
  const tokens = new HarnessTokenService()
  const router = new Router()
  registerWorkerCallbackRoutes(router, {
    runtimeToken: 'test-token',
    insecure: false,
    activityStore: store,
    ade: { terminalAgents: registry, workerCallbacks: callbacks },
    harnessTokens: tokens,
    nowIso: () => NOW
  } as unknown as ServerRuntime, { askHeartbeatMs: 20 })

  const issue = (threadId: string, scopes: HarnessTokenScope[]) =>
    tokens.issue({ threadId, harnessId: 'claude-code', credentialIdentity: 'test', scopes })

  const request = async (
    action: string,
    body: unknown,
    token?: string
  ): Promise<{ status: number; body: Record<string, unknown> }> => {
    const route = router.match('POST', `/v1/worker-callbacks/${action}`)
    expect(route, `POST /v1/worker-callbacks/${action} should route`).toBeTruthy()
    const response = (await route!.handler(
      new Request(`http://local.test/v1/worker-callbacks/${action}`, {
        method: 'POST',
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          'content-type': 'application/json'
        },
        body: JSON.stringify(body)
      }),
      { params: route!.params }
    )) as JsonResponse
    return { status: response.status, body: JSON.parse(response.body) as Record<string, unknown> }
  }

  const ask = (body: unknown, token: string): Promise<Response | JsonResponse> => {
    const route = router.match('POST', '/v1/worker-callbacks/ask')!
    return Promise.resolve(route.handler(
      new Request('http://local.test/v1/worker-callbacks/ask', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body)
      }),
      { params: route.params }
    ))
  }

  return { store, registry, callbacks, dispatches, questions, issue, request, ask }
}

describe('worker-callback routes', () => {
  it('rejects missing and wrong-scope tokens', async () => {
    const { issue, request } = await harness()
    expect((await request('progress', { summary: 'hi' })).status).toBe(401)
    const gateway = issue(WORKER, ['gateway'])
    expect((await request('progress', { summary: 'hi' }, gateway)).status).toBe(401)
    expect((await request('bogus', {}, issue(WORKER, ['worker-callback']))).status).toBe(404)
  })

  it('reports progress through the shared service with callback provenance', async () => {
    const { issue, request, store } = await harness()
    const token = issue(WORKER, ['worker-callback'])
    const { status, body } = await request('progress', {
      summary: 'located the redirect loop',
      phase: 'investigating'
    }, token)
    expect(status).toBe(200)
    expect(body).toEqual({ status: 'recorded' })
    // The service writes through its activity dep; the store has no row for
    // WORKER here (route-level unit test) — provenance is exercised in the
    // service suite.
    expect(store.get(WORKER)).toBeUndefined()
  })

  it('maps non-worker callers to 409', async () => {
    const { issue, request } = await harness({
      thread: { ...workerThread(), executionUnit: undefined } as ThreadRecord
    })
    const token = issue(WORKER, ['worker-callback'])
    const { status, body } = await request('progress', { summary: 'hi' }, token)
    expect(status).toBe(409)
    expect(body.code).toBe('not_a_worker')
  })

  it('falls back to the terminal-agent registry for tier-0 progress', async () => {
    const { issue, request, store, registry } = await harness()
    await registry.register({
      harnessId: 'claude-code',
      title: 'terminal claude',
      workspace: { path: '/ws', kind: 'local' }
    })
    const token = issue('tu_1', ['worker-callback'])
    const { status, body } = await request('progress', {
      summary: 'halfway',
      phase: 'implementing'
    }, token)
    expect(status).toBe(200)
    expect(body).toEqual({ status: 'recorded' })
    expect(store.get('tu_1')).toMatchObject({
      progressNote: 'halfway',
      phase: 'implementing',
      provenance: 'callback'
    })
    // Second report inside the throttle window is acknowledged, not written.
    const again = await request('progress', { summary: 'more' }, token)
    expect(again.body).toEqual({ status: 'rate_limited' })
    expect(store.get('tu_1')?.progressNote).toBe('halfway')
  })

  it('rejects oversized bodies', async () => {
    const { issue, request } = await harness()
    const token = issue(WORKER, ['worker-callback'])
    const { status } = await request('progress', { summary: 's', pad: 'x'.repeat(200 * 1024) }, token)
    expect(status).toBe(413)
  })

  it('submits results and reads manager context through the same service', async () => {
    const items: TurnItem[] = [{
      id: 'i1',
      kind: 'user_message',
      turnId: 'turn_mgr_1',
      threadId: MANAGER,
      role: 'user',
      status: 'completed',
      createdAt: NOW,
      text: 'raw prompt',
      displayText: 'shown prompt'
    } as TurnItem]
    const { issue, request, dispatches } = await harness({ items })
    const token = issue(WORKER, ['worker-callback'])
    const ctx = await request('context', { query: 'shown' }, token)
    expect(ctx.status).toBe(200)
    expect((ctx.body.items as { text: string }[])[0]?.text).toBe('shown prompt')
    const result = await request('result', {
      outcome: 'succeeded',
      summary: 'redirect fixed',
      filesChanged: ['src/auth.ts'],
      checks: [{ name: 'typecheck', status: 'passed' }]
    }, token)
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ status: 'recorded' })
    expect((await dispatches.get(MANAGER, 'dsp_1'))?.workerReport?.summary).toBe('redirect fixed')
  })

  it('streams heartbeats while ask waits, then delivers the answer', async () => {
    const { issue, ask, callbacks } = await harness()
    const token = issue(WORKER, ['worker-callback'])
    const response = await ask({ question: 'which env?', timeoutSeconds: 5 }, token)
    expect(response).toBeInstanceOf(Response)
    const stream = (response as Response).body!
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let body = ''
    const drain = (async () => {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        body += decoder.decode(value)
      }
    })()
    await vi.waitFor(async () => {
      expect(body.length).toBeGreaterThan(0) // heartbeat whitespace arrived
    })
    await callbacks.answerQuestion({
      teamId: MANAGER,
      questionId: 'q_1',
      answer: 'staging',
      answeredBy: 'manager'
    })
    await drain
    const parsed = JSON.parse(body) as Record<string, unknown>
    expect(parsed).toMatchObject({ status: 'answered', answer: 'staging', answeredBy: 'manager' })
  })

  it('returns timeout status when the ask deadline passes', async () => {
    const { issue, ask } = await harness()
    const token = issue(WORKER, ['worker-callback'])
    const response = await ask({ question: 'anyone?', timeoutSeconds: 1 }, token)
    const body = await (response as Response).text()
    expect(JSON.parse(body)).toEqual({ status: 'timeout' })
  }, 10_000)

  it('validates the ask body before streaming', async () => {
    const { issue, ask } = await harness()
    const token = issue(WORKER, ['worker-callback'])
    const response = await ask({ question: '' }, token)
    expect((response as JsonResponse).status).toBe(400)
  })
})
