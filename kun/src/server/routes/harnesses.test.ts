import { describe, expect, it, vi } from 'vitest'
import { buildRouter } from './index.js'
import type { ServerRuntime } from './server-runtime.js'
import { HarnessCatalog } from '../../harness/harness-catalog.js'
import { HarnessDetector } from '../../harness/harness-detector.js'
import type { HarnessDefinition } from '../../contracts/harness.js'
import { allSupportedStatuses } from '../../contracts/harness-capabilities.js'

const TOKEN = 'harness-token'

function fakeRouter(
  spawn: (command: string) => { stdout: string; exitCode: number | null },
  defs?: HarnessDefinition[],
  resolveExecutable?: (command: string) => Promise<string | undefined>
) {
  const catalog = new HarnessCatalog()
  if (defs) catalog.list = () => defs
  const detector = new HarnessDetector({
    definitions: () => catalog.list(),
    overrides: () => ({}),
    resolveExecutable:
      resolveExecutable ?? (async (command) => (command === 'definitely-missing-kun-binary' ? undefined : `/fake/bin/${command}`)),
    spawnCaptured: async (command) => {
      const result = spawn(command)
      return { stdout: result.stdout, stderr: '', timedOut: false, exitCode: result.exitCode }
    },
    probeLogin: async () => 'not-required',
    nowMs: () => 1_000,
    nowIso: () => '2026-01-01T00:00:00.000Z'
  })
  return buildRouter({
    runtimeToken: TOKEN,
    insecure: false,
    nowIso: () => '2026-01-01T00:00:00.000Z',
    harnesses: { catalog, detector }
  } as unknown as ServerRuntime)
}

async function dispatch(
  router: ReturnType<typeof buildRouter>,
  method: string,
  path: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: string }> {
  const request = new Request(`http://127.0.0.1${path}`, { method, headers })
  const match = router.match(method, new URL(request.url).pathname)
  if (!match) throw new Error(`route not found: ${method} ${path}`)
  const result = await match.handler(request, { params: match.params })
  return result instanceof Response
    ? { status: result.status, body: await result.text() }
    : { status: result.status, body: result.body }
}

const authed = { authorization: `Bearer ${TOKEN}` }

describe('harness routes', () => {
  it('requires runtime authentication', async () => {
    const router = fakeRouter(() => ({ stdout: 'claude 1.2.3', exitCode: 0 }))
    expect((await dispatch(router, 'GET', '/v1/harnesses')).status).toBe(401)
    expect((await dispatch(router, 'POST', '/v1/harnesses/cursor/probe')).status).toBe(401)
    expect((await dispatch(router, 'GET', '/v1/harnesses/cursor/models')).status).toBe(401)
  })

  it('lists builtin harnesses without blocking on detection', async () => {
    const spawn = vi.fn((_command: string) => ({ stdout: 'tool 1.2.3', exitCode: 0 }))
    const router = fakeRouter(spawn)
    const response = await dispatch(router, 'GET', '/v1/harnesses', authed)
    expect(response.status).toBe(200)
    const body = JSON.parse(response.body)
    const ids = body.harnesses.map((row: { definition: { id: string } }) => row.definition.id)
    expect(ids).toEqual(expect.arrayContaining(['kun', 'claude-code', 'cursor', 'antigravity']))
    const kun = body.harnesses.find(
      (row: { definition: { id: string } }) => row.definition.id === 'kun'
    )
    expect(kun.status.installed).toBe('unknown')
    // Listing kicks off background detection but must not spawn for the kun loop.
    await new Promise((resolve) => setTimeout(resolve, 0))
    const spawnedFor = spawn.mock.calls.map((call) => call[0])
    expect(spawnedFor).not.toContain('kun')
  })

  it('probe detects version and reports installed status', async () => {
    const router = fakeRouter((command) =>
      command.endsWith('/antigravity')
        ? { stdout: 'antigravity 2026.1.2', exitCode: 0 }
        : { stdout: '', exitCode: 1 }
    )
    const response = await dispatch(router, 'POST', '/v1/harnesses/antigravity/probe', authed)
    expect(response.status).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.status).toMatchObject({
      harnessId: 'antigravity',
      installed: 'yes',
      version: '2026.1.2',
      login: 'not-required'
    })
    // The cached status now surfaces in list responses.
    const list = await dispatch(router, 'GET', '/v1/harnesses', authed)
    const antigravity = JSON.parse(list.body).harnesses.find(
      (row: { definition: { id: string } }) => row.definition.id === 'antigravity'
    )
    expect(antigravity.status.installed).toBe('yes')
    // And it stayed binary-resolved through the injected resolver.
    expect(antigravity.status.resolvedCommand).toBe('/fake/bin/antigravity')
  })

  it('bundled SDK transports probe as installed without a binary', async () => {
    const spawn = vi.fn(() => ({ stdout: '', exitCode: 1 }))
    const router = fakeRouter(spawn)
    const response = await dispatch(router, 'POST', '/v1/harnesses/cursor/probe', authed)
    const body = JSON.parse(response.body)
    expect(body.status.installed).toBe('yes')
    // No CLI exists for the bundled sdk transport; nothing is spawned.
    expect(spawn).not.toHaveBeenCalled()
  })

  it('reports installed=no when the binary is missing', async () => {
    const defs: HarnessDefinition[] = [{
      id: 'fake-cli',
      displayName: 'Fake CLI',
      transport: 'acp',
      detect: { command: 'definitely-missing-kun-binary', aliases: [], versionArgs: ['--version'] },
      launch: { command: 'definitely-missing-kun-binary', args: [], env: {} },
      credentialModes: ['native-login'],
      permissionModes: [],
      modelSource: 'probe',
      staticModels: [],
      capabilities: {
        statuses: allSupportedStatuses(),
        facts: { sandbox: 'none', usageReporting: 'none', compactionOwner: 'none' }
      },
      builtin: false
    }]
    const router = fakeRouter(() => ({ stdout: '', exitCode: 1 }), defs)
    const response = await dispatch(router, 'POST', '/v1/harnesses/fake-cli/probe', authed)
    expect(JSON.parse(response.body).status.installed).toBe('no')
  })

  it('returns 404 for unknown harness ids', async () => {
    const router = fakeRouter(() => ({ stdout: '', exitCode: 1 }))
    expect((await dispatch(router, 'POST', '/v1/harnesses/nope/probe', authed)).status).toBe(404)
    expect((await dispatch(router, 'GET', '/v1/harnesses/nope/models', authed)).status).toBe(404)
  })

  it('serves static models and provider-sourced models', async () => {
    const router = fakeRouter(() => ({ stdout: '', exitCode: 1 }))
    const claude = await dispatch(router, 'GET', '/v1/harnesses/claude-code/models', authed)
    expect(claude.status).toBe(200)
    expect(JSON.parse(claude.body).models.length).toBeGreaterThan(0)

    const kunModels = await dispatch(router, 'GET', '/v1/harnesses/kun/models', authed)
    expect(JSON.parse(kunModels.body).models).toEqual([])
  })

  it('lists provider-sourced models from configured providers', async () => {
    const catalog = new HarnessCatalog()
    const detector = new HarnessDetector({
      definitions: () => catalog.list(),
      overrides: () => ({}),
      spawnCaptured: async () => ({ stdout: '', stderr: '', timedOut: false, exitCode: null }),
      probeLogin: async () => 'unknown',
      nowMs: () => 1_000,
      nowIso: () => '2026-01-01T00:00:00.000Z'
    })
    const router = buildRouter({
      runtimeToken: TOKEN,
      insecure: false,
      nowIso: () => '2026-01-01T00:00:00.000Z',
      harnesses: { catalog, detector },
      providerConfigs: () => ({
        cursorMain: {
          kind: 'cursor-sdk',
          models: ['composer-2'],
          selectedModel: 'auto'
        },
        deepseek: { kind: 'http', models: ['deepseek-chat'] }
      })
    } as unknown as ServerRuntime)
    const response = await dispatch(router, 'GET', '/v1/harnesses/cursor/models', authed)
    const models = JSON.parse(response.body).models as string[]
    expect(models).toContain('composer-2')
    expect(models).toContain('auto')
    expect(models).not.toContain('deepseek-chat')
  })

  it('groups gateway-exposable providers for credential_mode=kun-gateway', async () => {
    const catalog = new HarnessCatalog()
    const detector = new HarnessDetector({
      definitions: () => catalog.list(),
      overrides: () => ({}),
      spawnCaptured: async () => ({ stdout: '', stderr: '', timedOut: false, exitCode: null }),
      probeLogin: async () => 'unknown',
      nowMs: () => 1_000,
      nowIso: () => '2026-01-01T00:00:00.000Z'
    })
    const router = buildRouter({
      runtimeToken: TOKEN,
      insecure: false,
      nowIso: () => '2026-01-01T00:00:00.000Z',
      harnesses: { catalog, detector },
      modelConnections: {
        snapshot: async () => ({
          providers: [
            {
              id: 'deepseek', name: 'DeepSeek', kind: 'http', authType: 'api-key',
              configured: true, credentialStatus: 'ready',
              models: ['deepseek-chat'], selectedModel: 'deepseek-reasoner'
            },
            {
              id: 'oauth-sub', name: 'Subscription', kind: 'http', authType: 'oauth',
              configured: true, models: ['sub-1']
            },
            {
              id: 'nokey', name: 'NoKey', kind: 'http', authType: 'api-key',
              configured: true, credentialStatus: 'missing', models: ['x']
            }
          ]
        })
      }
    } as unknown as ServerRuntime)

    const response = await dispatch(
      router, 'GET', '/v1/harnesses/claude-code/models?credential_mode=kun-gateway', authed
    )
    expect(response.status).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.credentialMode).toBe('kun-gateway')
    expect(body.groups).toEqual([
      {
        providerId: 'deepseek',
        label: 'DeepSeek',
        models: ['deepseek-chat', 'deepseek-reasoner']
      }
    ])
  })
})
