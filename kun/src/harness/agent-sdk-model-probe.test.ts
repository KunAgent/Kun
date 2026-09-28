import { describe, expect, it, vi } from 'vitest'
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
