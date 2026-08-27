import {
  defaultModelProviderSettings,
  defaultModelRequestRetrySettings,
  modelProviderTokenPlanProfile,
  type ModelProviderModelProfileV1
} from '@shared/app-settings'
import { MODEL_PROVIDER_PRESETS } from '@shared/model-provider-presets'
import { describe, expect, it, vi } from 'vitest'
import {
  applyPendingSharedProviderCatalog,
  commitSharedModelConnectionCatalog,
  fenceSharedModelConnectionCredential,
  projectSharedModelConnections,
  rebasePendingSharedProviderCatalog,
  reconcilePendingSharedProviderCatalogs,
  reconcilePendingSharedProviderDeletions,
  reconcilePendingSharedProviderNames,
  replaceSharedModelConnectionCredential,
  sharedConnectionBaseUrlOptional
} from './settings-section-providers'
import type { SharedModelConnectionsSnapshot } from './settings-section-providers-shared-api'
import {
  drainSharedProviderCredentialMutation,
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

describe('pending shared model connection deletions', () => {
  const connection = {
    id: 'custom-provider-2',
    accountId: 'account:custom-provider-2',
    name: 'Custom Provider',
    kind: 'http' as const,
    authType: 'api-key' as const,
    endpointFormat: 'chat_completions' as const,
    configured: true,
    models: ['custom-model']
  }
  const snapshot = (revision: number, providers = [connection]) => ({
    schemaVersion: 1 as const,
    revision,
    providers
  })

  it('keeps tombstones through the deletion revision and releases newer snapshots', () => {
    const pending = new Map([[connection.id, { generation: 1, committedRevision: 5 }]])

    expect(reconcilePendingSharedProviderDeletions(snapshot(4), pending).has(connection.id)).toBe(true)
    expect(reconcilePendingSharedProviderDeletions(snapshot(5), pending).has(connection.id)).toBe(true)
    expect(reconcilePendingSharedProviderDeletions(snapshot(6), pending).has(connection.id)).toBe(false)
    expect(pending.get(connection.id)?.committedRevision).toBe(5)
  })

  it('keeps an uncommitted tombstone even when a stale snapshot omits the provider', () => {
    const pending = new Map([[connection.id, { generation: 1, committedRevision: null }]])

    expect(reconcilePendingSharedProviderDeletions(snapshot(20), pending).has(connection.id)).toBe(true)
    expect(reconcilePendingSharedProviderDeletions(snapshot(20, []), pending).has(connection.id)).toBe(true)
  })

  it('does not release a committed tombstone until local settings observe the deletion', () => {
    const pending = new Map([[connection.id, { generation: 1, committedRevision: 5 }]])

    expect(reconcilePendingSharedProviderDeletions(
      snapshot(6, []),
      pending,
      new Set([connection.id])
    ).has(connection.id)).toBe(true)
    expect(reconcilePendingSharedProviderDeletions(
      snapshot(6, []),
      pending,
      new Set()
    ).has(connection.id)).toBe(false)
  })
})

describe('pending shared model connection names', () => {
  const connection = (name: string) => ({
    id: 'custom-provider-2',
    accountId: 'account:custom-provider-2',
    name,
    kind: 'http' as const,
    authType: 'api-key' as const,
    endpointFormat: 'chat_completions' as const,
    configured: true,
    models: ['custom-model']
  })
  const snapshot = (revision: number, name: string) => ({
    schemaVersion: 1 as const,
    revision,
    providers: [connection(name)]
  })
  const pending = (committedRevision: number | null) => new Map([[
    'custom-provider-2',
    {
      localName: 'Renamed Provider',
      canonicalName: 'Renamed Provider',
      committedRevision
    }
  ]])

  it('keeps the local name while old registry revisions race the PATCH', () => {
    expect(reconcilePendingSharedProviderNames(snapshot(4, 'Custom Provider'), pending(null))
      .has('custom-provider-2')).toBe(true)
    expect(reconcilePendingSharedProviderNames(snapshot(4, 'Custom Provider'), pending(5))
      .has('custom-provider-2')).toBe(true)
  })

  it('releases an uncommitted local name once the canonical registry already matches it', () => {
    expect(reconcilePendingSharedProviderNames(snapshot(4, 'Renamed Provider'), pending(null))
      .has('custom-provider-2')).toBe(false)
  })

  it('releases the local name after observing the PATCH or a newer external rename', () => {
    expect(reconcilePendingSharedProviderNames(snapshot(5, 'Renamed Provider'), pending(5))
      .has('custom-provider-2')).toBe(false)
    expect(reconcilePendingSharedProviderNames(snapshot(6, 'External Rename'), pending(5))
      .has('custom-provider-2')).toBe(false)
  })

  it('projects the local name over a stale registry snapshot', () => {
    const current = defaultModelProviderSettings()
    current.providers.push({
      ...current.providers[0]!,
      id: 'custom-provider-2',
      name: 'Renamed Provider'
    })

    const projected = projectSharedModelConnections(
      current,
      snapshot(4, 'Custom Provider'),
      new Map(),
      pending(null)
    )

    expect(projected.provider.providers.find((item) => item.id === 'custom-provider-2')?.name)
      .toBe('Renamed Provider')
  })
})

describe('pending shared model connection catalogs', () => {
  const connection = (revisionModels = ['old-model']) => ({
    id: 'custom-provider-2',
    accountId: 'account:custom-provider-2',
    name: 'Custom Provider',
    kind: 'http' as const,
    authType: 'api-key' as const,
    baseUrl: 'https://api.example.com/v1',
    endpointFormat: 'chat_completions' as const,
    configured: true,
    models: revisionModels,
    modelCapabilities: Object.fromEntries(revisionModels.map((model) => [model, {
      id: model,
      ...textModelProfile
    }])),
    selectedModel: revisionModels[0]
  })
  const pending = {
    generation: 3,
    baseModels: ['old-model'],
    baseModelProfiles: { 'old-model': textModelProfile },
    localModels: ['old-model', 'new-model'],
    localModelProfiles: {
      'old-model': textModelProfile,
      'new-model': { ...textModelProfile, aliases: ['new-alias'] }
    },
    committedRevision: null
  }

  it('projects an optimistic catalog over stale registry events without sending GUI-only aliases', () => {
    const current = defaultModelProviderSettings()
    current.providers.push({
      ...current.providers[0]!,
      id: 'custom-provider-2',
      models: pending.localModels,
      modelProfiles: pending.localModelProfiles
    })
    const projected = projectSharedModelConnections(
      current,
      { schemaVersion: 1, revision: 4, providers: [connection()] },
      new Map(),
      new Map(),
      new Map([['custom-provider-2', pending]])
    )

    expect(projected.provider.providers.find((item) => item.id === 'custom-provider-2'))
      .toMatchObject({ models: ['old-model', 'new-model'] })
    const applied = applyPendingSharedProviderCatalog(connection(), pending)
    expect(applied.models).toEqual(['old-model', 'new-model'])
    expect(applied.modelCapabilities?.['new-model']).not.toHaveProperty('aliases')
  })

  it('keeps a committed overlay until the event stream reaches its revision', () => {
    const committed = new Map([['custom-provider-2', { ...pending, committedRevision: 5 }]])
    const stale = { schemaVersion: 1 as const, revision: 4, providers: [connection()] }
    const observed = {
      schemaVersion: 1 as const,
      revision: 5,
      providers: [connection(['old-model', 'new-model'])]
    }

    expect(reconcilePendingSharedProviderCatalogs(stale, committed).has('custom-provider-2')).toBe(true)
    expect(reconcilePendingSharedProviderCatalogs(observed, committed).has('custom-provider-2')).toBe(false)
  })

  it('replays a local delta on the latest revision and preserves a concurrent model addition', async () => {
    const remote = connection(['old-model', 'remote-model'])
    const snapshot = (revision: number) => ({
      schemaVersion: 1 as const,
      revision,
      providers: [remote]
    })
    const runtimeRequest = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, body: JSON.stringify(snapshot(7)) })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        body: JSON.stringify({ snapshot: snapshot(8) })
      })
      .mockResolvedValueOnce({ ok: true, status: 200, body: JSON.stringify(snapshot(9)) })
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })

    try {
      await expect(commitSharedModelConnectionCatalog('custom-provider-2', pending))
        .resolves.toMatchObject({ revision: 9 })
      const writes = runtimeRequest.mock.calls.slice(1).map(([, , body]) => JSON.parse(body))
      expect(writes.map((body) => body.expectedRevision)).toEqual([7, 8])
      expect(writes[1]).toMatchObject({
        models: ['old-model', 'remote-model', 'new-model']
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rebases a newer undo generation on an older in-flight commit', () => {
    const addGeneration = {
      ...pending,
      baseModels: ['old-model'],
      localModels: ['old-model', 'new-model']
    }
    const afterAdd = connection(['old-model', 'new-model'])
    const undoGeneration = {
      ...pending,
      generation: 4,
      baseModels: ['old-model'],
      localModels: ['old-model'],
      localModelProfiles: { 'old-model': textModelProfile }
    }

    expect(applyPendingSharedProviderCatalog(connection(), addGeneration).models)
      .toEqual(['old-model', 'new-model'])
    const rebasedUndo = rebasePendingSharedProviderCatalog(addGeneration, undoGeneration, afterAdd)
    expect(applyPendingSharedProviderCatalog(afterAdd, rebasedUndo).models)
      .toEqual(['old-model'])
  })

  it('rebases only the newer user delta and preserves unseen remote catalog changes', () => {
    const completed = {
      ...pending,
      baseModels: ['old-model'],
      localModels: ['old-model', 'model-a']
    }
    const newer = {
      ...pending,
      generation: 5,
      baseModels: ['old-model'],
      localModels: ['old-model', 'model-a', 'model-b'],
      localModelProfiles: {
        'old-model': textModelProfile,
        'model-a': textModelProfile,
        'model-b': textModelProfile
      }
    }
    const committedWithRemote = connection(['old-model', 'remote-model', 'model-a'])

    const rebased = rebasePendingSharedProviderCatalog(completed, newer, committedWithRemote)

    expect(rebased.localModels).toEqual(['old-model', 'remote-model', 'model-a', 'model-b'])
    expect(applyPendingSharedProviderCatalog(committedWithRemote, rebased).models)
      .toEqual(['old-model', 'remote-model', 'model-a', 'model-b'])
  })

  it('retains a pending Aliyun Token Plan catalog when the registry has not connected yet (#1117)', () => {
    const aliyunPreset = MODEL_PROVIDER_PRESETS.find((preset) => preset.id === 'aliyun')
    expect(aliyunPreset).toBeTruthy()
    const tokenPlan = modelProviderTokenPlanProfile(aliyunPreset!, 'sk-token-plan')!
    const fetchedModels = ['qwen-plus', 'qwen-max', 'qwen-turbo']
    const current = defaultModelProviderSettings()
    current.providers.push({
      ...tokenPlan,
      models: fetchedModels,
      modelProfiles: Object.fromEntries(fetchedModels.map((model) => [model, textModelProfile]))
    })
    const pendingCatalog = {
      generation: 1,
      baseModels: [...tokenPlan.models],
      baseModelProfiles: structuredClone(tokenPlan.modelProfiles),
      localModels: fetchedModels,
      localModelProfiles: Object.fromEntries(fetchedModels.map((model) => [model, textModelProfile])),
      committedRevision: null
    }

    const projected = projectSharedModelConnections(
      current,
      { schemaVersion: 1, revision: 2, providers: [] },
      new Map(),
      new Map(),
      new Map([[tokenPlan.id, pendingCatalog]])
    )

    expect(projected.provider.providers.find((item) => item.id === tokenPlan.id)).toMatchObject({
      models: fetchedModels
    })
  })

  it('connects then commits a catalog when the shared connection is missing (#1117)', async () => {
    const aliyunPreset = MODEL_PROVIDER_PRESETS.find((preset) => preset.id === 'aliyun')
    expect(aliyunPreset).toBeTruthy()
    const tokenPlan = modelProviderTokenPlanProfile(aliyunPreset!, 'sk-token-plan')!
    const fetchedModels = ['qwen-plus', 'qwen-max']
    const pendingCatalog = {
      generation: 2,
      baseModels: [...tokenPlan.models],
      baseModelProfiles: structuredClone(tokenPlan.modelProfiles),
      localModels: fetchedModels,
      localModelProfiles: Object.fromEntries(fetchedModels.map((model) => [model, textModelProfile])),
      committedRevision: null
    }
    const emptySnapshot = { schemaVersion: 1 as const, revision: 3, providers: [] as [] }
    const connectedSnapshot = {
      schemaVersion: 1 as const,
      revision: 4,
      providers: [{
        id: tokenPlan.id,
        accountId: `account:${tokenPlan.id}`,
        name: tokenPlan.name,
        kind: 'http' as const,
        authType: 'api-key' as const,
        baseUrl: tokenPlan.baseUrl,
        endpointFormat: tokenPlan.endpointFormat,
        configured: true,
        models: fetchedModels,
        modelCapabilities: Object.fromEntries(fetchedModels.map((model) => [model, {
          id: model,
          ...textModelProfile
        }])),
        selectedModel: fetchedModels[0]
      }]
    }
    const runtimeRequest = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, body: JSON.stringify(emptySnapshot) })
      .mockResolvedValueOnce({ ok: true, status: 200, body: JSON.stringify(connectedSnapshot) })
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })

    try {
      await expect(commitSharedModelConnectionCatalog(
        tokenPlan.id,
        pendingCatalog,
        () => false,
        { provider: tokenPlan, credential: 'sk-token-plan' }
      )).resolves.toMatchObject({ revision: 4 })

      expect(runtimeRequest.mock.calls.map(([path, method]) => [path, method])).toEqual([
        ['/v1/model-connections', 'GET'],
        ['/v1/model-connections/connect', 'POST']
      ])
      const connectBody = JSON.parse(runtimeRequest.mock.calls[1]![2] as string) as {
        id: string
        models: string[]
        credential: string
      }
      expect(connectBody).toMatchObject({
        id: tokenPlan.id,
        models: fetchedModels,
        credential: 'sk-token-plan'
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('shared model connection credential replacement', () => {
  it('treats clearing an absent connection credential as already complete', async () => {
    const snapshot = { schemaVersion: 1 as const, revision: 20, providers: [] }
    const runtimeRequest = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, body: JSON.stringify(snapshot) })
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })

    try {
      await expect(replaceSharedModelConnectionCredential('missing', '')).resolves.toEqual(snapshot)
      expect(runtimeRequest).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('uses the latest revision for a replacement and retries one conflict', async () => {
    const provider = {
      id: 'deepseek',
      accountId: 'account:deepseek',
      name: 'DeepSeek',
      kind: 'http' as const,
      authType: 'api-key' as const,
      baseUrl: 'https://api.deepseek.com',
      endpointFormat: 'chat_completions' as const,
      configured: true,
      credentialStatus: 'unreadable' as const,
      credentialErrorCode: 'credential_unreadable' as const,
      models: ['deepseek-chat']
    }
    const snapshot = (revision: number, ready = false) => ({
      schemaVersion: 1 as const,
      revision,
      providers: [{
        ...provider,
        ...(ready
          ? { credentialStatus: 'ready' as const, credentialErrorCode: undefined }
          : {})
      }]
    })
    const runtimeRequest = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, body: JSON.stringify(snapshot(20)) })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        body: JSON.stringify({ snapshot: snapshot(21) })
      })
      .mockResolvedValueOnce({ ok: true, status: 200, body: JSON.stringify(snapshot(22, true)) })
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })

    try {
      const replaced = await replaceSharedModelConnectionCredential('deepseek', 'latest-secret')
      expect(replaced.providers[0]).toMatchObject({
        credentialStatus: 'ready'
      })
      expect(replaced.providers[0]).not.toHaveProperty('credentialErrorCode')
      expect(runtimeRequest.mock.calls.map(([path, method, body]) => [
        path,
        method,
        body ? JSON.parse(body) : undefined
      ])).toEqual([
        ['/v1/model-connections', 'GET', undefined],
        ['/v1/model-connections/deepseek/credential', 'PUT', {
          expectedRevision: 20,
          credential: 'latest-secret'
        }],
        ['/v1/model-connections/deepseek/credential', 'PUT', {
          expectedRevision: 21,
          credential: 'latest-secret'
        }]
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects a delayed stale commit after a newer generation installs its fence', async () => {
    const provider = {
      id: 'deepseek',
      accountId: 'account:deepseek',
      name: 'DeepSeek',
      kind: 'http' as const,
      authType: 'api-key' as const,
      baseUrl: 'https://api.deepseek.com',
      endpointFormat: 'chat_completions' as const,
      configured: true,
      models: ['deepseek-chat']
    }
    let revision = 10
    let latestFence = ''
    const prepared = new Map<string, string>()
    const consumedCredentials: string[] = []
    let firstCommitStarted!: () => void
    const firstCommitInFlight = new Promise<void>((resolve) => { firstCommitStarted = resolve })
    let releaseFirstCommit!: () => void
    const firstCommitRelease = new Promise<void>((resolve) => { releaseFirstCommit = resolve })
    let delayedCommit = true
    const snapshot = () => ({ schemaVersion: 1 as const, revision, providers: [provider] })
    const runtimeRequest = vi.fn(async (path: string, method: string, body?: string) => {
      const payload = body ? JSON.parse(body) as Record<string, unknown> : {}
      if (path === '/v1/model-connections' && method === 'GET') {
        return { ok: true, status: 200, body: JSON.stringify(snapshot()) }
      }
      if (path === '/v1/model-connections/deepseek/credential/fence' && method === 'POST') {
        latestFence = String(payload.operationToken)
        return { ok: true, status: 200, body: JSON.stringify(snapshot()) }
      }
      if (path === '/v1/model-connections/deepseek/credential' && method === 'PUT') {
        prepared.set(String(payload.operationToken), String(payload.credential))
        return { ok: true, status: 200, body: JSON.stringify(snapshot()) }
      }
      if (path === '/v1/model-connections/deepseek/credential/commit' && method === 'POST') {
        const operationToken = String(payload.operationToken)
        if (delayedCommit) {
          delayedCommit = false
          firstCommitStarted()
          await firstCommitRelease
        }
        if (operationToken !== latestFence) {
          return {
            ok: false,
            status: 409,
            body: JSON.stringify({ snapshot: snapshot() })
          }
        }
        consumedCredentials.push(prepared.get(operationToken) ?? '')
        revision += 1
        return { ok: true, status: 200, body: JSON.stringify(snapshot()) }
      }
      throw new Error(`Unexpected runtime request: ${method} ${path}`)
    })
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })

    try {
      const first = stageSharedProviderCredentialMutation(
        'deepseek',
        'first-secret',
        (operationToken) => fenceSharedModelConnectionCredential('deepseek', operationToken)
      )
      const firstDrain = drainSharedProviderCredentialMutation(
        'deepseek',
        first.generation,
        (credential, operationToken, isCurrent) => replaceSharedModelConnectionCredential(
          'deepseek',
          credential,
          () => false,
          { operationToken, isCurrent }
        )
      )
      await firstCommitInFlight

      const second = stageSharedProviderCredentialMutation(
        'deepseek',
        'final-secret',
        (operationToken) => fenceSharedModelConnectionCredential('deepseek', operationToken)
      )
      const firstToken = first.operationToken.split(':')
      const secondToken = second.operationToken.split(':')
      expect(firstToken).toHaveLength(3)
      expect(firstToken[0]).toBe('credential')
      expect(secondToken[1]).toBe(firstToken[1])
      expect(Number(secondToken[2])).toBe(Number(firstToken[2]) + 1)
      await second.fence
      const secondDrain = drainSharedProviderCredentialMutation(
        'deepseek',
        second.generation,
        (credential, operationToken, isCurrent) => replaceSharedModelConnectionCredential(
          'deepseek',
          credential,
          () => false,
          { operationToken, isCurrent }
        )
      )
      releaseFirstCommit()

      await expect(firstDrain).resolves.toMatchObject({ committed: false })
      await expect(secondDrain).resolves.toMatchObject({ committed: true })
      expect(consumedCredentials).toEqual(['final-secret'])
      expect(sharedProviderMutationCoordinator.pendingCredentials.has('deepseek')).toBe(false)
    } finally {
      resetSharedProviderMutationCoordinatorForTests()
      vi.unstubAllGlobals()
    }
  })
})

describe('keyless gemini-cli-api shared connections', () => {
  const geminiProvider = {
    id: 'gemini-cli-subscription',
    name: 'Gemini CLI subscription',
    apiKey: '',
    baseUrl: '',
    endpointFormat: 'custom_endpoint' as const,
    kind: 'gemini-cli-api' as const,
    retry: defaultModelRequestRetrySettings(),
    models: ['gemini-3.7-pro-preview'],
    modelProfiles: {}
  }

  it('treats gemini-cli-api as a keyless transport without requiring baseUrl', () => {
    expect(sharedConnectionBaseUrlOptional('gemini-cli-api')).toBe(true)
    expect(sharedConnectionBaseUrlOptional('gemini-code-assist')).toBe(true)
    expect(sharedConnectionBaseUrlOptional('http')).toBe(false)
    expect(sharedConnectionBaseUrlOptional(undefined)).toBe(false)
  })

  it('projects a connected keyless gemini connection back into settings', () => {
    const current = defaultModelProviderSettings()
    const snapshot: SharedModelConnectionsSnapshot = {
      schemaVersion: 1,
      revision: 3,
      providers: [{
        id: 'gemini-cli-subscription',
        accountId: 'account:gemini-cli-subscription',
        name: 'Gemini CLI subscription',
        kind: 'gemini-cli-api',
        authType: 'subscription',
        endpointFormat: 'custom_endpoint',
        configured: true,
        models: ['gemini-3.7-pro-preview']
      }],
      defaultProviderId: 'gemini-cli-subscription',
      defaultAccountId: 'account:gemini-cli-subscription',
      defaultModel: 'gemini-3.7-pro-preview'
    }
    const projected = projectSharedModelConnections(current, snapshot)
    const projectedProvider = projected.provider.providers
      .find((item) => item.id === 'gemini-cli-subscription')
    expect(projectedProvider).toMatchObject({
      kind: 'gemini-cli-api',
      baseUrl: '',
      models: ['gemini-3.7-pro-preview']
    })
    expect(projected.kun).toEqual({
      providerId: 'gemini-cli-subscription',
      model: 'gemini-3.7-pro-preview'
    })
  })

  it('connects a catalog commit for a keyless gemini provider without baseUrl or credential', async () => {
    const pending = {
      generation: 1,
      baseModels: ['gemini-3.1-pro-preview'],
      baseModelProfiles: {},
      localModels: ['gemini-3.7-pro-preview', 'gemini-3.1-pro-preview'],
      localModelProfiles: {},
      committedRevision: null
    }
    const snapshot = (revision: number, includeConnection = false) => ({
      schemaVersion: 1 as const,
      revision,
      providers: includeConnection
        ? [{
            id: 'gemini-cli-subscription',
            accountId: 'account:gemini-cli-subscription',
            name: 'Gemini CLI subscription',
            kind: 'gemini-cli-api' as const,
            authType: 'subscription' as const,
            endpointFormat: 'custom_endpoint' as const,
            configured: true,
            models: [],
            selectedModel: 'gemini-3.7-pro-preview'
          }]
        : []
    })
    let connected = false
    const runtimeRequest = vi.fn(async (path: string, method: string, body?: string) => {
      if (path === '/v1/model-connections' && method === 'GET') {
        return { ok: true, status: 200, body: JSON.stringify(snapshot(connected ? 8 : 7, connected)) }
      }
      if (path === '/v1/model-connections/connect' && method === 'POST') {
        connected = true
        return { ok: true, status: 201, body: JSON.stringify(snapshot(8, true)) }
      }
      if (
        path === '/v1/model-connections/gemini-cli-subscription' && method === 'PATCH'
      ) {
        return { ok: true, status: 200, body: JSON.stringify(snapshot(9)) }
      }
      throw new Error(`Unexpected runtime request: ${method} ${path}`)
    })
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })

    try {
      const result = await commitSharedModelConnectionCatalog(
        'gemini-cli-subscription',
        pending,
        () => false,
        { provider: geminiProvider }
      )
      expect(result.revision).toBe(9)
      const connectCall = runtimeRequest.mock.calls.find(
        ([path, method]) => path === '/v1/model-connections/connect' && method === 'POST'
      )
      expect(connectCall).toBeDefined()
      const connectBody = JSON.parse(connectCall![2] as string) as Record<string, unknown>
      expect(connectBody.kind).toBe('gemini-cli-api')
      expect(connectBody).not.toHaveProperty('baseUrl')
      expect(connectBody).not.toHaveProperty('credential')
      expect(connectBody.models).toEqual(['gemini-3.7-pro-preview', 'gemini-3.1-pro-preview'])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
