import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentSdkModelProbe } from './agent-sdk-model-probe.js'
import type { HarnessDefinition } from '../contracts/harness.js'
import type { SdkApi, SdkQueryResult } from '../runtime/agent-sdk/sdk-protocol.js'

const definition = {
  id: 'claude-code',
  transport: 'agent-sdk',
  modelSource: 'probe',
  staticModels: ['claude-fallback-1']
} as unknown as HarnessDefinition

function fakeSdk(
  query: (input: unknown) => Partial<SdkQueryResult>
): () => Promise<SdkApi> {
  return async () => ({ query } as unknown as SdkApi)
}

const MODEL_ROWS = [
  { value: 'default', resolvedModel: 'claude-sonnet-5' },
  { value: 'sonnet', resolvedModel: 'claude-sonnet-5' },
  { value: 'opus', resolvedModel: 'claude-opus-5' },
  { value: 'claude-fable-5-1[1m]', resolvedModel: 'claude-fable-5-1' }
]

describe('AgentSdkModelProbe', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('uses the native startup proxy environment without ambient runtime or provider credentials', async () => {
    vi.stubEnv('HTTPS_PROXY', 'http://proxy.invalid:8080')
    vi.stubEnv('https_proxy', 'http://lower.invalid:8081')
    vi.stubEnv('NO_PROXY', 'private.test')
    vi.stubEnv('KUN_RUNTIME_TOKEN', 'runtime-secret')
    vi.stubEnv('ANTHROPIC_API_KEY', 'wrong-provider-key')
    vi.stubEnv('DEEPSEEK_API_KEY', 'unrelated-key')
    const query = vi.fn((_input: unknown) => ({ supportedModels: async () => MODEL_ROWS, close: vi.fn() }))
    const probe = new AgentSdkModelProbe({ loadSdk: fakeSdk(query) })
    await probe.probe(definition)
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({
      env: expect.objectContaining({ HTTPS_PROXY: 'http://proxy.invalid:8080',
        https_proxy: 'http://lower.invalid:8081', NO_PROXY: 'private.test' })
    }) }))
    const env = (query.mock.calls[0]?.[0] as unknown as { options: { env: Record<string, string> } }).options.env
    expect(env.KUN_RUNTIME_TOKEN).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.DEEPSEEK_API_KEY).toBeUndefined()
  })

  it('returns canonical model ids from supportedModels()', async () => {
    const close = vi.fn()
    const probe = new AgentSdkModelProbe({
      loadSdk: fakeSdk(() => ({
        supportedModels: async () => MODEL_ROWS,
        close
      })),
      nowMs: () => 1_000
    })
    const models = await probe.probe(definition)
    expect(models).toEqual(['claude-fable-5-1', 'claude-opus-5', 'claude-sonnet-5'])
    expect(close).toHaveBeenCalled()
  })

  it('falls back to value when resolvedModel is absent', async () => {
    const probe = new AgentSdkModelProbe({
      loadSdk: fakeSdk(() => ({
        supportedModels: async () => [{ value: 'custom-model' }],
        close: () => undefined
      }))
    })
    expect(await probe.probe(definition)).toEqual(['custom-model'])
  })

  it('returns [] when the SDK fails to load or spawn', async () => {
    const probe = new AgentSdkModelProbe({
      loadSdk: async () => {
        throw new Error('sdk missing')
      }
    })
    expect(await probe.probe(definition)).toEqual([])
    const spawnFail = new AgentSdkModelProbe({
      loadSdk: fakeSdk(() => {
        throw new Error('spawn ENOENT')
      })
    })
    expect(await spawnFail.probe(definition)).toEqual([])
  })

  it('times out a hung supportedModels() and closes the query', async () => {
    const close = vi.fn()
    const probe = new AgentSdkModelProbe({
      loadSdk: fakeSdk(() => ({
        supportedModels: () => new Promise<never>(() => {}),
        close
      })),
      timeoutMs: 50
    })
    expect(await probe.probe(definition)).toEqual([])
    expect(close).toHaveBeenCalled()
  })

  it('caches results and shares in-flight probes', async () => {
    let calls = 0
    let now = 1_000
    const probe = new AgentSdkModelProbe({
      loadSdk: fakeSdk(() => ({
        supportedModels: async () => {
          calls += 1
          return MODEL_ROWS
        },
        close: () => undefined
      })),
      nowMs: () => now
    })
    const [a, b] = await Promise.all([probe.probe(definition), probe.probe(definition)])
    expect(a).toEqual(b)
    expect(calls).toBe(1)
    await probe.probe(definition)
    expect(calls).toBe(1)
    now += 11 * 60 * 1_000
    await probe.probe(definition)
    expect(calls).toBe(2)
  })

  it('peek reads the cache without spawning', async () => {
    let calls = 0
    const probe = new AgentSdkModelProbe({
      loadSdk: fakeSdk(() => ({
        supportedModels: async () => {
          calls += 1
          return MODEL_ROWS
        },
        close: () => undefined
      })),
      nowMs: () => 1_000
    })
    expect(probe.peek(definition)).toBeUndefined()
    await probe.probe(definition)
    expect(probe.peek(definition)).toEqual([
      'claude-fable-5-1',
      'claude-opus-5',
      'claude-sonnet-5'
    ])
    expect(calls).toBe(1)
  })

  it('caches a failed probe briefly and retries after expiry', async () => {
    let calls = 0
    let now = 0
    const probe = new AgentSdkModelProbe({
      loadSdk: fakeSdk(() => ({
        supportedModels: async () => {
          calls += 1
          if (calls === 1) throw new Error('init failed')
          return [{ value: 'ok' }]
        },
        close: () => undefined
      })),
      nowMs: () => now
    })
    expect(await probe.probe(definition)).toEqual([])
    now += 5_000
    expect(await probe.probe(definition)).toEqual([])
    expect(calls).toBe(1)
    now += 30_000
    expect(await probe.probe(definition)).toEqual(['ok'])
    expect(calls).toBe(2)
  })
})

it('uses the selected native OAuth profile for prompt-free account evidence', async () => {
  const close = vi.fn()
  const accountInfo = vi.fn(async () => ({ apiProvider: 'firstParty', email: 'local@example.invalid', subscriptionType: 'max' }))
  const query = vi.fn((_input: unknown) => ({ supportedModels: async () => MODEL_ROWS, accountInfo, close }))
  const probe = new AgentSdkModelProbe({ loadSdk: fakeSdk(query) })
  const result = await probe.probeReadiness(definition, { CLAUDE_CODE_OAUTH_TOKEN: 'selected-local-profile' }, new AbortController().signal)
  expect(result.authentication).toBe('verified')
  expect(result).not.toHaveProperty('email')
  expect(query).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({
    env: expect.objectContaining({ CLAUDE_CODE_OAUTH_TOKEN: 'selected-local-profile' })
  }) }))
  const input = query.mock.calls[0]![0] as { prompt: AsyncIterable<unknown> }
  const prompts = []
  for await (const value of input.prompt) prompts.push(value)
  expect(prompts).toEqual([])
  expect(close).toHaveBeenCalled()
})

it('does not classify API-key presence or an empty account reply as native OAuth verification', async () => {
  for (const account of [{ apiProvider: 'firstParty', apiKeySource: 'env' }, {}]) {
    const probe = new AgentSdkModelProbe({ loadSdk: fakeSdk(() => ({
      supportedModels: async () => MODEL_ROWS, accountInfo: async () => account, close: vi.fn()
    })) })
    expect((await probe.probeReadiness(definition, {}, new AbortController().signal)).authentication).toBe('unverified')
  }
})

it('bounds account metadata checks and closes the query on cancellation', async () => {
  const close = vi.fn()
  const probe = new AgentSdkModelProbe({ loadSdk: fakeSdk(() => ({
    supportedModels: async () => MODEL_ROWS, accountInfo: async () => new Promise(() => {}), close
  })), timeoutMs: 20 })
  await expect(probe.probeReadiness(definition, {}, new AbortController().signal)).rejects.toThrow()
  expect(close).toHaveBeenCalled()
})


it('refreshes the catalog after an in-place CLI update even while an old probe is pending', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kun-model-upgrade-'))
  try {
    const path = join(dir, 'claude'); await writeFile(path, 'old binary')
    let finish!: (value: { value: string }[]) => void
    const supportedModels = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
      .mockResolvedValue([{ value: 'new-model' }])
    const probe = new AgentSdkModelProbe({ binaryPath: () => path, loadSdk: fakeSdk(() => ({ supportedModels, close: vi.fn() })) })
    const old = probe.probe(definition)
    await vi.waitFor(() => expect(finish).toBeDefined())
    await writeFile(path, 'upgraded binary')
    probe.invalidate()
    expect(await probe.probe(definition)).toEqual(['new-model'])
    finish([{ value: 'old-model' }]); await old
    expect(probe.peek(definition)).toEqual(['new-model'])
    expect(supportedModels).toHaveBeenCalledTimes(2)
    await writeFile(path, 'newer in-place binary')
    expect(probe.peek(definition)).toBeUndefined()
    expect(await probe.probe(definition)).toEqual(['new-model'])
    expect(supportedModels).toHaveBeenCalledTimes(3)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
