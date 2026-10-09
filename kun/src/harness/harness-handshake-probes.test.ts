import { PassThrough } from 'node:stream'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { probeAcpHandshake } from './acp-handshake-probe.js'
import { probeCodexHandshake } from './codex-handshake-probe.js'
import { probePiHandshake } from './pi-handshake-probe.js'
import { startHarnessProcess, type HarnessProcess } from '../session/harness-process.js'
import { HarnessCatalog } from './harness-catalog.js'

vi.mock('../session/harness-process.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../session/harness-process.js')>(), startHarnessProcess: vi.fn()
}))
const catalog = new HarnessCatalog({ custom: () => [] })
const probes = [
  { name: 'ACP', probe: probeAcpHandshake, def: catalog.get('opencode')! },
  { name: 'Codex', probe: probeCodexHandshake, def: catalog.get('codex')! },
  { name: 'Pi', probe: probePiHandshake, def: catalog.get('pi')! }
]
const spawn = vi.mocked(startHarnessProcess)
beforeEach(() => { spawn.mockReset() })
it('classifies an actual ACP auth_required response as login required without authenticating or prompting', async () => {
  const child = fixture({ authRequired: true })
  spawn.mockResolvedValue(child.process)
  const result = await probeAcpHandshake(catalog.get('droid')!, 'fixture', { session: {} })
  expect(result).toMatchObject({ ok: false, authRequired: true, authentication: 'missing', detail: expect.stringContaining('requires login') })
  expect(child.requests.map((request) => request.method)).toEqual(['initialize', 'session/new'])
  expect(child.stop).toHaveBeenCalledOnce()
})
it.each(['launch', 'initialize'])('explains the OpenCode database written by OpenCode2 when the %s fails', async (stage) => {
  const crash = 'Error: Unexpected error Database is not empty and has no session table'
  if (stage === 'launch') spawn.mockRejectedValue(new Error(`ACP agent process exited (code 1, signal null): ${crash}`))
  else {
    // The process accepts initialize and then exits before answering.
    const stdin = new PassThrough(), stdout = new PassThrough()
    let exited!: (value: { code: number; signal: null }) => void
    const exit = new Promise<{ code: number; signal: null }>((resolve) => { exited = resolve })
    stdin.on('data', () => { stdout.end(); exited({ code: 1, signal: null }) })
    spawn.mockResolvedValue({ stdin, stdout, exit, stop: vi.fn(async () => undefined), sanitizedStderrTail: () => crash } as unknown as HarnessProcess)
  }
  const result = await probeAcpHandshake(catalog.get('opencode')!, 'fixture', { session: {} })
  expect(result).toMatchObject({ ok: false, detail: expect.stringContaining('created by OpenCode2') })
})
it('keeps an ACP session usable when plugins replace the permission-mapped modes with native Agents', async () => {
  const child = fixture({ session: { sessionId: 'fixture', configOptions: [{ id: 'mode', name: 'Mode', category: 'mode',
    type: 'select', currentValue: 'Sisyphus', options: [{ value: 'Sisyphus', name: 'Sisyphus' }, { value: 'Prometheus', name: 'Prometheus' }] }] } })
  spawn.mockResolvedValue(child.process)
  const result = await probeAcpHandshake(catalog.get('opencode')!, 'fixture', { session: { permissionMode: 'plan' } })
  expect(result).toMatchObject({ ok: true, detail: expect.stringContaining('pick one in the composer') })
  expect(child.requests.map((request) => request.method)).toEqual(['initialize', 'session/new'])
})
function fixture(options: { silent?: boolean; account?: unknown; accountError?: boolean; models?: unknown[]; modelError?: boolean; modelHang?: boolean; session?: unknown; sessionError?: boolean; authRequired?: boolean; authMessage?: string; sessionHang?: boolean } = {}) {
  const stdin = new PassThrough(), stdout = new PassThrough()
  let exited!: () => void
  const exit = new Promise<{ code: number; signal: null }>((resolve) => {
    exited = () => resolve({ code: 0, signal: null })
  })
  const stop = vi.fn(async () => { stdout.end(); exited() })
  const requests: Array<Record<string, unknown>> = []
  stdin.on('data', (data: Buffer) => {
    const request = JSON.parse(data.toString())
    requests.push(request)
    if (options.silent || request.id === undefined) return
    if (request.type === 'get_available_models' && options.modelHang) return
    if (request.method === 'model/list' && options.modelHang) return
    if (request.method === 'session/new' && options.sessionHang) return
    const response = request.method === 'model/list'
      ? options.modelError
        ? { id: request.id, error: { code: -32000, message: 'model catalog unavailable' } }
        : { id: request.id, result: { data: options.models ?? [], nextCursor: null } }
      : request.method === 'session/new'
      ? options.sessionError || options.authRequired
        ? { id: request.id, error: { code: options.authRequired ? -32000 : -32603,
            message: options.authRequired ? options.authMessage ?? 'Authentication required' : 'metadata unavailable' } }
        : { id: request.id, result: options.session ?? { sessionId: 'fixture' } }
      : request.type === 'get_available_models'
      ? { id: request.id, type: 'response', command: request.type, success: !options.modelError,
          ...(options.modelError ? { error: 'model catalog unavailable' } : { data: { models: options.models ?? [] } }) }
      : request.type === 'get_state'
      ? { id: request.id, type: 'response', command: 'get_state', success: true, data: {} }
      : request.method === 'account/read'
        ? options.accountError
          ? { id: request.id, error: { code: -32601, message: 'account metadata unavailable' } }
          : { id: request.id, result: options.account ?? { account: null, requiresOpenaiAuth: false } }
        : { id: request.id, result: { protocolVersion: 1, agentCapabilities: {},
          authMethods: [{ id: 'login', name: 'Sign in' }], userAgent: 'codex/0.110.0',
          codexHome: '/fixture', platformFamily: 'unix', platformOs: 'linux' } }
    queueMicrotask(() => stdout.write(JSON.stringify(response) + '\n'))
  })
  return { process: { stdin, stdout, exit, stop, sanitizedStderrTail: () => '' } as unknown as HarnessProcess, stop, requests }
}
for (const { name, probe, def } of probes) {
  describe(`${name} safe handshake`, () => {
    it('does no work for a pre-aborted request', async () => {
      const controller = new AbortController()
      controller.abort(new Error('cancelled'))
      expect((await probe(def, 'fixture', { signal: controller.signal })).ok).toBe(false)
      expect(spawn).not.toHaveBeenCalled()
    })
    it('does not spawn after cancelled secret resolution', async () => {
      const controller = new AbortController()
      let finish!: (value: string) => void
      const resolveSecretEnv = vi.fn(() => new Promise<string>((resolve) => { finish = resolve }))
      const pending = probe({ ...def, launch: { command: 'fixture', args: [], env: {},
        secretEnv: [{ name: 'PROFILE_KEY', secretRef: 'ref' }] } }, 'fixture', { signal: controller.signal, resolveSecretEnv })
      await vi.waitFor(() => expect(resolveSecretEnv).toHaveBeenCalled())
      controller.abort(new Error('cancelled'))
      expect((await pending).ok).toBe(false)
      finish('fixture')
      await Promise.resolve()
      expect(spawn).not.toHaveBeenCalled()
    })
    it('reclaims a child returned after aborting the spawn', async () => {
      const controller = new AbortController()
      const child = fixture()
      let finish!: (value: HarnessProcess) => void
      spawn.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
      const pending = probe(def, 'fixture', { signal: controller.signal })
      await vi.waitFor(() => expect(spawn).toHaveBeenCalled())
      controller.abort(new Error('cancelled'))
      expect((await pending).ok).toBe(false)
      finish(child.process)
      await vi.waitFor(() => expect(child.stop).toHaveBeenCalledOnce())
      expect(child.requests).toEqual([])
    })
    it('closes the process on cancellation during its first protocol request', async () => {
      const controller = new AbortController()
      const child = fixture({ silent: true })
      spawn.mockResolvedValue(child.process)
      const pending = probe(def, 'fixture', { signal: controller.signal })
      await vi.waitFor(() => expect(child.requests.length).toBe(1))
      controller.abort(new Error('cancelled'))
      expect((await pending).ok).toBe(false)
      expect(child.stop).toHaveBeenCalledOnce()
    })
    it('injects selected-profile env last and performs metadata only', async () => {
      const child = fixture()
      spawn.mockResolvedValue(child.process)
      const result = await probe(def, 'fixture', { env: { PROFILE: 'chosen', API_KEY: 'fixture' } })
      expect(result).toMatchObject({ ok: true, authentication: 'unverified' })
      expect(spawn.mock.calls[0][0].credentialEnv).toEqual({ PROFILE: 'chosen', API_KEY: 'fixture' })
      expect(child.requests.every((request) => ['initialize', 'initialized', 'account/read', 'get_state']
        .includes(String(request.method ?? request.type)))).toBe(true)
      expect(child.stop).toHaveBeenCalledOnce()
    })
    it('bounds a launcher that never resolves', async () => {
      spawn.mockImplementation(() => new Promise(() => {}))
      expect((await probe(def, 'fixture', { timeoutMs: 20 })).ok).toBe(false)
    })
  })
}
describe('Codex account evidence', () => {
  it.each([
    [{ account: { type: 'chatgpt', email: 'private@example.test', planType: 'plus' }, requiresOpenaiAuth: true }, 'verified', false],
    [{ account: { type: 'apiKey' }, requiresOpenaiAuth: true }, 'unverified', false],
    [{ account: null, requiresOpenaiAuth: true }, 'missing', true],
    [{ account: null, requiresOpenaiAuth: false }, 'unverified', false]
  ] as const)('classifies account/read result %j', async (account, authentication, authRequired) => {
    spawn.mockResolvedValue(fixture({ account }).process)
    const result = await probeCodexHandshake(catalog.get('codex')!, 'fixture')
    expect(result).toMatchObject({ ok: true, authentication, authRequired })
    expect(result.detail).not.toContain('private@example.test')
  })
  it('keeps unsupported account/read unverified', async () => {
    spawn.mockResolvedValue(fixture({ accountError: true }).process)
    expect(await probeCodexHandshake(catalog.get('codex')!, 'fixture'))
      .toMatchObject({ ok: true, authentication: 'unverified' })
  })
})


describe('Pi available model metadata', () => {
  it('returns deduplicated provider/model ids only for complete entries', async () => {
    const child = fixture({ models: [{ provider: 'openai', id: 'model-a' }, { provider: 'openai', id: 'model-a' },
      { provider: 'anthropic', id: 'model-b' }, { id: 'missing-provider' }, { provider: 'missing-id' }, null] })
    spawn.mockResolvedValue(child.process)
    expect(await probePiHandshake(catalog.get('pi')!, 'fixture', { includeModels: true }))
      .toMatchObject({ ok: true, models: ['openai/model-a', 'anthropic/model-b'] })
    expect(child.requests.map((request) => request.type)).toEqual(['get_state', 'get_available_models'])
    expect(child.stop).toHaveBeenCalledOnce()
  })
  it('does not pass a rejected model catalog request', async () => {
    const child = fixture({ modelError: true })
    spawn.mockResolvedValue(child.process)
    expect(await probePiHandshake(catalog.get('pi')!, 'fixture', { includeModels: true }))
      .toMatchObject({ ok: false, detail: expect.stringContaining('get_available_models failed') })
    expect(child.stop).toHaveBeenCalledOnce()
  })
  it('bounds and closes a stalled model catalog request', async () => {
    const child = fixture({ modelHang: true })
    spawn.mockResolvedValue(child.process)
    expect(await probePiHandshake(catalog.get('pi')!, 'fixture', { includeModels: true, timeoutMs: 20 }))
      .toMatchObject({ ok: false, detail: expect.stringContaining('get_available_models failed') })
    expect(child.stop).toHaveBeenCalledOnce()
  })
})


describe('ACP session model metadata', () => {
  it('reads modern model selectors and never treats session creation as authentication', async () => {
    const child = fixture({ session: { sessionId: 'fixture', configOptions: [{
      id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'model-a',
      options: [{ value: 'model-a', name: 'A' }, { value: 'model-b', name: 'B' }]
    }], models: { availableModels: [{ modelId: 'old-alias' }] } } })
    spawn.mockResolvedValue(child.process)
    expect(await probeAcpHandshake(catalog.get('opencode')!, 'fixture', { includeModels: true }))
      .toMatchObject({ ok: true, models: ['model-a', 'model-b'], authentication: 'unverified' })
    expect(child.requests.map((request) => request.method)).toEqual(['initialize', 'session/new'])
    expect(child.requests[1].params).toEqual({ cwd: expect.any(String), mcpServers: [] })
    expect(child.stop).toHaveBeenCalledOnce()
  })
  it('supports legacy model lists and represents an empty catalog explicitly', async () => {
    for (const models of [{ availableModels: [{ modelId: 'legacy-model' }] }, {}]) {
      spawn.mockResolvedValue(fixture({ session: { sessionId: 'fixture', models } }).process)
      expect(await probeAcpHandshake(catalog.get('opencode')!, 'fixture', { includeModels: true }))
        .toMatchObject({ ok: true, models: 'availableModels' in models ? ['legacy-model'] : [] })
    }
  })
  it.each([{ sessionError: true }, { session: { models: {} } }, { sessionHang: true }])(
    'fails closed and stops the process for rejected, malformed or stalled session metadata %j', async (options) => {
      const child = fixture(options)
      spawn.mockResolvedValue(child.process)
      expect(await probeAcpHandshake(catalog.get('opencode')!, 'fixture', { includeModels: true, timeoutMs: 20 }))
        .toMatchObject({ ok: false })
      expect(child.stop).toHaveBeenCalledOnce()
    })
})

describe('ACP launch configuration readiness', () => {
  it('checks session setup even for the default model without sending a prompt', async () => {
    const child = fixture()
    spawn.mockResolvedValue(child.process)
    expect(await probeAcpHandshake(catalog.get('opencode')!, 'fixture', { session: {} })).toMatchObject({ ok: true })
    expect(child.requests.map((request) => request.method)).toEqual(['initialize', 'session/new'])
    const workspace = (child.requests[1].params as { cwd: string }).cwd
    expect(workspace).toContain('kun-acp-readiness-')
    expect(existsSync(workspace)).toBe(false)
    expect(child.stop).toHaveBeenCalledOnce()
  })
  it('does not declare readiness when initialization succeeds but session creation fails', async () => {
    spawn.mockResolvedValue(fixture({ sessionError: true }).process)
    expect(await probeAcpHandshake(catalog.get('opencode')!, 'fixture', { session: {} }))
      .toMatchObject({ ok: false, detail: expect.stringContaining('metadata unavailable') })
  })
  it('rejects an unsupported Devin permission mode during readiness', async () => {
    const child = fixture({ session: { sessionId: 'fixture', modes: { currentModeId: 'ask',
      availableModes: [{ id: 'ask', name: 'Ask' }] } } })
    spawn.mockResolvedValue(child.process)
    expect(await probeAcpHandshake(catalog.get('devin')!, 'fixture', { session: { permissionMode: 'bypass' } }))
      .toMatchObject({ ok: false, detail: expect.stringContaining('permission mode') })
    expect(child.requests.some((request) => request.method === 'session/prompt')).toBe(false)
  })
})

describe('Codex explicit model metadata', () => {
  it('returns the native model catalog without creating a thread or turn', async () => {
    const child = fixture({ models: [{ id: 'native-model', model: 'native-model', displayName: 'Native',
      description: 'Fixture', supportedReasoningEfforts: [], defaultReasoningEffort: 'medium', isDefault: true, hidden: false }] })
    spawn.mockResolvedValue(child.process)
    expect(await probeCodexHandshake(catalog.get('codex')!, 'fixture', { includeModels: true }))
      .toMatchObject({ ok: true, models: ['native-model'] })
    expect(child.requests.map((request) => request.method)).toEqual(['initialize', 'initialized', 'account/read', 'model/list'])
    expect(child.stop).toHaveBeenCalledOnce()
  })
  it.each(['modelError', 'modelHang'] as const)('fails closed and cleans up on %s', async (failure) => {
    const child = fixture({ [failure]: true })
    spawn.mockResolvedValue(child.process)
    expect((await probeCodexHandshake(catalog.get('codex')!, 'fixture', { includeModels: true, timeoutMs: 30 })).ok).toBe(false)
    expect(child.stop).toHaveBeenCalledOnce()
  })
})

/** An engine whose session/new hides its cause; the clean-configuration retry is recognised by its env. */
function hiddenFailureFixture(isolated: 'passes' | 'fails', data: Record<string, unknown> = {}) {
  const spawns: Array<Record<string, string> | undefined> = []
  const stops: Array<ReturnType<typeof vi.fn>> = []
  spawn.mockImplementation(async (input) => {
    const env = (input as { env?: Record<string, string> }).env
    spawns.push(env)
    const clean = Boolean(env?.OPENCODE_CONFIG_DIR)
    const stdin = new PassThrough(), stdout = new PassThrough()
    const stop = vi.fn(async () => { stdout.end() })
    stops.push(stop)
    stdin.on('data', (chunk: Buffer) => {
      const request = JSON.parse(chunk.toString())
      if (request.id === undefined) return
      const response = request.method === 'session/new'
        ? clean && isolated === 'passes'
          ? { id: request.id, result: { sessionId: 'clean' } }
          : { id: request.id, error: { code: -32603, message: 'Internal error: Internal service failure', data } }
        : { id: request.id, result: { protocolVersion: 1, agentCapabilities: {} } }
      queueMicrotask(() => stdout.write(JSON.stringify(response) + '\n'))
    })
    return { stdin, stdout, exit: new Promise(() => undefined), stop, sanitizedStderrTail: () => '' } as unknown as HarnessProcess
  })
  return { spawns, stops }
}

describe('hidden engine failures', () => {
  const dirs: string[] = []
  afterEach(async () => {
    vi.unstubAllEnvs()
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
  })
  it.each(['passes', 'fails'] as const)('explains an OpenCode2 "Internal service failure" from its log and a clean-configuration retry that %s', async (isolated) => {
    const data = await mkdtemp(join(tmpdir(), 'kun-oc2-data-')); dirs.push(data)
    await mkdir(join(data, 'opencode', 'log'), { recursive: true })
    const stamp = new Date().toISOString()
    await writeFile(join(data, 'opencode', 'log', 'opencode.log'), [
      `timestamp=${stamp} level=INFO run=a message="cli starting"`,
      `timestamp=${stamp} level=WARN run=a message="failed to load plugin" target=oh-my-openagent cause="Cause([Fail(SchemaError(Missing key))])"`,
      `timestamp=${stamp} level=INFO run=a message="Sent HTTP response" http.method=GET http.url=/api/model http.status=503`
    ].join('\n') + '\n')
    vi.stubEnv('XDG_DATA_HOME', data)
    const { spawns, stops } = hiddenFailureFixture(isolated)
    const result = await probeAcpHandshake(catalog.get('opencode2')!, 'fixture', { session: {} })
    expect(result).toMatchObject({ ok: false, supported: true })
    expect(result.authRequired).toBeUndefined()
    expect(result.detail).toContain('OpenCode2 failed inside its own service during session/new')
    expect(result.detail).toContain(isolated === 'passes' ? 'works with a clean configuration' : 'fails even with a clean configuration')
    expect(result.detail).toContain('Its log says: WARN failed to load plugin oh-my-openagent: Cause([Fail(SchemaError(Missing key))]); GET /api/model -> 503')
    expect(spawns).toHaveLength(2)
    expect(spawns[0]).not.toHaveProperty('OPENCODE_CONFIG_DIR')
    expect(spawns[1]).toMatchObject({ OPENCODE_CONFIG_CONTENT: '{}', XDG_CONFIG_HOME: expect.stringContaining('kun-acp-isolated-') })
    expect(spawns[1]!.OPENCODE_CONFIG_DIR).toBe(spawns[1]!.XDG_CONFIG_HOME)
    expect(existsSync(spawns[1]!.XDG_CONFIG_HOME!)).toBe(false)
    for (const stop of stops) expect(stop).toHaveBeenCalledOnce()
  })
  it('names the failing step and keeps JSON-RPC error data for other engines, without a retry', async () => {
    const { spawns, stops } = hiddenFailureFixture('passes', { service: 'session', errorName: 'SqliteError' })
    const result = await probeAcpHandshake(catalog.get('droid')!, 'fixture', { session: {} })
    expect(result).toMatchObject({ ok: false,
      detail: 'session/new failed: Internal error: Internal service failure (data: {"service":"session","errorName":"SqliteError"})' })
    expect(spawns).toHaveLength(1)
    expect(stops[0]).toHaveBeenCalledOnce()
  })
})
