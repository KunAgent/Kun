import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { buildRouter } from './index.js'
import type { ServerRuntime } from './server-runtime.js'
import { HarnessCatalog } from '../../harness/harness-catalog.js'
import { HarnessDetector } from '../../harness/harness-detector.js'
import type { HarnessDefinition } from '../../contracts/harness.js'
import { allSupportedStatuses } from '../../contracts/harness-capabilities.js'
import { harnessSecretRefResolver } from '../../harness/harness-secret-env.js'

const TOKEN = 'harness-token'
const FAKE_ACP_AGENT = fileURLToPath(
  new URL('../../runtime/acp/__fixtures__/fake-acp-agent.mjs', import.meta.url)
)
const ACP_SCENARIOS = fileURLToPath(
  new URL('../../runtime/acp/__fixtures__/scenarios/', import.meta.url)
)

type FakeCredentials = {
  create: (payload: { apiKey?: string }) => Promise<string>
  get: (ref: string) => Promise<{ apiKey?: string } | null>
  delete: (ref: string) => Promise<void>
}

function fakeCredentials(seed: Record<string, { apiKey?: string }> = {}): FakeCredentials {
  const store = new Map<string, { apiKey?: string }>(Object.entries(seed))
  return {
    create: async (payload) => {
      const ref = `cred_${store.size + 1}`
      store.set(ref, payload)
      return ref
    },
    get: async (ref) => store.get(ref) ?? null,
    delete: async (ref) => {
      store.delete(ref)
    }
  }
}

function fakeRouter(
  spawn: (command: string) => { stdout: string; exitCode: number | null },
  defs?: HarnessDefinition[],
  resolveExecutable?: (command: string) => Promise<string | undefined>,
  credentials?: FakeCredentials
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
    harnesses: {
      catalog,
      detector,
      resolveSecretEnv: credentials ? harnessSecretRefResolver(credentials) : undefined
    },
    ...(credentials ? { extensionPlatform: { credentials } } : {})
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
  it('returns native model metadata beside the compatible flat model list', async () => {
    const modelInfo = [{ id: 'gpt-native', inputModalities: ['text', 'image'], isDefault: true }]
    const router = buildRouter({ runtimeToken: TOKEN, insecure: false,
      harnesses: { catalog: new HarnessCatalog(), codexModels: {
        probeCatalog: async () => ({ models: ['gpt-native'], modelInfo })
      } } } as unknown as ServerRuntime)
    const response = await dispatch(router, 'GET', '/v1/harnesses/codex/models', authed)
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({ models: ['gpt-native'], modelInfo })
  })

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
    // P4-02: native-loop detection settles synchronously, so the fresh cache
    // wins over the optimistic peek placeholder by the time rows render.
    expect(kun.status.installed).toBe('yes')
    // Listing kicks off background detection but must not spawn for the kun loop.
    await new Promise((resolve) => setTimeout(resolve, 0))
    const spawnedFor = spawn.mock.calls.map((call) => call[0])
    expect(spawnedFor).not.toContain('kun')
  })

  it('probe detects version and reports installed status', async () => {
    const router = fakeRouter((command) =>
      command.endsWith('/agy')
        ? { stdout: 'agy 2026.1.2', exitCode: 0 }
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
    expect(antigravity.status.resolvedCommand).toBe('/fake/bin/agy')
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

  it('binds Cursor provider mode to Cursor SDK accounts instead of HTTP gateway profiles', async () => {
    const catalog = new HarnessCatalog()
    const router = buildRouter({ runtimeToken: TOKEN, insecure: false,
      nowIso: () => '2026-01-01T00:00:00.000Z', harnesses: { catalog },
      modelConnections: { snapshot: async () => ({ providers: [
        { id: 'cursor-account', name: 'Cursor account', kind: 'cursor-sdk', authType: 'subscription',
          configured: true, credentialStatus: 'ready', models: ['composer-2'] },
        { id: 'missing-cursor', name: 'Missing', kind: 'cursor-sdk', authType: 'subscription',
          configured: true, credentialStatus: 'missing', models: ['auto'] },
        { id: 'http', name: 'HTTP', kind: 'http', authType: 'api-key',
          configured: true, credentialStatus: 'ready', models: ['deepseek-chat'] }
      ] }) }
    } as unknown as ServerRuntime)
    const response = await dispatch(router, 'GET', '/v1/harnesses/cursor/models?credential_mode=provider', authed)
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body).groups).toEqual([
      { providerId: 'cursor-account', label: 'Cursor account', models: ['composer-2'] }
    ])
    expect((await dispatch(router, 'GET', '/v1/harnesses/cursor/models?credential_mode=kun-gateway', authed)).status).toBe(400)
  })

  it('serves probed agent-sdk models and falls back when the probe fails', async () => {
    const catalog = new HarnessCatalog()
    const detector = new HarnessDetector({
      definitions: () => catalog.list(),
      overrides: () => ({}),
      spawnCaptured: async () => ({ stdout: '', stderr: '', timedOut: false, exitCode: null }),
      probeLogin: async () => 'unknown',
      nowMs: () => 1_000,
      nowIso: () => '2026-01-01T00:00:00.000Z'
    })
    const runtime = (probed: string[]) =>
      buildRouter({
        runtimeToken: TOKEN,
        insecure: false,
        nowIso: () => '2026-01-01T00:00:00.000Z',
        harnesses: {
          catalog,
          detector,
          agentSdkModels: { probe: async () => probed }
        }
      } as unknown as ServerRuntime)
    const ok = await dispatch(
      runtime(['claude-opus-5', 'claude-sonnet-5']),
      'GET', '/v1/harnesses/claude-code/models', authed
    )
    expect(JSON.parse(ok.body).models).toEqual(['claude-opus-5', 'claude-sonnet-5'])
    const fallback = await dispatch(
      runtime([]), 'GET', '/v1/harnesses/claude-code/models', authed
    )
    const staticModels = JSON.parse(fallback.body).models as string[]
    expect(staticModels.length).toBeGreaterThan(0)
    expect(staticModels).not.toContain('claude-opus-4-8')
  })

  function acpDef(): HarnessDefinition {
    return {
      id: 'fake-cli',
      displayName: 'Fake CLI',
      transport: 'acp',
      detect: { command: 'fake-cli', aliases: [], versionArgs: ['--version'] },
      launch: { command: 'fake-cli', args: [], env: {} },
      credentialModes: ['native-login'],
      permissionModes: [],
      modelSource: 'static',
      staticModels: [],
      capabilities: {
        statuses: allSupportedStatuses(),
        facts: { sandbox: 'none', usageReporting: 'none', compactionOwner: 'none' }
      },
      builtin: false
    }
  }

  function slowDetectorRouter(
    spawn: (command: string) => Promise<{ stdout: string; stderr: string; timedOut: boolean; exitCode: number | null }>
  ) {
    const catalog = new HarnessCatalog()
    catalog.list = () => [acpDef()]
    const detector = new HarnessDetector({
      definitions: () => catalog.list(),
      overrides: () => ({}),
      resolveExecutable: async (command) => `/fake/bin/${command}`,
      spawnCaptured: spawn,
      probeLogin: async () => 'signed-in',
      nowMs: () => Date.now(),
      nowIso: () => new Date().toISOString()
    })
    return buildRouter({
      runtimeToken: TOKEN,
      insecure: false,
      nowIso: () => '2026-01-01T00:00:00.000Z',
      harnesses: { catalog, detector }
    } as unknown as ServerRuntime)
  }

  it('marks rows detecting while a probe is inflight', async () => {
    let release: (() => void) | undefined
    const router = slowDetectorRouter(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ stdout: 'fake 1.2.3', stderr: '', timedOut: false, exitCode: 0 })
        })
    )
    const response = await dispatch(router, 'GET', '/v1/harnesses', authed)
    expect(response.status).toBe(200)
    const row = JSON.parse(response.body).harnesses[0]
    expect(row.status.installed).toBe('unknown')
    expect(row.status.detecting).toBe(true)
    release?.()
  })

  it('wait_ms holds the response until inflight detections settle', async () => {
    let release: (() => void) | undefined
    const router = slowDetectorRouter(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ stdout: 'fake 1.2.3', stderr: '', timedOut: false, exitCode: 0 })
        })
    )
    const pending = dispatch(router, 'GET', '/v1/harnesses?wait_ms=5000', authed)
    // Let peek() start the inflight detection before releasing it.
    await new Promise((resolve) => setTimeout(resolve, 10))
    release?.()
    const response = await pending
    expect(response.status).toBe(200)
    const row = JSON.parse(response.body).harnesses[0]
    expect(row.status.installed).toBe('yes')
    expect(row.status.version).toBe('1.2.3')
    expect(row.status.detecting).toBeFalsy()
  })

  it('wait_ms is bounded: rows still probing return with detecting=true', async () => {
    let release: (() => void) | undefined
    const router = slowDetectorRouter(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ stdout: 'fake 1.2.3', stderr: '', timedOut: false, exitCode: 0 })
        })
    )
    const startedAt = Date.now()
    const response = await dispatch(router, 'GET', '/v1/harnesses?wait_ms=50', authed)
    expect(Date.now() - startedAt).toBeLessThan(2_000)
    const row = JSON.parse(response.body).harnesses[0]
    expect(row.status.installed).toBe('unknown')
    expect(row.status.detecting).toBe(true)
    release?.()
  })

  // P4-10: POST /v1/harnesses/:id/test
  it('requires runtime authentication for harness tests', async () => {
    const router = fakeRouter(() => ({ stdout: '', exitCode: 1 }))
    const response = await dispatch(router, 'POST', '/v1/harnesses/kun/test')
    expect(response.status).toBe(401)
  })

  it('returns 404 for tests on unknown harnesses', async () => {
    const router = fakeRouter(() => ({ stdout: '', exitCode: 1 }))
    const request = new Request('http://127.0.0.1/v1/harnesses/nope/test', {
      method: 'POST',
      headers: { ...authed, 'content-type': 'application/json' },
      body: JSON.stringify({ level: 'detect' })
    })
    const match = router.match('POST', new URL(request.url).pathname)
    const result = await match!.handler(request, { params: match!.params })
    const status = result instanceof Response ? result.status : result.status
    expect(status).toBe(404)
  })

  it('rejects an invalid test body and an unsupported credential mode', async () => {
    const router = fakeRouter(() => ({ stdout: '', exitCode: 1 }))
    const post = async (body: unknown) => {
      const request = new Request('http://127.0.0.1/v1/harnesses/kun/test', {
        method: 'POST',
        headers: { ...authed, 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
      const match = router.match('POST', new URL(request.url).pathname)
      const result = await match!.handler(request, { params: match!.params })
      return result instanceof Response ? result.status : result.status
    }
    expect(await post({})).toBe(400)
    expect(await post({ level: 'nope' })).toBe(400)
    // `kun-gateway` is not in kun's credentialModes list.
    expect(await post({ level: 'detect', credentialMode: 'kun-gateway' })).toBe(400)
  })

  it('runs a detect-level test for an installed harness', async () => {
    const router = fakeRouter(() => ({ stdout: '', exitCode: 1 }))
    const request = new Request('http://127.0.0.1/v1/harnesses/kun/test', {
      method: 'POST',
      headers: { ...authed, 'content-type': 'application/json' },
      body: JSON.stringify({ level: 'detect' })
    })
    const match = router.match('POST', new URL(request.url).pathname)
    const result = await match!.handler(request, { params: match!.params })
    const status = result instanceof Response ? result.status : result.status
    const body = JSON.parse(
      result instanceof Response ? await result.text() : result.body
    )
    expect(status).toBe(200)
    expect(body.level).toBe('detect')
    expect(body.ok).toBe(true)
    expect(body.detect.status.installed).toBe('yes')
    expect(body.handshake).toBeUndefined()
  })

  // P4-12: POST /v1/harnesses/probe-definition + /v1/harness-secrets
  async function postJson(
    router: ReturnType<typeof buildRouter>,
    path: string,
    body: unknown
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const request = new Request(`http://127.0.0.1${path}`, {
      method: 'POST',
      headers: { ...authed, 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
    const match = router.match('POST', new URL(request.url).pathname)
    if (!match) throw new Error(`route not found: POST ${path}`)
    const result = await match.handler(request, { params: match.params })
    const text = result instanceof Response ? await result.text() : result.body
    return {
      status: result instanceof Response ? result.status : result.status,
      json: JSON.parse(text)
    }
  }

  it('requires runtime authentication for probe-definition and secrets', async () => {
    const router = fakeRouter(() => ({ stdout: '', exitCode: 1 }), undefined, undefined, fakeCredentials())
    const request = (path: string, method: string) =>
      new Request(`http://127.0.0.1${path}`, { method })
    for (const [method, path] of [
      ['POST', '/v1/harnesses/probe-definition'],
      ['POST', '/v1/harness-secrets'],
      ['DELETE', '/v1/harness-secrets/cred_1']
    ] as const) {
      const req = request(path, method)
      const match = router.match(method, new URL(req.url).pathname)
      const result = await match!.handler(req, { params: match!.params })
      expect(result instanceof Response ? result.status : result.status).toBe(401)
    }
  })

  it('rejects invalid probe-definition bodies', async () => {
    const router = fakeRouter(() => ({ stdout: '', exitCode: 1 }))
    expect((await postJson(router, '/v1/harnesses/probe-definition', {})).status).toBe(400)
    expect(
      (await postJson(router, '/v1/harnesses/probe-definition', {
        displayName: 'x', command: 'tool',
        env: { 'lowercase': 'v' }
      })).status
    ).toBe(400)
    expect(
      (await postJson(router, '/v1/harnesses/probe-definition', {
        displayName: 'x', command: 'tool',
        secretEnv: [{ name: 'MY_KEY', secretRef: '' }]
      })).status
    ).toBe(400)
  })

  it('handshakes an unsaved ACP definition against the fixture agent', async () => {
    const router = fakeRouter(() => ({ stdout: '', exitCode: 1 }), undefined, undefined, fakeCredentials())
    const { status, json } = await postJson(router, '/v1/harnesses/probe-definition', {
      displayName: 'Probe Me',
      command: process.execPath,
      args: [FAKE_ACP_AGENT],
      env: { FAKE_ACP_SCENARIO: `${ACP_SCENARIOS}basic-chat.json` }
    })
    expect(status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.agent).toMatchObject({ name: 'fake-acp-agent', version: '0.0.1' })
    expect(json.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('injects resolved secretEnv into the probed child env without leaking it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kun-probe-def-'))
    const outFile = join(dir, 'env-out.txt')
    const credentials = fakeCredentials({ cred_secret: { apiKey: 's3cr3t-value' } })
    const router = fakeRouter(() => ({ stdout: '', exitCode: 1 }), undefined, undefined, credentials)
    const { status, json } = await postJson(router, '/v1/harnesses/probe-definition', {
      displayName: 'Secret Probe',
      command: process.execPath,
      args: [
        '-e',
        `require('fs').writeFileSync(${JSON.stringify(outFile)}, process.env.P4_SECRET ?? '')`
      ],
      secretEnv: [{ name: 'P4_SECRET', secretRef: 'cred_secret' }]
    })
    expect(status).toBe(200)
    // The child exits without speaking ACP, so the handshake reports failure —
    // but the secret still had to reach the child's env to be written out.
    expect(readFileSync(outFile, 'utf8')).toBe('s3cr3t-value')
    const wire = JSON.stringify(json)
    expect(wire).not.toContain('s3cr3t-value')
    expect(wire).not.toContain('cred_secret')
  })

  it('fails closed and names only the env var when a secret ref is unresolvable', async () => {
    const credentials = fakeCredentials()
    const router = fakeRouter(() => ({ stdout: '', exitCode: 1 }), undefined, undefined, credentials)
    const { json } = await postJson(router, '/v1/harnesses/probe-definition', {
      displayName: 'Missing Secret',
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
      secretEnv: [{ name: 'GONE_KEY', secretRef: 'cred_missing' }]
    })
    expect(json.ok).toBe(false)
    const wire = JSON.stringify(json)
    expect(wire).toContain('GONE_KEY')
    expect(wire).not.toContain('cred_missing')
  })

  it('stores a secret and returns only its opaque ref; delete releases it', async () => {
    const credentials = fakeCredentials()
    const router = fakeRouter(() => ({ stdout: '', exitCode: 1 }), undefined, undefined, credentials)
    const { status, json } = await postJson(router, '/v1/harness-secrets', {
      value: 'my-api-key'
    })
    expect(status).toBe(200)
    expect(typeof json.secretRef).toBe('string')
    expect(JSON.stringify(json)).not.toContain('my-api-key')
    const ref = json.secretRef as string
    expect(await credentials.get(ref)).toEqual({ apiKey: 'my-api-key' })

    const del = new Request(`http://127.0.0.1/v1/harness-secrets/${ref}`, {
      method: 'DELETE',
      headers: authed
    })
    const match = router.match('DELETE', new URL(del.url).pathname)
    const result = await match!.handler(del, { params: match!.params })
    expect(result instanceof Response ? result.status : result.status).toBe(200)
    expect(await credentials.get(ref)).toBeNull()
  })

  it('rejects an empty secret value and an oversized secret ref', async () => {
    const router = fakeRouter(() => ({ stdout: '', exitCode: 1 }), undefined, undefined, fakeCredentials())
    expect((await postJson(router, '/v1/harness-secrets', { value: '' })).status).toBe(400)
    const del = new Request(`http://127.0.0.1/v1/harness-secrets/${'x'.repeat(300)}`, {
      method: 'DELETE',
      headers: authed
    })
    const match = router.match('DELETE', new URL(del.url).pathname)
    const result = await match!.handler(del, { params: match!.params })
    expect(result instanceof Response ? result.status : result.status).toBe(400)
  })
})
