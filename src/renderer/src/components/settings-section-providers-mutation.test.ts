import {
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultWriteSettings,
  type ModelProviderModelProfileV1
} from '@shared/app-settings'
import { describe, expect, it, vi } from 'vitest'
import type { SharedModelConnection } from './settings-section-providers-shared-api'
import {
  modelProviderDeletionKunPatch,
  modelProviderDeletionWritePatch
} from './settings-section-providers-profile'
import {
  clearPendingSharedProviderDeletionForExplicitAdd,
  createSharedModelMutationQueue,
  mergeProviderDraftForDisplay,
  projectSharedModelConnections,
  reconcilePendingSharedProviderCatalogs,
  selectSharedModelConnection,
  sharedProvidersEligibleForSync
} from './settings-section-providers'
import {
  credentialRetryDelayMs,
  drainSharedProviderCredentialMutation,
  enqueueSharedModelMutation,
  isCredentialRetryableError,
  resetSharedProviderMutationCoordinatorForTests,
  sharedProviderMutationCoordinator,
  stageSharedProviderCredentialMutation
} from './shared-provider-mutation-coordinator'

const textModelProfile: ModelProviderModelProfileV1 = {
  inputModalities: ['text'],
  outputModalities: ['text'],
  supportsToolCalling: true,
  messageParts: ['text']
}

describe('provider draft projection', () => {
  it('replaces a committed same-id row instead of rendering a duplicate draft', () => {
    const providers = defaultModelProviderSettings().providers
    const draft = { ...providers[0]!, name: 'Draft provider', apiKey: 'pending-secret' }
    const displayed = mergeProviderDraftForDisplay(providers, draft)

    expect(displayed).toHaveLength(providers.length)
    expect(displayed.filter((provider) => provider.id === draft.id)).toEqual([draft])
    expect(new Set(displayed.map((provider) => provider.id)).size).toBe(displayed.length)
  })
})

describe('credential retry policy', () => {
  it('uses capped exponential backoff with bounded jitter', () => {
    expect(credentialRetryDelayMs(1, () => 0)).toBe(800)
    expect(credentialRetryDelayMs(2, () => 0.5)).toBe(2_000)
    expect(credentialRetryDelayMs(9, () => 1)).toBe(30_000)
  })

  it('retries transient failures but not credential validation failures', () => {
    expect(isCredentialRetryableError(new TypeError('network unavailable'))).toBe(true)
    expect(isCredentialRetryableError({ status: 409 })).toBe(true)
    expect(isCredentialRetryableError({ status: 503 })).toBe(true)
    expect(isCredentialRetryableError({ status: 400 })).toBe(false)
  })
})

describe('pending provider profile metadata', () => {
  it('keeps the overlay until baseUrl and endpoint metadata reach the registry', () => {
    const connection = {
      id: 'custom-provider-2', accountId: 'account:custom-provider-2',
      name: 'Custom Provider', kind: 'http' as const, authType: 'api-key' as const,
      baseUrl: 'https://old.example.com/v1', endpointFormat: 'chat_completions' as const,
      useProxy: false,
      configured: true, models: ['model-a'], modelCapabilities: { 'model-a': { id: 'model-a', ...textModelProfile } }
    } satisfies SharedModelConnection
    const pending = {
      generation: 4, localProviderName: 'Edited Provider',
      localProviderBaseUrl: 'https://new.example.com/v1',
      localProviderEndpointFormat: 'responses' as const, localProviderKind: 'http' as const,
      baseModels: ['model-a'], baseModelProfiles: { 'model-a': textModelProfile },
      localModels: ['model-a'], localModelProfiles: { 'model-a': textModelProfile }, committedRevision: 5
    }
    const snapshot = (provider: SharedModelConnection) => ({ schemaVersion: 1 as const, proxyRoutingVersion: 1 as const, revision: 5, providers: [provider] })

    expect(reconcilePendingSharedProviderCatalogs(snapshot(connection), new Map([[connection.id, pending]]))
      .has(connection.id)).toBe(true)
    expect(reconcilePendingSharedProviderCatalogs(snapshot({
      ...connection, name: 'Edited Provider', baseUrl: pending.localProviderBaseUrl,
      endpointFormat: pending.localProviderEndpointFormat
    }), new Map([[connection.id, pending]])).has(connection.id)).toBe(false)
  })
})

describe('shared model connection mutation ordering', () => {
  it('continues processing after an earlier queued mutation fails', async () => {
    const enqueue = createSharedModelMutationQueue()
    const operations: string[] = []

    await expect(enqueue(async () => {
      operations.push('failed')
      throw new Error('expected failure')
    })).rejects.toThrow('expected failure')
    await expect(enqueue(async () => {
      operations.push('continued')
      return 'ok'
    })).resolves.toBe('ok')

    expect(operations).toEqual(['failed', 'continued'])
  })

  it('lets an immediate credential fence settle but cancels its queued mutation before deletion', async () => {
    resetSharedProviderMutationCoordinatorForTests()
    let releaseFence!: () => void
    const fenceGate = new Promise<void>((resolve) => { releaseFence = resolve })
    let pendingDeletion = false
    const operations: string[] = []
    const staged = stageSharedProviderCredentialMutation(
      'deepseek',
      'stale-secret',
      async () => fenceGate
    )
    const credentialDrain = drainSharedProviderCredentialMutation(
      'deepseek',
      staged.generation,
      async () => {
        if (pendingDeletion) throw new Error('provider is pending deletion')
        operations.push('credential')
      }
    )
    const credentialExpectation = expect(credentialDrain).rejects.toThrow('pending deletion')

    pendingDeletion = true
    const deletion = enqueueSharedModelMutation(async () => {
      operations.push('delete')
      sharedProviderMutationCoordinator.pendingCredentials.delete('deepseek')
    })
    releaseFence()

    await credentialExpectation
    await deletion
    expect(operations).toEqual(['delete'])
    expect(sharedProviderMutationCoordinator.pendingCredentials.has('deepseek')).toBe(false)
  })

  it('lets an immediate credential fence make an in-flight catalog drain conflict safely', async () => {
    resetSharedProviderMutationCoordinatorForTests()
    const operations: string[] = []
    let fenceInstalled = false
    let catalogStarted!: () => void
    const started = new Promise<void>((resolve) => { catalogStarted = resolve })
    let releaseCatalog!: () => void
    const catalogGate = new Promise<void>((resolve) => { releaseCatalog = resolve })
    const catalog = enqueueSharedModelMutation(async () => {
      operations.push('catalog:start')
      catalogStarted()
      await catalogGate
      if (fenceInstalled) {
        operations.push('catalog:conflict')
        throw new Error('provider credential replacement is pending')
      }
      operations.push('catalog:commit')
    })
    const catalogExpectation = expect(catalog).rejects.toThrow('replacement is pending')
    await started

    const staged = stageSharedProviderCredentialMutation(
      'deepseek',
      'new-secret',
      async () => {
        operations.push('fence')
        fenceInstalled = true
      }
    )
    await staged.fence
    const credential = drainSharedProviderCredentialMutation(
      'deepseek',
      staged.generation,
      async () => { operations.push('credential:commit') }
    )
    releaseCatalog()

    await catalogExpectation
    await expect(credential).resolves.toMatchObject({ committed: true })
    expect(operations).toEqual([
      'catalog:start',
      'fence',
      'catalog:conflict',
      'credential:commit'
    ])
  })

  it('finishes an in-flight stale connect before deletion and blocks queued stale reconnects', async () => {
    const enqueue = createSharedModelMutationQueue()
    const pendingDeletions = new Set<string>()
    const providers = [{ id: 'custom-provider-2' }]
    const operations: string[] = []
    let releaseConnect!: () => void
    let markConnectStarted!: () => void
    const connectGate = new Promise<void>((resolve) => { releaseConnect = resolve })
    const connectStarted = new Promise<void>((resolve) => { markConnectStarted = resolve })
    const inFlightSync = enqueue(async () => {
      operations.push('connect:start')
      markConnectStarted()
      await connectGate
      operations.push('connect:finish')
    })
    await connectStarted

    pendingDeletions.add(providers[0]!.id)
    const deletion = enqueue(async () => { operations.push('delete') })
    const queuedStaleSync = enqueue(async () => {
      for (const provider of sharedProvidersEligibleForSync(providers, pendingDeletions)) {
        operations.push(`connect:after-delete:${provider.id}`)
      }
    })
    releaseConnect()
    await Promise.all([inFlightSync, deletion, queuedStaleSync])

    expect(operations).toEqual(['connect:start', 'connect:finish', 'delete'])
  })

  it('queues the selection read and commit between sync and deletion without interleaving', async () => {
    const enqueue = createSharedModelMutationQueue()
    const operations: string[] = []
    let releaseSync!: () => void
    let markSyncStarted!: () => void
    const syncGate = new Promise<void>((resolve) => { releaseSync = resolve })
    const syncStarted = new Promise<void>((resolve) => { markSyncStarted = resolve })
    const provider = {
      id: 'custom-provider-2',
      accountId: 'account:custom-provider-2',
      name: 'Custom Provider',
      kind: 'http',
      authType: 'api-key',
      configured: true,
      models: ['custom-model']
    }
    const snapshot = (revision: number) => ({
      schemaVersion: 1,
      proxyRoutingVersion: 1 as const,
      revision,
      providers: [provider]
    })
    const runtimeRequest = vi.fn(async (path: string, method: string, _body?: string) => {
      operations.push(method === 'GET' ? 'select:read' : 'select:commit')
      return {
        ok: true,
        status: 200,
        body: JSON.stringify(method === 'GET' ? snapshot(13) : snapshot(14))
      }
    })
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })

    try {
      const sync = enqueue(async () => {
        operations.push('sync:start')
        markSyncStarted()
        await syncGate
        operations.push('sync:finish')
      })
      await syncStarted
      const selection = enqueue(() => selectSharedModelConnection(
        provider.id,
        'custom-model'
      ))
      const deletion = enqueue(async () => { operations.push('delete') })

      expect(runtimeRequest).not.toHaveBeenCalled()
      releaseSync()
      await Promise.all([sync, selection, deletion])

      expect(operations).toEqual([
        'sync:start',
        'sync:finish',
        'select:read',
        'select:commit',
        'delete'
      ])
      expect(JSON.parse(runtimeRequest.mock.calls[1]![2] ?? '{}')).toMatchObject({ expectedRevision: 13 })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('makes an explicitly re-added provider eligible for sync again', () => {
    const provider = { id: 'custom-provider-2' }
    const pendingDeletions = new Map([[
      provider.id,
      { generation: 1, committedRevision: 17 }
    ]])

    clearPendingSharedProviderDeletionForExplicitAdd(pendingDeletions, provider.id)

    expect(pendingDeletions.has(provider.id)).toBe(false)
    expect(sharedProvidersEligibleForSync([provider], pendingDeletions)).toEqual([provider])
  })
})

describe('shared model connection settings projection', () => {
  it('projects a TUI-owned default without clearing existing protected compatibility credentials', () => {
    const current = defaultModelProviderSettings()
    current.providers[0]!.apiKey = 'legacy-plaintext'

    const projected = projectSharedModelConnections(current, {
      schemaVersion: 1,
      proxyRoutingVersion: 1 as const,
      revision: 4,
      providers: [{
        id: 'codex',
        accountId: 'account:codex',
        name: 'Codex',
        kind: 'http',
        authType: 'subscription',
        baseUrl: 'https://example.test/codex',
        endpointFormat: 'responses',
        useProxy: false,
        configured: true,
        models: ['gpt-live'],
        selectedModel: 'gpt-live'
      }],
      defaultProviderId: 'codex',
      defaultAccountId: 'account:codex',
      defaultModel: 'gpt-live',
      proxy: { enabled: false, url: '' },
      routePools: [],
      localModelGateway: { enabled: false }
    })

    expect(projected.kun).toEqual({ providerId: 'codex', model: 'gpt-live' })
    expect(projected.provider.providers.find((provider) => provider.id === 'codex')).toMatchObject({
      apiKey: '',
      models: ['gpt-live']
    })
    expect(projected.provider.providers.find((provider) => provider.id === 'deepseek')?.apiKey)
      .toBe('legacy-plaintext')
  })

  it('preserves pending connection profile edits against an older registry snapshot', () => {
    const current = defaultModelProviderSettings()
    current.providers[0] = {
      ...current.providers[0]!,
      name: 'Edited provider',
      baseUrl: 'https://new.example/v1',
      endpointFormat: 'responses'
    }
    const projected = projectSharedModelConnections(
      current,
      {
        schemaVersion: 1,
        proxyRoutingVersion: 1 as const,
        revision: 7,
        providers: [{
          id: current.providers[0]!.id,
          accountId: `account:${current.providers[0]!.id}`,
          name: 'Old provider',
          kind: 'http',
          authType: 'api-key',
          baseUrl: 'https://old.example/v1',
          endpointFormat: 'chat_completions',
          useProxy: false,
          configured: true,
          models: [...current.providers[0]!.models]
        }]
      },
      new Map(),
      new Map([[
        current.providers[0]!.id,
        {
          localName: 'Edited provider',
          canonicalName: 'Edited provider',
          localBaseUrl: 'https://new.example/v1',
          localEndpointFormat: 'responses',
          committedRevision: null
        }
      ]])
    )

    expect(projected.provider.providers[0]).toMatchObject({
      name: 'Edited provider',
      baseUrl: 'https://new.example/v1',
      endpointFormat: 'responses'
    })
  })

  it('clears an existing settings credential while applying shared registry metadata', () => {
    const current = defaultModelProviderSettings()
    current.providers.push({
      ...current.providers[0]!,
      id: 'custom',
      name: 'Old name',
      apiKey: 'protected-runtime-value',
      baseUrl: 'https://old.example/v1',
      models: ['old-model']
    })

    const projected = projectSharedModelConnections(current, {
      schemaVersion: 1,
      proxyRoutingVersion: 1 as const,
      revision: 7,
      providers: [{
        id: 'custom',
        accountId: 'account:custom',
        name: 'Shared name',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://new.example/v1',
        endpointFormat: 'chat_completions',
        useProxy: false,
        configured: true,
        models: ['new-model']
      }]
    })

    expect(projected.provider.providers.find((provider) => provider.id === 'custom')).toMatchObject({
      apiKey: '',
      baseUrl: 'https://new.example/v1',
      models: ['new-model']
    })
  })

  it('retains a key-requiring preset committed without a credential', () => {
    const current = defaultModelProviderSettings()
    current.providers.push({
      ...current.providers[0]!,
      id: 'moonshot-cn',
      name: 'Moonshot',
      apiKey: '',
      baseUrl: 'https://api.moonshot.cn/v1'
    })

    const projected = projectSharedModelConnections(current, {
      schemaVersion: 1,
      proxyRoutingVersion: 1 as const,
      revision: 3,
      providers: []
    })

    const retained = projected.provider.providers.find((provider) => provider.id === 'moonshot-cn')
    expect(retained).toMatchObject({ apiKey: '', baseUrl: 'https://api.moonshot.cn/v1' })
  })

  it('retains a local provider whose required baseUrl is still empty', () => {
    const current = defaultModelProviderSettings()
    current.providers.push({
      ...current.providers[0]!,
      id: 'custom-provider-2',
      name: 'Custom',
      apiKey: '',
      baseUrl: ''
    })

    const projected = projectSharedModelConnections(current, {
      schemaVersion: 1,
      proxyRoutingVersion: 1 as const,
      revision: 4,
      providers: []
    })

    expect(projected.provider.providers.some((provider) => provider.id === 'custom-provider-2'))
      .toBe(true)
  })

  it('drops providers the sync loop can connect once they are configured elsewhere', () => {
    const current = defaultModelProviderSettings()
    current.providers.push({
      ...current.providers[0]!,
      id: 'moonshot-cn',
      name: 'Moonshot',
      apiKey: 'sk-live',
      baseUrl: 'https://api.moonshot.cn/v1'
    })

    const projected = projectSharedModelConnections(current, {
      schemaVersion: 1,
      proxyRoutingVersion: 1 as const,
      revision: 5,
      providers: []
    })

    expect(projected.provider.providers.some((provider) => provider.id === 'moonshot-cn'))
      .toBe(false)
  })

  it('clears the GUI provider without emitting an invalid empty model', () => {
    const projected = projectSharedModelConnections(defaultModelProviderSettings(), {
      schemaVersion: 1,
      proxyRoutingVersion: 1 as const,
      revision: 5,
      providers: [],
      proxy: { enabled: false, url: '' },
      routePools: [],
      localModelGateway: { enabled: false }
    })

    expect(projected.kun).toEqual({ providerId: '' })
  })

  it('keeps the in-progress route and local gateway configuration over a stale registry snapshot', () => {
    const current = defaultModelProviderSettings()
    current.localGateway = { name: 'My local relay', enabled: true }
    current.routePools = [{
      id: 'local-route-1',
      name: 'Local route',
      modelId: 'local-chat',
      enabled: true,
      strategy: 'priority',
      targets: [{ id: 'target-1', providerId: 'deepseek', modelId: 'deepseek-chat', enabled: true, weight: 1 }],
      failurePolicy: { failoverHttpStatusCodes: [429, 503], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: true },
      healthPolicy: { failureThreshold: 3, cooldownMs: 60_000, halfOpenMaxAttempts: 1 }
    }]

    const projected = projectSharedModelConnections(current, {
      schemaVersion: 1,
      proxyRoutingVersion: 1 as const,
      revision: 9,
      providers: [],
      routePools: [],
      localModelGateway: { enabled: false }
    })

    expect(projected.provider.routePools).toEqual(current.routePools)
    expect(projected.provider.localGateway).toEqual(current.localGateway)
  })

  it('drops invalid shared capability limits before projecting AppSettings', () => {
    const projected = projectSharedModelConnections(defaultModelProviderSettings(), {
      schemaVersion: 1,
      proxyRoutingVersion: 1 as const,
      revision: 6,
      providers: [{
        id: 'zenmux',
        accountId: 'account:zenmux',
        name: 'ZenMux',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://zenmux.ai/api/v1',
        endpointFormat: 'chat_completions',
        useProxy: false,
        configured: true,
        models: ['qwen/qwen3.5-flash'],
        modelCapabilities: {
          'qwen/qwen3.5-flash': {
            id: 'qwen/qwen3.5-flash',
            inputModalities: ['text', 'image'],
            outputModalities: ['text'],
            supportsToolCalling: true,
            messageParts: ['text', 'image_url'],
            contextWindowTokens: 1_020_000,
            maxOutputTokens: 1_020_000
          }
        }
      }]
    })
    const profile = projected.provider.providers.find((provider) => provider.id === 'zenmux')
      ?.modelProfiles['qwen/qwen3.5-flash']

    expect(profile).toMatchObject({
      contextWindowTokens: 1_020_000,
      inputModalities: ['text', 'image']
    })
    expect(profile?.maxOutputTokens).toBeUndefined()
  })

  it('does not restore a provider while its canonical deletion is pending', () => {
    const current = defaultModelProviderSettings()
    const projected = projectSharedModelConnections(current, {
      schemaVersion: 1,
      proxyRoutingVersion: 1 as const,
      revision: 8,
      providers: [{
        id: 'custom-provider-2',
        accountId: 'account:custom-provider-2',
        name: 'Custom Provider',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://api.example.com/v1',
        endpointFormat: 'chat_completions',
        useProxy: false,
        configured: true,
        models: ['custom-model'],
        selectedModel: 'custom-model'
      }],
      defaultProviderId: 'custom-provider-2',
      defaultAccountId: 'account:custom-provider-2',
      defaultModel: 'custom-model'
    }, new Map([['custom-provider-2', { generation: 1, committedRevision: 8 }]]))

    expect(projected.provider.providers.map((provider) => provider.id)).toEqual(['deepseek'])
    expect(projected.kun).toEqual({ providerId: '' })
  })

  it('clears every Kun and Write route that belongs to a deleted provider', () => {
    const deletedProviderId = 'removed-provider'
    const currentKun = defaultKunRuntimeSettings()
    Object.assign(currentKun, {
      providerId: deletedProviderId,
      model: 'removed-main',
      smallModel: 'removed-small', smallModelProviderId: deletedProviderId, smallModelAccountId: 'small-account',
      titleModel: 'removed-title', titleProviderId: deletedProviderId, titleAccountId: 'title-account',
      summaryModel: 'removed-summary', summaryProviderId: deletedProviderId, summaryAccountId: 'summary-account',
      codeReviewModel: 'removed-review', codeReviewProviderId: deletedProviderId, codeReviewAccountId: 'review-account',
      planModel: 'removed-plan', planProviderId: deletedProviderId, planAccountId: 'plan-account'
    })
    currentKun.imageGeneration = { ...currentKun.imageGeneration, providerId: deletedProviderId, model: 'removed-image' }
    currentKun.speechToText = { ...currentKun.speechToText, providerId: deletedProviderId, model: 'removed-speech' }
    currentKun.textToSpeech = { ...currentKun.textToSpeech, providerId: deletedProviderId, model: 'removed-tts' }
    currentKun.promptOptimization = { ...currentKun.promptOptimization, providerId: deletedProviderId, model: 'removed-prompt' }
    currentKun.musicGeneration = { ...currentKun.musicGeneration, providerId: deletedProviderId, model: 'removed-music' }
    currentKun.videoGeneration = { ...currentKun.videoGeneration, providerId: deletedProviderId, model: 'removed-video' }
    currentKun.contextCompaction = {
      ...currentKun.contextCompaction,
      summaryProviderId: deletedProviderId,
      summaryModel: 'removed-compaction'
    }
    currentKun.fastContext = { ...currentKun.fastContext, providerId: deletedProviderId, model: 'removed-fast' }
    currentKun.lab = {
      ...currentKun.lab,
      pptAgent: { ...currentKun.lab.pptAgent, providerId: deletedProviderId, model: 'removed-ppt' }
    }
    currentKun.graph = {
      ...currentKun.graph,
      workerModel: { mode: 'fixed', providerId: deletedProviderId, model: 'removed-worker' }
    }
    currentKun.subagents = {
      enabled: true,
      profiles: [{
        id: 'routed', enabled: true, name: 'Routed', mode: 'all', toolPolicy: 'inherit',
        providerId: deletedProviderId, model: 'removed-subagent'
      }]
    }
    const fallbackProvider = defaultModelProviderSettings().providers[0]!

    const patch = modelProviderDeletionKunPatch({
      currentKun,
      deletedProviderIds: new Set([deletedProviderId]),
      fallbackProvider
    })

    expect(patch).toMatchObject({
      providerId: fallbackProvider.id,
      model: fallbackProvider.models[0],
      imageGeneration: { providerId: '', model: '' },
      speechToText: { providerId: '', model: '' },
      textToSpeech: { providerId: '', model: '' },
      promptOptimization: { providerId: '', model: '' },
      musicGeneration: { providerId: '', model: '' },
      videoGeneration: { providerId: '', model: '' },
      contextCompaction: { summaryProviderId: '', summaryModel: '' },
      fastContext: { providerId: '', model: '' },
      lab: { pptAgent: { providerId: '', model: '' } },
      graph: { workerModel: { mode: 'inherit' } },
      smallModel: '', smallModelProviderId: '', smallModelAccountId: '',
      titleModel: '', titleProviderId: '', titleAccountId: '',
      summaryModel: '', summaryProviderId: '', summaryAccountId: '',
      codeReviewModel: '', codeReviewProviderId: '', codeReviewAccountId: '',
      planModel: '', planProviderId: '', planAccountId: ''
    })
    expect(patch.subagents?.profiles?.[0]).not.toHaveProperty('providerId')
    expect(patch.subagents?.profiles?.[0]).not.toHaveProperty('model')
    expect(modelProviderDeletionWritePatch({
      ...defaultWriteSettings().inlineCompletion,
      inheritProvider: false,
      providerId: deletedProviderId,
      inheritModel: false,
      model: 'removed-write'
    }, new Set([deletedProviderId]))).toMatchObject({
      write: { inlineCompletion: { inheritProvider: true, providerId: '', inheritModel: true, model: '' } }
    })
  })
})
