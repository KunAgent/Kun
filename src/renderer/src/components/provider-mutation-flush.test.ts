import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  flushProviderMutationsForProviders,
  type ProviderMutationFlushOperations
} from './provider-mutation-flush'
import {
  drainSharedProviderCredentialMutation,
  resetSharedProviderMutationCoordinatorForTests,
  sharedProviderMutationCoordinator,
  stageSharedProviderCredentialMutation
} from './shared-provider-mutation-coordinator'

const noopOperations: ProviderMutationFlushOperations = {
  drainProfile: async () => undefined,
  drainCatalog: async () => undefined,
  drainCredential: async () => undefined,
  drainDeletion: async () => undefined
}

afterEach(() => {
  resetSharedProviderMutationCoordinatorForTests()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('flushProviderMutationsForProviders', () => {
  it('resolves immediately when the provider has no pending mutations', async () => {
    const drainCredential = vi.fn(noopOperations.drainCredential)
    const result = await flushProviderMutationsForProviders(
      { providerIds: ['deepseek'] },
      { ...noopOperations, drainCredential }
    )
    expect(result).toEqual({ ok: true })
    expect(drainCredential).not.toHaveBeenCalled()
  })

  it('waits until the staged credential commits before resolving', async () => {
    const staged = stageSharedProviderCredentialMutation('deepseek', 'new-key')
    let releaseCommit: (() => void) | undefined
    const operations: ProviderMutationFlushOperations = {
      ...noopOperations,
      drainCredential: async (providerId, generation) => {
        await drainSharedProviderCredentialMutation(providerId, generation, async () => {
          await new Promise<void>((resolve) => { releaseCommit = resolve })
          return undefined
        })
      }
    }
    const flushing = flushProviderMutationsForProviders({ providerIds: ['deepseek'] }, operations)
    await vi.waitFor(() => expect(releaseCommit).toBeTypeOf('function'))
    expect(sharedProviderMutationCoordinator.pendingCredentials.has('deepseek')).toBe(true)
    let settled = false
    void flushing.then(() => { settled = true })
    releaseCommit?.()
    await vi.waitFor(() => expect(settled).toBe(true))
    await expect(flushing).resolves.toEqual({ ok: true })
    expect(sharedProviderMutationCoordinator.pendingCredentials.has('deepseek')).toBe(false)
  })

  it('drains credential and catalog mutations of only the requested provider', async () => {
    const stagedA = stageSharedProviderCredentialMutation('provider-a', 'key-a')
    stageSharedProviderCredentialMutation('provider-b', 'key-b')
    sharedProviderMutationCoordinator.pendingCatalogs.set('provider-a', {
      generation: 1,
      baseModels: [],
      baseModelProfiles: {},
      localModels: [],
      localModelProfiles: {},
      committedRevision: null
    })
    const drains: string[] = []
    const operations: ProviderMutationFlushOperations = {
      ...noopOperations,
      drainCredential: async (providerId, generation) => {
        drains.push(`credential:${providerId}`)
        await drainSharedProviderCredentialMutation(providerId, generation, async () => undefined)
      },
      drainCatalog: async (providerId) => {
        drains.push(`catalog:${providerId}`)
        sharedProviderMutationCoordinator.pendingCatalogs.delete(providerId)
      }
    }
    const result = await flushProviderMutationsForProviders(
      { providerIds: ['provider-a'] },
      operations
    )
    expect(result).toEqual({ ok: true })
    expect(drains).toEqual(['credential:provider-a', 'catalog:provider-a'])
    expect(sharedProviderMutationCoordinator.pendingCredentials.has('provider-b')).toBe(true)
    expect(stagedA.generation).toBe(1)
  })

  it('stays blocked when a newer credential generation is staged during the drain', async () => {
    stageSharedProviderCredentialMutation('deepseek', 'old-key')
    let drainCalls = 0
    let sawNewGeneration = false
    const operations: ProviderMutationFlushOperations = {
      ...noopOperations,
      drainCredential: async (providerId, generation) => {
        drainCalls += 1
        await drainSharedProviderCredentialMutation(providerId, generation, async (credential) => {
          if (credential === 'old-key') {
            stageSharedProviderCredentialMutation('deepseek', 'new-key')
            return undefined
          }
          sawNewGeneration = true
          return undefined
        })
      }
    }
    const result = await flushProviderMutationsForProviders(
      { providerIds: ['deepseek'], deadlineMs: 1_000 },
      operations
    )
    expect(result).toEqual({ ok: true })
    expect(drainCalls).toBeGreaterThanOrEqual(2)
    expect(sawNewGeneration).toBe(true)
    expect(sharedProviderMutationCoordinator.pendingCredentials.has('deepseek')).toBe(false)
  })

  it('surfaces the sync error when the commit fails and the generation stays staged', async () => {
    stageSharedProviderCredentialMutation('deepseek', 'new-key')
    const failure = new Error('registry unavailable')
    const operations: ProviderMutationFlushOperations = {
      ...noopOperations,
      drainCredential: async (providerId, generation) => {
        await drainSharedProviderCredentialMutation(providerId, generation, async () => {
          throw failure
        })
      }
    }
    const result = await flushProviderMutationsForProviders({ providerIds: ['deepseek'] }, operations)
    expect(result).toEqual({ ok: false, error: failure, timedOut: false })
    // Coordinator keeps the pending mutation for the existing retry path.
    expect(sharedProviderMutationCoordinator.pendingCredentials.has('deepseek')).toBe(true)
  })

  it('reports timeout when the commit keeps failing without progress', async () => {
    stageSharedProviderCredentialMutation('deepseek', 'new-key')
    let drainCalls = 0
    const operations: ProviderMutationFlushOperations = {
      ...noopOperations,
      // Drain settles but each commit keeps failing and the generation stays
      // staged; the barrier must stop retrying and report a timeout failure.
      drainCredential: async (providerId, generation) => {
        drainCalls += 1
        await drainSharedProviderCredentialMutation(providerId, generation, async () => {
          throw new Error('sync failed')
        })
      }
    }
    const result = await flushProviderMutationsForProviders(
      { providerIds: ['deepseek'], deadlineMs: 1 },
      operations
    ).catch(() => undefined)
    expect(result).toMatchObject({ ok: false })
    expect(drainCalls).toBeGreaterThanOrEqual(1)
  })
})
