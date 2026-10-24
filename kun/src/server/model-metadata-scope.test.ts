import { getProviderCatalogPreset, providerPresetScopeMatches } from '@kun/provider-catalog'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeHarness } from '../../tests/loop-test-harness.js'
import { metadataEvidence, capabilityFieldKnown } from '../contracts/model-metadata-evidence.js'
import { modelCapabilitiesForModel, modelCapabilitiesForProviderModel, modelContextProfilesFromConfig,
  modelContextProfilesForProvider, DEFAULT_CONTEXT_WINDOW_TOKENS } from '../loop/model-context-profile.js'
import { providerScopedModelCapabilities, modelContextProfilesByProvider } from './runtime-factory-model.js'
import { mergeModelContextProfiles } from '../loop/model-context-profile-merge.js'
import { createRuntimeCore } from './runtime-composition-core.js'
import type { KunServeRuntimeOptions } from './runtime-factory-types.js'
import type { ModelClient, ModelRequest } from '../ports/model-client.js'
import { ModelConnectionRegistry } from '../services/model-connection-registry.js'
import { ExtensionCredentialStore } from '../services/extension-credential-store.js'
import { writeModelCatalog } from '../services/model-catalog-store.js'
import { catalogBinding } from '../services/provider-catalog-operations.js'
import { withModelObservation, setModelMetadataOverride } from '../services/model-metadata-resolver.js'
import { resolveRegistryProfileMetadata } from '../services/registry-model-metadata.js'

const relay = { providerId: 'relay', baseUrl: 'https://relay.example/v1', kind: 'http' as const }

describe('provider-scoped model facts', () => {
  it('proves preset product, region and native transport scope independently of listing support', () => {
    expect(providerPresetScopeMatches({ id: 'openai-api', baseUrl: 'https://api.openai.com/v1', endpointFormat: 'responses' })).toBe(true)
    expect(providerPresetScopeMatches({ id: 'openai-api', baseUrl: 'https://relay.example/v1' })).toBe(false)
    const aliyun = getProviderCatalogPreset('aliyun')!
    expect(providerPresetScopeMatches({ id: 'aliyun-token-plan', baseUrl: aliyun.tokenPlan!.baseUrl })).toBe(true)
    expect(providerPresetScopeMatches({ id: 'aliyun-token-plan', baseUrl: aliyun.baseUrl })).toBe(false)
    expect(providerPresetScopeMatches({ id: 'cursor-subscription', kind: 'cursor-sdk', baseUrl: '' })).toBe(true)
    expect(providerPresetScopeMatches({ id: 'cursor-subscription', kind: 'http', baseUrl: '' })).toBe(false)
    expect(providerPresetScopeMatches({ id: 'deepseek', baseUrl: 'https://api.deepseek.com/beta' })).toBe(true)
    expect(providerPresetScopeMatches({ id: 'deepseek', baseUrl: 'https://api.deepseek.com.attacker.test/beta' })).toBe(false)
  })
  it.each(['gpt-5.5', 'relay/gpt-5.5', 'deepseek-v4-pro', 'glm-5.2'])('keeps %s unknown on an unproven relay', (model) => {
    const value = modelCapabilitiesForProviderModel({ ...relay, model })
    expect(value.contextWindowTokens).toBe(DEFAULT_CONTEXT_WINDOW_TOKENS)
    expect(capabilityFieldKnown(value, 'contextWindowTokens')).toBe(false)
    expect(value.reasoning).toBeUndefined()
  })
  it('requires the real endpoint even if an edited connection retains a preset name', () => {
    const value = modelCapabilitiesForProviderModel({ ...relay, providerId: 'codex', presetSource: 'codex', model: 'gpt-5.5' })
    expect(value.contextWindowTokens).toBe(DEFAULT_CONTEXT_WINDOW_TOKENS)
    expect(value.serviceTiers).toBeUndefined()
    expect(modelCapabilitiesForProviderModel({ ...relay, providerId: 'kimi-code', presetSource: 'kimi-code', model: 'k3' }).reasoning).toBeUndefined()
  })
  it('does not trust a vendor base when an alternate model protocol points to a relay', () => {
    const value = modelCapabilitiesForProviderModel({ providerId: 'openai-api', baseUrl: 'https://api.openai.com/v1',
      endpoints: { responses: 'https://relay.example/responses' }, model: 'gpt-5.5' })
    expect(value.contextWindowTokens).toBe(DEFAULT_CONTEXT_WINDOW_TOKENS)
    expect(capabilityFieldKnown(value, 'contextWindowTokens')).toBe(false)
  })
  it('retains maintained capabilities on the vendor and plan endpoints', () => {
    expect(modelCapabilitiesForProviderModel({ providerId: 'codex', baseUrl: 'https://chatgpt.com/backend-api/codex/responses', model: 'gpt-5.5' }).contextWindowTokens).toBe(1_000_000)
    expect(modelCapabilitiesForProviderModel({ providerId: 'zhipu-coding-plan', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions', model: 'glm-5.2' }).contextWindowTokens).toBe(1_000_000)
    expect(modelCapabilitiesForProviderModel({ providerId: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro' }).contextWindowTokens).toBe(1_000_000)
  })
  it('retains explicit global and provider settings without inheriting unrelated built-in fields', () => {
    const global = modelContextProfilesFromConfig({ models: { profiles: { 'gpt-5.5': { contextWindowTokens: 64_000 } } } })
    const profiles = modelContextProfilesForProvider(relay, global)
    expect(modelCapabilitiesForModel('gpt-5.5', profiles)).toMatchObject({ contextWindowTokens: 64_000 })
    expect(modelCapabilitiesForModel('gpt-5.5', profiles).reasoning).toBeUndefined()
    const provider = { apiKey: '', baseUrl: relay.baseUrl, modelProfiles: {} }
    const primary = modelContextProfilesByProvider({ relay: provider }).get('relay')!
    expect(modelCapabilitiesForModel('gpt-5.5', mergeModelContextProfiles(primary, profiles)).contextWindowTokens).toBe(64_000)
    expect(providerScopedModelCapabilities('relay', provider, (model) => modelCapabilitiesForModel(model))('gpt-5.5').contextWindowTokens).toBe(DEFAULT_CONTEXT_WINDOW_TOKENS)
    expect(providerScopedModelCapabilities('relay', provider, (model) => modelCapabilitiesForModel(model, profiles))('gpt-5.5').contextWindowTokens).toBe(64_000)
  })
  it('does not apply generated preset observations after editing its endpoint, while keeping user overrides', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-preset-scope-'))
    try {
      const registry = new ModelConnectionRegistry({ dataDir, credentials: new ExtensionCredentialStore({ dataDir, profileId: 'test' }) })
      const original = { id: 'gpt-5.5', inputModalities: ['text'] as const, outputModalities: ['text'] as const,
        messageParts: ['text'] as const, supportsToolCalling: true, evidence: metadataEvidence({}, 'adapter') }
      let capability = withModelObservation(original, { id: 'preset', source: 'adapter', values: { contextWindowTokens: 1_000_000 }, match: 'exact' })
      capability = setModelMetadataOverride(capability, 'maxOutputTokens', 4096)
      const resolved = await resolveRegistryProfileMetadata(registry, { id: 'codex', accountId: 'a', name: 'Edited',
        kind: 'http', authType: 'none', baseUrl: relay.baseUrl, endpointFormat: 'chat_completions', useProxy: false, configured: true,
        presetSource: 'codex', models: ['gpt-5.5'], modelCapabilities: { 'gpt-5.5': { ...capability,
          inputModalities: [...capability.inputModalities], outputModalities: [...capability.outputModalities], messageParts: [...capability.messageParts] } } })
      expect(resolved.modelCapabilities!['gpt-5.5'].contextWindowTokens).toBeUndefined()
      expect(resolved.modelCapabilities!['gpt-5.5'].maxOutputTokens).toBe(4096)
    } finally { await rm(dataDir, { recursive: true, force: true }) }
  })

  it('hot-applies cached input limits into actual composition and loop guards while preserving a global user limit', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-runtime-metadata-scope-'))
    const options: KunServeRuntimeOptions = { host: '127.0.0.1', port: 0, dataDir, runtimeToken: 'test', apiKey: '',
      baseUrl: relay.baseUrl, model: 'gpt-5.5', activeProviderId: 'relay', approvalPolicy: 'on-request', sandboxMode: 'workspace-write',
      tokenEconomyMode: false, insecure: false, storage: { backend: 'file' },
      models: { profiles: { 'gpt-5.5': { contextWindowTokens: 128_000 } } },
      providers: { relay: { apiKey: '', authType: 'none', baseUrl: relay.baseUrl, models: ['gpt-5.5'] } } }
    const core = await createRuntimeCore(options, undefined)
    try {
      expect(core.modelCapabilities('gpt-5.5', 'relay').contextWindowTokens).toBe(128_000)
      const registry = new ModelConnectionRegistry({ dataDir, credentials: new ExtensionCredentialStore({ dataDir, profileId: 'test' }),
        modelCapabilities: core.registryModelCapabilities })
      await registry.initialize()
      await registry.connect({ expectedRevision: 0, id: 'relay', name: 'Relay', kind: 'http', authType: 'none', baseUrl: relay.baseUrl,
        endpointFormat: 'chat_completions', models: ['gpt-5.5'], selectedModel: 'gpt-5.5', probe: false, select: true })
      const binding = await catalogBinding(registry, 'relay')
      const values = { contextWindowTokens: 1_000_000, maxInputTokens: 96_000, maxOutputTokens: 8192 }
      await writeModelCatalog(dataDir, 'relay', { fetchedAt: new Date().toISOString(), identity: binding.identity,
        configurationRevision: binding.document.revision, source: 'provider', models: ['gpt-5.5'],
        modelProfiles: { 'gpt-5.5': { ...values, evidence: metadataEvidence(values, 'provider') } } })
      const materialized = await registry.materializeReadOnly()
      core.activeOptions = { ...core.activeOptions, providers: Object.fromEntries(materialized.providers) }
      expect(core.modelCapabilities('gpt-5.5', 'relay')).toMatchObject({ contextWindowTokens: 128_000, maxInputTokens: 96_000 })
      expect(core.compactor.thresholds('gpt-5.5', 'relay')).toEqual({ softThreshold: 72_000, hardThreshold: 81_600 })
      const seen: ModelRequest[] = []
      const client: ModelClient = { provider: 'fixture', model: 'gpt-5.5', async *stream(request) { seen.push(request); yield { kind: 'completed', stopReason: 'stop' } } }
      const h = makeHarness(client, { tools: [], compactor: core.compactor, modelCapabilities: core.modelCapabilities,
        contextCompaction: { summaryMode: 'heuristic' } })
      const thread = await h.threads.create({ model: 'gpt-5.5', providerId: 'relay', mode: 'agent', workspace: '/tmp', title: 'Scoped input' })
      const turn = await h.turns.startTurn({ threadId: thread.id, request: { providerId: 'relay', model: 'gpt-5.5', prompt: 'x'.repeat(400_000) } })
      expect(await h.loop.runTurn(thread.id, turn.turnId)).toBe('failed')
      expect(seen).toHaveLength(0)
      expect(h.bus.snapshotSince(thread.id, 0)).toContainEqual(expect.objectContaining({ kind: 'error',
        code: 'context_window_exceeded', message: expect.stringContaining('96000-token maximum input') }))
    } finally { await core.stores.shutdown?.(); await rm(dataDir, { recursive: true, force: true }) }
  }, 30_000)
})
