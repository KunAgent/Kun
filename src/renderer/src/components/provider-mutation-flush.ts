import type {
  ProviderMutationFlushRequest,
  ProviderMutationFlushRequestHandler,
  ProviderMutationFlushResult
} from '@shared/provider-mutation-barrier'
import {
  drainSharedProviderCatalogMutation,
  drainSharedProviderCredentialMutation,
  enqueueSharedModelMutation,
  sharedProviderMutationCoordinator
} from './shared-provider-mutation-coordinator'

export type ProviderMutationFlushOperations = {
  drainProfile: (providerId: string) => Promise<void>
  drainCatalog: (providerId: string, generation: number) => Promise<void>
  drainCredential: (providerId: string, generation: number) => Promise<void>
  drainDeletion: (providerId: string) => Promise<void>
}

export type ProviderMutationKinds = ProviderMutationFlushResult['mutationKinds'][number]

export type ProviderMutationBarrierRequest = {
  providerIds: string[]
  mutationKinds?: ProviderMutationKinds[]
  deadlineMs?: number
}

let currentOperations: ProviderMutationFlushOperations | null = null
let installed: (() => void) | null = null

export function registerProviderMutationFlushOperations(
  operations: ProviderMutationFlushOperations
): () => void {
  currentOperations = operations
  return () => {
    if (currentOperations === operations) currentOperations = null
  }
}

/**
 * Provider-scoped mutation barrier: waits until the given providers have no
 * staged credential/catalog mutations left (or the deadline passes). Only
 * registered drain operations run; staging state lives in the coordinator.
 * Returns null when the barrier is clean, or the sync error that blocked it.
 */
export async function flushProviderMutationsForProviders(
  request: ProviderMutationBarrierRequest,
  operations: ProviderMutationFlushOperations
): Promise<{ ok: true } | { ok: false; error: unknown; timedOut: boolean }> {
  const providerIds = new Set(request.providerIds)
  const kinds = new Set(request.mutationKinds ?? (['credential', 'catalog'] as ProviderMutationKinds[]))
  const deadline = Date.now() + Math.max(1, request.deadlineMs ?? 10_000)
  const outstandingCredential = (providerId: string): number | null => {
    if (!kinds.has('credential')) return null
    return sharedProviderMutationCoordinator.pendingCredentials.get(providerId)?.generation ?? null
  }
  const outstandingCatalog = (providerId: string): number | null => {
    if (!kinds.has('catalog')) return null
    const pending = sharedProviderMutationCoordinator.pendingCatalogs.get(providerId)
    if (!pending || pending.committedRevision !== null) return null
    return pending.generation
  }
  const drainOne = async (
    drain: () => Promise<void>,
    outstanding: () => number | null,
    stagedGeneration: number
  ): Promise<unknown | undefined> => {
    try {
      await drain()
      return undefined
    } catch (error) {
      // Same generation still staged means the commit itself failed (the
      // coordinator keeps it for the existing retry path). Surface the sync
      // error instead of hammering the provider; a newer generation staged
      // during the drain falls through and is drained on the next round.
      if (outstanding() === stagedGeneration) return error
      return undefined
    }
  }
  try {
    // Re-check the coordinator after each drain round: staging a newer
    // credential during the barrier must keep the provider blocked until
    // that generation commits (or the deadline passes).
    for (let round = 0; round < 20; round += 1) {
      let drained = false
      for (const providerId of providerIds) {
        const credentialGeneration = outstandingCredential(providerId)
        if (credentialGeneration !== null) {
          const failure = await drainOne(
            () => operations.drainCredential(providerId, credentialGeneration),
            () => outstandingCredential(providerId),
            credentialGeneration
          )
          if (failure !== undefined) return { ok: false, error: failure, timedOut: false }
          drained = true
        }
        const catalogGeneration = outstandingCatalog(providerId)
        if (catalogGeneration !== null) {
          const failure = await drainOne(
            () => operations.drainCatalog(providerId, catalogGeneration),
            () => outstandingCatalog(providerId),
            catalogGeneration
          )
          if (failure !== undefined) return { ok: false, error: failure, timedOut: false }
          drained = true
        }
      }
      // Let any queued debounced/timer drains settle before re-reading state.
      await enqueueSharedModelMutation(async () => undefined)
      const stillOutstanding = [...providerIds].some(
        (providerId) => outstandingCredential(providerId) !== null || outstandingCatalog(providerId) !== null
      )
      if (!stillOutstanding) return { ok: true }
      if (Date.now() >= deadline) return { ok: false, error: new Error('Provider mutation flush timed out'), timedOut: true }
      if (!drained) await new Promise((resolve) => setTimeout(resolve, 10))
    }
    return { ok: false, error: new Error('Provider mutation flush timed out'), timedOut: true }
  } catch (error) {
    return { ok: false, error, timedOut: false }
  }
}

export function installProviderMutationFlushHandler(): () => void {
  installed?.()
  const handler: ProviderMutationFlushRequestHandler = async (request) => {
    if (!currentOperations) {
      return {
        requestId: request.requestId,
        ok: false,
        pendingProviderIds: [],
        mutationKinds: [],
        errorCode: 'renderer-unavailable'
      }
    }
    return flushAllPendingProviderMutations(request, currentOperations)
  }
  installed = window.kunGui.onProviderMutationFlushRequest(handler)
  return () => {
    installed?.()
    installed = null
  }
}

/** Probe-facing barrier: uses the operations registered by the providers settings section. */
export async function flushProviderMutations(
  request: ProviderMutationBarrierRequest
): Promise<{ ok: true } | { ok: false; error: unknown; timedOut: boolean }> {
  if (!currentOperations) return { ok: true }
  return flushProviderMutationsForProviders(request, currentOperations)
}

export async function flushAllPendingProviderMutations(
  request: ProviderMutationFlushRequest,
  operations: ProviderMutationFlushOperations
): Promise<ProviderMutationFlushResult> {
  const pendingProviderIds = new Set<string>()
  const mutationKinds = new Set<ProviderMutationFlushResult['mutationKinds'][number]>()
  const deadline = Date.now() + Math.max(1, request.deadlineMs)
  const run = async (providerId: string, kind: ProviderMutationFlushResult['mutationKinds'][number], action: () => Promise<void>) => {
    if (Date.now() >= deadline) return
    pendingProviderIds.add(providerId)
    mutationKinds.add(kind)
    await action()
  }
  const collectOutstanding = (): void => {
    pendingProviderIds.clear()
    for (const [providerId, pending] of sharedProviderMutationCoordinator.pendingNames) {
      if (pending.committedRevision === null) pendingProviderIds.add(providerId)
    }
    for (const [providerId, pending] of sharedProviderMutationCoordinator.pendingCatalogs) {
      if (pending.committedRevision === null) pendingProviderIds.add(providerId)
    }
    for (const providerId of sharedProviderMutationCoordinator.pendingCredentials.keys()) {
      pendingProviderIds.add(providerId)
    }
    for (const [providerId, pending] of sharedProviderMutationCoordinator.pendingDeletions) {
      if (pending.committedRevision === null) pendingProviderIds.add(providerId)
    }
  }
  try {
    do {
      for (const [providerId, pending] of [...sharedProviderMutationCoordinator.pendingNames]) {
        if (pending.committedRevision === null) await run(providerId, 'profile', () => operations.drainProfile(providerId))
      }
      for (const [providerId, pending] of [...sharedProviderMutationCoordinator.pendingCatalogs]) {
        if (pending.committedRevision === null) await run(providerId, 'catalog', () => operations.drainCatalog(providerId, pending.generation))
      }
      for (const [providerId, pending] of [...sharedProviderMutationCoordinator.pendingCredentials]) {
        await run(providerId, 'credential', () => operations.drainCredential(providerId, pending.generation))
      }
      for (const [providerId, pending] of [...sharedProviderMutationCoordinator.pendingDeletions]) {
        if (pending.committedRevision === null) await run(providerId, 'deletion', () => operations.drainDeletion(providerId))
      }
      await enqueueSharedModelMutation(async () => undefined)
      collectOutstanding()
      if (pendingProviderIds.size > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    } while (pendingProviderIds.size > 0 && Date.now() < deadline)
    const timedOut = pendingProviderIds.size > 0
    return {
      requestId: request.requestId,
      ok: !timedOut && pendingProviderIds.size === 0,
      pendingProviderIds: [...pendingProviderIds].sort(),
      mutationKinds: [...mutationKinds].sort(),
      ...(timedOut ? { errorCode: 'timeout' as const } : {})
    }
  } catch {
    return {
      requestId: request.requestId,
      ok: false,
      pendingProviderIds: [...pendingProviderIds].sort(),
      mutationKinds: [...mutationKinds].sort(),
      errorCode: 'flush-failed'
    }
  }
}
