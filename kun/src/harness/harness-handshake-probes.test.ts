import { PassThrough } from 'node:stream'
import { existsSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
function fixture(options: { silent?: boolean; account?: unknown; accountError?: boolean; models?: unknown[]; modelError?: boolean; modelHang?: boolean; session?: unknown; sessionError?: boolean; authRequired?: boolean; sessionHang?: boolean } = {}) {
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
            message: options.authRequired ? 'Authentication required' : 'metadata unavailable' } }
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
