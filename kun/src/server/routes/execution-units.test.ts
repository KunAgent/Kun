import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Router } from '../router.js'
import type { JsonResponse } from '../response.js'
import type { ServerRuntime } from './server-runtime.js'
import { ActivityStore } from '../../services/activity-store.js'
import { TerminalAgentRegistry } from '../../services/terminal-agent-registry.js'
import { HarnessTokenService, HARNESS_TOKEN_PREFIX } from '../../harness/harness-token-service.js'
import { HarnessCatalog } from '../../harness/harness-catalog.js'
import { registerExecutionUnitRoutes } from './register-execution-unit-routes.js'

const NOW = '2026-09-10T10:00:00.000Z'
const dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kun-exec-units-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true })
})

async function harness(enabled = true) {
  const dataDir = await tempDir()
  const store = new ActivityStore({ nowIso: () => NOW })
  const tokens = new HarnessTokenService()
  const catalog = new HarnessCatalog({ custom: () => [], enabledProfiles: () => enabled
    ? [{ harnessId: 'claude-code', credentialMode: 'native-login' }] : [] })
  const readiness = { assertReady: vi.fn(async () => 'offline-fixture') }
  const registry = new TerminalAgentRegistry({
    dataDir,
    activity: store,
    nowIso: () => NOW,
    idGenerator: (() => { let n = 0; return () => `tu_${++n}` })()
  })
  const hookWriter = async (
    unitId: string,
    hooks: { kind: string; events: string[] }
  ) => hooks.events.length === 0
    ? null
    : {
        args: ['--settings', `${dataDir}/ade/hooks/${unitId}/settings.json`],
        env: { KUN_HOOK_DIR: `${dataDir}/ade/hooks/${unitId}` },
        dir: `${dataDir}/ade/hooks/${unitId}`
      }
  const router = new Router()
  registerExecutionUnitRoutes(router, {
    runtimeToken: 'test-token',
    insecure: false,
    activityStore: store,
    ade: { terminalAgents: registry, hookWriter },
    harnessTokens: tokens,
    harnesses: { catalog, readiness, gatewayEndpoint: { baseUrl: 'http://127.0.0.1:18899' } },
    nowIso: () => NOW
  } as unknown as ServerRuntime)
  const request = async (
    method: string,
    path: string,
    body?: unknown,
    authorized = true
  ): Promise<{ status: number; body: Record<string, unknown> }> => {
    const route = router.match(method, new URL(path, 'http://local.test').pathname)
    expect(route, `${method} ${path} should route`).toBeTruthy()
    const response = (await route!.handler(
      new Request(`http://local.test${path}`, {
        method,
        headers: {
          ...(authorized ? { authorization: 'Bearer test-token' } : {}),
          'content-type': 'application/json'
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
      }),
      { params: route!.params }
    )) as JsonResponse
    return { status: response.status, body: JSON.parse(response.body) as Record<string, unknown> }
  }
  return { store, tokens, registry, readiness, request }
}

const CREATE_BODY = {
  kind: 'terminal-agent',
  harnessId: 'claude-code',
  title: 'terminal claude',
  workspace: { path: '/ws/task', kind: 'worktree', branch: 'ade/task' },
  workspaceId: 'tw_1'
}

describe('execution-unit routes', () => {
  it('rejects terminal launch while its profile is disabled, without minting a unit', async () => {
    const { request, readiness, store } = await harness(false)
    const { status, body } = await request('POST', '/v1/execution-units', CREATE_BODY)
    expect(status).toBe(409)
    expect(body.code).toBe('harness_unavailable')
    expect(readiness.assertReady).not.toHaveBeenCalled()
    expect(store.get('tu_1')).toBeUndefined()
  })

  it('rejects an enabled terminal profile whose current readiness check fails', async () => {
    const { request, readiness, store } = await harness()
    readiness.assertReady.mockRejectedValueOnce(new Error('Credential changed'))
    expect((await request('POST', '/v1/execution-units', CREATE_BODY)).status).toBe(409)
    expect(store.get('tu_1')).toBeUndefined()
  })

  it('registers a terminal agent and mints scoped tokens', async () => {
    const { store, tokens, request } = await harness()
    const { status, body } = await request('POST', '/v1/execution-units', CREATE_BODY)
    expect(status).toBe(200)
    expect(body.unitId).toBe('tu_1')
    expect(body.endpoint).toBe('http://127.0.0.1:18899')
    const issued = body.tokens as { workerCallback: string; hookIngest: string }
    expect(issued.workerCallback.startsWith(HARNESS_TOKEN_PREFIX)).toBe(true)
    expect(tokens.verify(issued.workerCallback)?.scopes).toEqual(['worker-callback'])
    expect(tokens.verify(issued.hookIngest)?.scopes).toEqual(['hook-ingest'])
    expect(tokens.verify(issued.workerCallback)?.threadId).toBe('tu_1')
    const row = store.get('tu_1')
    expect(row).toMatchObject({
      kind: 'terminal-agent',
      mainState: 'working',
      harnessId: 'claude-code'
    })
    // Managed hooks populate the launch extras for claude-settings (P2-03).
    const launch = body.launch as { args: string[]; env: Record<string, string> }
    expect(launch.args[0]).toBe('--settings')
    expect(launch.args[1]).toContain('/ade/hooks/tu_1/settings.json')
    expect(launch.env.KUN_HOOK_DIR).toContain('/ade/hooks/tu_1')
  })

  it('rejects harnesses without a terminal launch definition', async () => {
    const { request } = await harness()
    const { status, body } = await request('POST', '/v1/execution-units', {
      ...CREATE_BODY,
      harnessId: 'kun'
    })
    expect(status).toBe(400)
    expect(String(body.message)).toContain('terminal')
  })

  it('rejects invalid bodies and unauthorized calls', async () => {
    const { request } = await harness()
    expect((await request('POST', '/v1/execution-units', { kind: 'thread' })).status).toBe(400)
    expect((await request('POST', '/v1/execution-units', CREATE_BODY, false)).status).toBe(401)
  })

  it('marks the row closed on exit reports', async () => {
    const { store, request } = await harness()
    await request('POST', '/v1/execution-units', CREATE_BODY)
    const { status } = await request('POST', '/v1/execution-units/tu_1/exit', { exitCode: 0 })
    expect(status).toBe(200)
    expect(store.get('tu_1')).toMatchObject({ mainState: 'closed', lastOutcome: 'completed' })
    expect((await request('POST', '/v1/execution-units/nope/exit', { exitCode: 0 })).status).toBe(404)
  })

  it('records interrupt hints for the hook mapper to consume', async () => {
    const { registry, request } = await harness()
    await request('POST', '/v1/execution-units', CREATE_BODY)
    const { status, body } = await request('POST', '/v1/execution-units/tu_1/interrupt-hint')
    expect(status).toBe(200)
    expect(body.inferredInterrupt).toBe(true)
    expect(await registry.consumeInterruptHint('tu_1')).toBe(true)
    expect((await request('POST', '/v1/execution-units/nope/interrupt-hint')).status).toBe(404)
  })
})
