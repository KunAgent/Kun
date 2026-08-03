import { describe, expect, it, vi } from 'vitest'
import { defaultModelProviderSettings } from '@shared/app-settings'
import {
  clearPendingSharedProviderDeletionForExplicitAdd,
  createSharedModelMutationQueue,
  deleteSharedModelConnection,
  projectSharedModelConnections,
  reconcilePendingSharedProviderDeletions,
  reconcilePendingSharedProviderNames,
  selectSharedModelConnection,
  sharedProvidersEligibleForSync,
  sharedProviderSetupNeedsApiKey
} from './settings-section-providers'

describe('shared model connection API-key setup status', () => {
  it('accepts a credential held only by the protected shared registry', () => {
    const providers = defaultModelProviderSettings().providers

    expect(sharedProviderSetupNeedsApiKey(providers, {
      schemaVersion: 1,
      revision: 1,
      providers: [{
        id: 'deepseek',
        accountId: 'account:deepseek',
        name: 'DeepSeek',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://api.deepseek.com',
        endpointFormat: 'chat_completions',
        configured: true,
        models: ['deepseek-chat']
      }]
    })).toBe(false)
  })

  it('requests setup only after the shared registry confirms no credential', () => {
    const providers = defaultModelProviderSettings().providers

    expect(sharedProviderSetupNeedsApiKey(providers, null)).toBe(false)
    expect(sharedProviderSetupNeedsApiKey(providers, {
      schemaVersion: 1,
      revision: 1,
      providers: [{
        id: 'deepseek',
        accountId: 'account:deepseek',
        name: 'DeepSeek',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://api.deepseek.com',
        endpointFormat: 'chat_completions',
        configured: false,
        models: ['deepseek-chat']
      }]
    })).toBe(true)
  })
})

describe('shared model connection deletion', () => {
  it('removes the canonical connection and retries one concurrent revision change', async () => {
    const connection = {
      id: 'custom-provider-2',
      accountId: 'account:custom-provider-2',
      name: 'Custom Provider',
      kind: 'http' as const,
      authType: 'api-key' as const,
      baseUrl: 'https://api.example.com/v1',
      endpointFormat: 'chat_completions' as const,
      configured: true,
      models: ['custom-model']
    }
    const snapshot = (revision: number, providers = [connection]) => ({
      schemaVersion: 1 as const,
      revision,
      providers
    })
    const runtimeRequest = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, body: JSON.stringify(snapshot(3)) })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        body: JSON.stringify({ snapshot: snapshot(4) })
      })
      .mockResolvedValueOnce({ ok: true, status: 200, body: JSON.stringify(snapshot(5, [])) })
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })

    try {
      await expect(deleteSharedModelConnection(connection.id)).resolves.toMatchObject({
        revision: 5,
        providers: []
      })
      expect(runtimeRequest.mock.calls.map(([path, method]) => [path, method])).toEqual([
        ['/v1/model-connections', 'GET'],
        ['/v1/model-connections/custom-provider-2?expected_revision=3', 'DELETE'],
        ['/v1/model-connections/custom-provider-2?expected_revision=4', 'DELETE']
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('treats a concurrent deletion as an idempotent success', async () => {
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
    const runtimeRequest = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: JSON.stringify({ schemaVersion: 1, revision: 9, providers: [connection] })
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        body: JSON.stringify({ snapshot: { schemaVersion: 1, revision: 10, providers: [] } })
      })
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })

    try {
      await expect(deleteSharedModelConnection(connection.id)).resolves.toMatchObject({
        revision: 10,
        providers: []
      })
      expect(runtimeRequest).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('shared model connection selection', () => {
  const connection = (revisionName = 'account:custom-provider-2') => ({
    id: 'custom-provider-2',
    accountId: revisionName,
    name: 'Custom Provider',
    kind: 'http' as const,
    authType: 'api-key' as const,
    baseUrl: 'https://api.example.com/v1',
    endpointFormat: 'chat_completions' as const,
    configured: true,
    models: ['custom-model']
  })
  const snapshot = (revision: number, providers = [connection()]) => ({
    schemaVersion: 1 as const,
    revision,
    providers
  })

  it('reads the latest revision and retries one selection conflict with the refreshed account', async () => {
    const runtimeRequest = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, body: JSON.stringify(snapshot(7)) })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        body: JSON.stringify({ snapshot: snapshot(8, [connection('account:refreshed')]) })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: JSON.stringify({
          ...snapshot(9, [connection('account:refreshed')]),
          defaultProviderId: 'custom-provider-2',
          defaultAccountId: 'account:refreshed',
          defaultModel: 'custom-model'
        })
      })
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })

    try {
      await expect(selectSharedModelConnection('custom-provider-2', 'custom-model'))
        .resolves.toMatchObject({ revision: 9, defaultAccountId: 'account:refreshed' })
      expect(runtimeRequest.mock.calls.map(([path, method, body]) => [
        path,
        method,
        body ? JSON.parse(body) : undefined
      ])).toEqual([
        ['/v1/model-connections', 'GET', undefined],
        ['/v1/model-connections/select', 'POST', {
          expectedRevision: 7,
          providerId: 'custom-provider-2',
          accountId: 'account:custom-provider-2',
          model: 'custom-model'
        }],
        ['/v1/model-connections/select', 'POST', {
          expectedRevision: 8,
          providerId: 'custom-provider-2',
          accountId: 'account:refreshed',
          model: 'custom-model'
        }]
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not select a provider that is tombstoned or absent from the latest registry', async () => {
    const runtimeRequest = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, body: JSON.stringify(snapshot(11)) })
      .mockResolvedValueOnce({ ok: true, status: 200, body: JSON.stringify(snapshot(12, [])) })
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })

    try {
      await expect(selectSharedModelConnection(
        'custom-provider-2',
        'custom-model',
        () => true
      )).rejects.toThrow(/pending deletion/)
      await expect(selectSharedModelConnection('custom-provider-2', 'custom-model'))
        .rejects.toThrow(/no longer available/)
      expect(runtimeRequest.mock.calls.every(([, method]) => method === 'GET')).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

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
    const pending = new Map<string, number | null>([[connection.id, 5]])

    expect(reconcilePendingSharedProviderDeletions(snapshot(4), pending).has(connection.id)).toBe(true)
    expect(reconcilePendingSharedProviderDeletions(snapshot(5), pending).has(connection.id)).toBe(true)
    expect(reconcilePendingSharedProviderDeletions(snapshot(6), pending).has(connection.id)).toBe(false)
    expect(pending.get(connection.id)).toBe(5)
  })

  it('keeps an uncommitted tombstone even when a stale snapshot omits the provider', () => {
    const pending = new Map<string, number | null>([[connection.id, null]])

    expect(reconcilePendingSharedProviderDeletions(snapshot(20), pending).has(connection.id)).toBe(true)
    expect(reconcilePendingSharedProviderDeletions(snapshot(20, []), pending).has(connection.id)).toBe(true)
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
      new Set(),
      pending(null)
    )

    expect(projected.provider.providers.find((item) => item.id === 'custom-provider-2')?.name)
      .toBe('Renamed Provider')
  })
})

describe('shared model connection mutation ordering', () => {
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
    const pendingDeletions = new Map<string, number | null>([[provider.id, 17]])

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
      revision: 4,
      providers: [{
        id: 'codex',
        accountId: 'account:codex',
        name: 'Codex',
        kind: 'http',
        authType: 'subscription',
        baseUrl: 'https://example.test/codex',
        endpointFormat: 'responses',
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

  it('preserves an existing provider credential while applying shared metadata', () => {
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
      revision: 7,
      providers: [{
        id: 'custom',
        accountId: 'account:custom',
        name: 'Shared name',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://new.example/v1',
        endpointFormat: 'chat_completions',
        configured: true,
        models: ['new-model']
      }]
    })

    expect(projected.provider.providers.find((provider) => provider.id === 'custom')).toMatchObject({
      apiKey: 'protected-runtime-value',
      baseUrl: 'https://new.example/v1',
      models: ['new-model']
    })
  })

  it('clears the GUI default when the last shared connection is removed', () => {
    const projected = projectSharedModelConnections(defaultModelProviderSettings(), {
      schemaVersion: 1,
      revision: 5,
      providers: [],
      proxy: { enabled: false, url: '' },
      routePools: [],
      localModelGateway: { enabled: false }
    })

    expect(projected.kun).toEqual({ providerId: '', model: '' })
  })

  it('does not restore a provider while its canonical deletion is pending', () => {
    const current = defaultModelProviderSettings()
    const projected = projectSharedModelConnections(current, {
      schemaVersion: 1,
      revision: 8,
      providers: [{
        id: 'custom-provider-2',
        accountId: 'account:custom-provider-2',
        name: 'Custom Provider',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://api.example.com/v1',
        endpointFormat: 'chat_completions',
        configured: true,
        models: ['custom-model'],
        selectedModel: 'custom-model'
      }],
      defaultProviderId: 'custom-provider-2',
      defaultAccountId: 'account:custom-provider-2',
      defaultModel: 'custom-model'
    }, new Set(['custom-provider-2']))

    expect(projected.provider.providers.map((provider) => provider.id)).toEqual(['deepseek'])
    expect(projected.kun).toEqual({ providerId: '', model: '' })
  })
})
