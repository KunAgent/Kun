import { describe, expect, it } from 'vitest'
import type { HarnessDefinition, HarnessId } from '../contracts/harness.js'
import { BUILTIN_HARNESSES } from '../harness/builtin-harnesses.js'
import { resolveWorkerRoute, type WorkerProviderPoolEntry } from './worker-route.js'

const catalog = {
  get: (id: string) => BUILTIN_HARNESSES.find((def) => def.id === id)
}

const POOL: Record<string, WorkerProviderPoolEntry> = {
  deepseek: { kind: 'http', models: ['deepseek-chat', 'deepseek-reasoner'] },
  'cursor-prov': { kind: 'cursor-sdk', models: ['composer-2'] },
  empty: { kind: 'http', models: [] }
}
const providerPool = async (providerId: string) => POOL[providerId]

describe('resolveWorkerRoute', () => {
  it('accepts a kun/<provider>/<model> route for kun-gateway and normalizes it', async () => {
    const resolved = await resolveWorkerRoute({
      catalog: catalog as never,
      providerPool,
      agent: {
        harnessId: 'claude-code',
        credentialMode: 'kun-gateway',
        model: 'kun/deepseek/deepseek-chat'
      }
    })
    expect('error' in resolved).toBe(false)
    if ('error' in resolved) return
    expect(resolved.route).toEqual({
      harnessId: 'claude-code',
      credentialMode: 'kun-gateway',
      providerId: 'deepseek',
      model: 'kun/deepseek/deepseek-chat'
    })
  })

  it('accepts a bare model + providerId in kun-gateway mode', async () => {
    const resolved = await resolveWorkerRoute({
      catalog: catalog as never,
      providerPool,
      agent: {
        harnessId: 'claude-code',
        credentialMode: 'kun-gateway',
        providerId: 'deepseek',
        model: 'deepseek-reasoner'
      }
    })
    expect('error' in resolved).toBe(false)
    if ('error' in resolved) return
    expect(resolved.route.model).toBe('kun/deepseek/deepseek-reasoner')
    expect(resolved.route.providerId).toBe('deepseek')
  })

  it('rejects an unknown gateway provider with a readable reason', async () => {
    const resolved = await resolveWorkerRoute({
      catalog: catalog as never,
      providerPool,
      agent: {
        harnessId: 'claude-code',
        credentialMode: 'kun-gateway',
        model: 'kun/ghost/some-model'
      }
    })
    expect(resolved).toMatchObject({ error: expect.stringContaining('"ghost"') })
    if ('error' in resolved) expect(resolved.error).toContain('not a configured')
  })

  it('rejects a model the resolved provider does not offer', async () => {
    const resolved = await resolveWorkerRoute({
      catalog: catalog as never,
      providerPool,
      agent: {
        harnessId: 'claude-code',
        credentialMode: 'kun-gateway',
        model: 'kun/deepseek/claude-sonnet-5'
      }
    })
    expect(resolved).toMatchObject({
      error: expect.stringContaining('does not offer model "claude-sonnet-5"')
    })
  })

  it('accepts a probed model absent from the static list for probe harnesses', async () => {
    const resolved = await resolveWorkerRoute({
      catalog: catalog as never,
      probedModels: (def: HarnessDefinition) =>
        def.id === 'gemini-cli' ? ['gemini-3-pro-preview'] : undefined,
      agent: { harnessId: 'gemini-cli', model: 'gemini-3-pro-preview' }
    })
    expect('error' in resolved).toBe(false)
    if ('error' in resolved) return
    expect(resolved.route).toMatchObject({
      harnessId: 'gemini-cli',
      credentialMode: 'native-login',
      model: 'gemini-3-pro-preview'
    })
  })

  it('rejects a model outside the probe result for probe harnesses', async () => {
    const resolved = await resolveWorkerRoute({
      catalog: catalog as never,
      probedModels: () => ['gemini-3-pro-preview'],
      agent: { harnessId: 'gemini-cli', model: 'made-up-model' }
    })
    expect(resolved).toMatchObject({ error: expect.stringContaining('made-up-model') })
  })

  it('falls back to the static list when no probe result is cached', async () => {
    const rejected = await resolveWorkerRoute({
      catalog: catalog as never,
      probedModels: () => undefined,
      agent: { harnessId: 'claude-code', model: 'not-a-model' }
    })
    expect(rejected).toMatchObject({ error: expect.stringContaining('not-a-model') })
    const accepted = await resolveWorkerRoute({
      catalog: catalog as never,
      probedModels: () => undefined,
      agent: { harnessId: 'claude-code', model: 'claude-haiku-4-5-20251001' }
    })
    expect('error' in accepted).toBe(false)
    if ('error' in accepted) return
    expect(accepted.route.credentialMode).toBe('native-login')
  })

  it('uses the manager provider/model for provider-mode harnesses without a pin', async () => {
    const resolved = await resolveWorkerRoute({
      catalog: catalog as never,
      managerModel: 'deepseek-chat',
      managerProviderId: 'deepseek',
      providerPool,
      agent: { harnessId: 'kun' }
    })
    expect('error' in resolved).toBe(false)
    if ('error' in resolved) return
    expect(resolved.route).toEqual({
      harnessId: 'kun',
      credentialMode: 'provider',
      providerId: 'deepseek',
      model: 'deepseek-chat'
    })
  })

  it('rejects a provider connection kind the harness cannot serve', async () => {
    const resolved = await resolveWorkerRoute({
      catalog: catalog as never,
      providerPool,
      agent: {
        harnessId: 'cursor',
        credentialMode: 'provider',
        providerId: 'deepseek',
        model: 'deepseek-chat'
      }
    })
    expect(resolved).toMatchObject({
      error: expect.stringContaining('cannot serve harness cursor')
    })
  })

  it('keeps the manager fallback when no agent is pinned and no selector is wired', async () => {
    const resolved = await resolveWorkerRoute({
      catalog: catalog as never,
      managerModel: 'deepseek-chat',
      managerProviderId: 'deepseek'
    })
    expect('error' in resolved).toBe(false)
    if ('error' in resolved) return
    expect(resolved.route).toMatchObject({
      harnessId: 'kun' as HarnessId,
      credentialMode: 'provider',
      providerId: 'deepseek',
      model: 'deepseek-chat'
    })
  })

  it('rejects a credential mode the harness does not declare', async () => {
    const resolved = await resolveWorkerRoute({
      catalog: catalog as never,
      providerPool,
      agent: { harnessId: 'gemini-cli', credentialMode: 'kun-gateway', model: 'kun/deepseek/deepseek-chat' }
    })
    expect(resolved).toMatchObject({
      error: expect.stringContaining('credentialMode kun-gateway is not supported')
    })
  })
})
