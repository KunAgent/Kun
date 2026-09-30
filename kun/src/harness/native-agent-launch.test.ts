import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PassThrough } from 'node:stream'
import { HarnessCatalog } from './harness-catalog.js'
import { probeCodexReadiness } from './codex-readiness-probe.js'
import { probeCodexHandshake } from './codex-handshake-probe.js'
import { CodexModelProbe } from './codex-model-probe.js'
import { CodexAgent } from '../runtime/codex/codex-agent.js'
import { startHarnessProcess } from '../session/harness-process.js'
import type { HarnessAgentConnectInput } from '../session/harness-session.js'
import { createAgentSdkLifecycleRuntimeDeps } from '../runtime/agent-sdk/agent-sdk-runtime-factory-lifecycle.js'
import type { AgentSdkRuntimeFactoryDeps } from '../runtime/agent-sdk/agent-sdk-runtime-factory-contracts.js'
import type { AgentSdkFactoryContext } from '../runtime/agent-sdk/agent-sdk-runtime-factory-context.js'
import type { SdkApi } from '../runtime/agent-sdk/sdk-protocol.js'

vi.mock('../session/harness-process.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../session/harness-process.js')>(), startHarnessProcess: vi.fn()
}))

const catalog = () => new HarnessCatalog({ custom: () => [], nativeAgentNetwork: () => ({
  codex: { source: 'system', proxyUrl: 'http://fixture.invalid:8080/' },
  'claude-code': { source: 'system', proxyUrl: 'http://fixture.invalid:8080/' }
}) })

function protocolFixture(): ReturnType<typeof startHarnessProcess> {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  let exit!: () => void
  const exited = new Promise<{ code: number; signal: null }>((resolve) => {
    exit = () => resolve({ code: 0, signal: null })
  })
  stdin.on('data', (data: Buffer) => {
    const request = JSON.parse(data.toString())
    if (request.id === undefined) return
    const result = request.method === 'account/read'
      ? { account: null, requiresOpenaiAuth: false }
      : request.method === 'model/list'
        ? { data: [{ id: 'fixture', model: 'fixture', displayName: 'Fixture', description: '',
          inputModalities: ['text', 'image'], supportedReasoningEfforts: [], defaultReasoningEffort: 'medium', isDefault: true, hidden: false }] }
        : { userAgent: 'fixture', codexHome: '/fixture', platformFamily: 'unix', platformOs: 'linux' }
    queueMicrotask(() => stdout.write(JSON.stringify({ id: request.id, result }) + '\n'))
  })
  return Promise.resolve({ stdin, stdout, exit: exited, sanitizedStderrTail: () => '',
    stop: async () => { stdout.end(); exit() } } as unknown as Awaited<ReturnType<typeof startHarnessProcess>>)
}

beforeEach(() => {
  vi.mocked(startHarnessProcess).mockReset().mockImplementation(protocolFixture)
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) vi.stubEnv(key, undefined)
})
afterEach(() => vi.unstubAllEnvs())

describe('native launch network parity without paid requests', () => {
  it('uses the same network in Codex readiness, handshake, model discovery, and actual pooled launch', async () => {
    const definition = catalog().get('codex')!
    expect((await probeCodexReadiness(definition, '/fixture/codex')).ready).toBe('yes')
    expect((await probeCodexHandshake(definition, '/fixture/codex')).ok).toBe(true)
    const models = new CodexModelProbe({ binaryPath: () => '/fixture/codex' })
    expect(await models.probe(definition)).toEqual(['fixture'])
    expect(await models.probeCatalog(definition)).toMatchObject({ modelInfo: [{ id: 'fixture',
      inputModalities: ['text', 'image'], isDefault: true }] })
    const agent = await CodexAgent.connect({ definition: { ...definition }, command: '/fixture/codex',
      args: ['app-server'], env: {}, secretEnv: {}, credentialEnv: {}, stripEnv: []
    } as unknown as HarnessAgentConnectInput)
    await agent.close()
    expect(startHarnessProcess).toHaveBeenCalledTimes(4)
    for (const [input] of vi.mocked(startHarnessProcess).mock.calls) {
      expect(input.env).toMatchObject({ HTTPS_PROXY: 'http://fixture.invalid:8080/',
        NO_PROXY: expect.stringContaining('127.0.0.1') })
    }
  })

  it('keeps Claude actual startup aligned with model discovery while gateway bypasses upstream policy', () => {
    vi.stubEnv('KUN_RUNTIME_TOKEN', 'do-not-inherit')
    const deps = createAgentSdkLifecycleRuntimeDeps({ harnessCatalog: catalog() } as unknown as AgentSdkRuntimeFactoryDeps,
      {} as AgentSdkFactoryContext, async () => ({} as SdkApi))
    expect(deps.baseEnv()).toMatchObject({ HTTPS_PROXY: 'http://fixture.invalid:8080/' })
    expect(deps.baseEnv().KUN_RUNTIME_TOKEN).toBeUndefined()
    expect(deps.baseEnv({ gateway: true }).HTTPS_PROXY).toBeUndefined()
  })
})
