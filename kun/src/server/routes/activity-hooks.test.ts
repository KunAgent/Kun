import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Router } from '../router.js'
import type { JsonResponse } from '../response.js'
import type { ServerRuntime } from './server-runtime.js'
import { ActivityStore } from '../../services/activity-store.js'
import { TerminalAgentRegistry } from '../../services/terminal-agent-registry.js'
import { HarnessTokenService } from '../../harness/harness-token-service.js'
import type { HarnessTokenScope } from '../../harness/harness-token-service.js'
import { HarnessCatalog } from '../../harness/harness-catalog.js'
import { registerActivityRoutes } from './register-activity-routes.js'

const NOW = '2026-10-01T00:00:00.000Z'
const dirs: string[] = []

afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true })
})

async function harness() {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-hooks-'))
  dirs.push(dataDir)
  const store = new ActivityStore({ nowIso: () => NOW })
  const tokens = new HarnessTokenService()
  const catalog = new HarnessCatalog({ custom: () => [] })
  const registry = new TerminalAgentRegistry({
    dataDir,
    activity: store,
    nowIso: () => NOW,
    idGenerator: (() => { let n = 0; return () => `tu_${++n}` })()
  })
  const router = new Router()
  registerActivityRoutes(router, {
    runtimeToken: 'test-token',
    insecure: false,
    activityStore: store,
    ade: { terminalAgents: registry },
    harnessTokens: tokens,
    harnesses: { catalog },
    nowIso: () => NOW
  } as unknown as ServerRuntime)
  const issue = (threadId: string, scopes: HarnessTokenScope[]) =>
    tokens.issue({ threadId, harnessId: 'claude-code', credentialIdentity: 'test', scopes })
  const post = async (
    body: unknown,
    token?: string
  ): Promise<{ status: number; body: Record<string, unknown> }> => {
    const route = router.match('POST', '/v1/activity/hooks')
    expect(route).toBeTruthy()
    const response = (await route!.handler(
      new Request('http://local.test/v1/activity/hooks', {
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
  const registerUnit = () => registry.register({
    harnessId: 'claude-code',
    title: 'terminal claude',
    workspace: { path: '/ws', kind: 'local' }
  })
  return { store, registry, issue, post, registerUnit }
}

describe('POST /v1/activity/hooks', () => {
  it('rejects missing tokens and wrong scopes', async () => {
    const { issue, post, registerUnit } = await harness()
    await registerUnit()
    expect((await post({ event: 'Stop' })).status).toBe(401)
    const workerCallback = issue('tu_1', ['worker-callback'])
    expect((await post({ event: 'Stop' }, workerCallback)).status).toBe(401)
  })

  it('rejects hooks for unknown units', async () => {
    const { issue, post } = await harness()
    const orphan = issue('tu_ghost', ['hook-ingest'])
    expect((await post({ event: 'Stop' }, orphan)).status).toBe(404)
  })

  it('applies mapped events to the unit row and persists state', async () => {
    const { store, registry, issue, post, registerUnit } = await harness()
    await registerUnit()
    const token = issue('tu_1', ['hook-ingest'])
    const applied = await post({ event: 'PostToolUse', toolName: 'Edit' }, token)
    expect(applied.status).toBe(200)
    expect(applied.body).toEqual({ unitId: 'tu_1', status: 'applied' })
    expect(store.get('tu_1')).toMatchObject({
      mainState: 'working',
      currentTool: 'Edit',
      provenance: 'hook'
    })
    expect((await registry.get('tu_1'))?.mainState).toBe('working')
  })

  it('ignores unknown events without failing', async () => {
    const { issue, post, registerUnit } = await harness()
    await registerUnit()
    const token = issue('tu_1', ['hook-ingest'])
    const { status, body } = await post({ event: 'SubagentStop' }, token)
    expect(status).toBe(200)
    expect(body.status).toBe('ignored')
  })

  it('consumes the interrupt hint so Stop resolves to cancelled', async () => {
    const { store, registry, issue, post, registerUnit } = await harness()
    await registerUnit()
    const token = issue('tu_1', ['hook-ingest'])
    await registry.interruptHint('tu_1')
    const { body } = await post({ event: 'Stop' }, token)
    expect(body.status).toBe('applied')
    expect(store.get('tu_1')).toMatchObject({ mainState: 'done', lastOutcome: 'cancelled' })
    // The hint is consumed: a later clean Stop resolves to completed.
    await post({ event: 'UserPromptSubmit' }, token)
    await post({ event: 'Stop' }, token)
    expect(store.get('tu_1')?.lastOutcome).toBe('completed')
  })

  it('records the native session id on SessionStart', async () => {
    const { registry, issue, post, registerUnit } = await harness()
    await registerUnit()
    const token = issue('tu_1', ['hook-ingest'])
    await post({ event: 'SessionStart', sessionId: 'sess_native_1' }, token)
    expect((await registry.get('tu_1'))?.nativeSessionId).toBe('sess_native_1')
  })

  it('rejects invalid and oversized payloads', async () => {
    const { issue, post, registerUnit } = await harness()
    await registerUnit()
    const token = issue('tu_1', ['hook-ingest'])
    expect((await post({ notEvent: true }, token)).status).toBe(400)
    expect((await post({ event: 'Stop', pad: 'x'.repeat(70 * 1024) }, token)).status).toBe(413)
  })
})
