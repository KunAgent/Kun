import type {
  ModelProviderModelProfileV1,
  ModelProviderProfileV1
} from '@shared/app-settings'

export type PendingSharedProviderName = {
  generation?: number
  localName: string
  canonicalName: string
  localBaseUrl?: string
  localEndpointFormat?: ModelProviderProfileV1['endpointFormat']
  committedRevision: number | null
}

export type PendingSharedProviderCatalog = {
  generation: number
  localProviderName?: string
  localProviderBaseUrl?: string
  localProviderEndpointFormat?: ModelProviderProfileV1['endpointFormat']
  localProviderKind?: ModelProviderProfileV1['kind']
  baseModels: string[]
  baseModelProfiles: Record<string, ModelProviderModelProfileV1>
  localModels: string[]
  localModelProfiles: Record<string, ModelProviderModelProfileV1>
  committedRevision: number | null
}

export type PendingSharedProviderCredential = {
  generation: number
  operationToken: string
  credential: string
  fence?: Promise<boolean | void>
  fenceOperation?: (operationToken: string) => Promise<boolean | void>
}

export type SharedProviderCredentialRetryState = {
  attempts: number
  lastError: string
  nextRetryAt: number
}

export function credentialRetryDelayMs(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(1_000 * (2 ** Math.max(0, attempts - 1)), 30_000)
  return Math.min(30_000, Math.round(base * (0.8 + (random() * 0.4))))
}

export function isCredentialRetryableError(error: unknown): boolean {
  if (error instanceof TypeError) return true
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? (error as { status?: unknown }).status
    : undefined
  return typeof status !== 'number' || status === 408 || status === 409 || status === 429 || status >= 500
}

export type PendingSharedProviderDeletion = {
  generation: number
  committedRevision: number | null
}

export type SharedProviderMutationTimer = {
  owner: symbol
  timer: ReturnType<typeof setTimeout>
}

export const sharedProviderMutationCoordinator = {
  pendingDeletions: new Map<string, PendingSharedProviderDeletion>(),
  pendingNames: new Map<string, PendingSharedProviderName>(),
  pendingCatalogs: new Map<string, PendingSharedProviderCatalog>(),
  pendingCredentials: new Map<string, PendingSharedProviderCredential>(),
  catalogTimers: new Map<string, SharedProviderMutationTimer>(),
  credentialTimers: new Map<string, SharedProviderMutationTimer>(),
  credentialRetryStates: new Map<string, SharedProviderCredentialRetryState>(),
  profileGeneration: 0,
  deletionGeneration: 0,
  catalogGeneration: 0,
  credentialGeneration: 0
}

let mutationTail: Promise<void> = Promise.resolve()
const catalogDrains = new Map<string, { generation: number; promise: Promise<unknown> }>()
const credentialMutationClientId = createCredentialMutationClientId()

export function enqueueSharedModelMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationTail.then(operation, operation)
  mutationTail = result.then(() => undefined, () => undefined)
  return result
}

export function drainSharedProviderCatalogMutation<T>(
  providerId: string,
  generation: number,
  operation: () => Promise<T>
): Promise<T> {
  const existing = catalogDrains.get(providerId)
  if (existing?.generation === generation) return existing.promise as Promise<T>
  const promise = enqueueSharedModelMutation(operation)
  catalogDrains.set(providerId, { generation, promise })
  void promise.finally(() => {
    if (catalogDrains.get(providerId)?.generation === generation) catalogDrains.delete(providerId)
  }).catch(() => undefined)
  return promise
}

/** True while a staged catalog commit is running on the shared mutation queue. */
export function hasInFlightSharedProviderCatalogMutation(): boolean {
  return catalogDrains.size > 0
}

export function stageSharedProviderCredentialMutation(
  providerId: string,
  credential: string,
  fence?: (operationToken: string) => Promise<boolean | void>
): PendingSharedProviderCredential {
  const generation = sharedProviderMutationCoordinator.credentialGeneration + 1
  const operationToken = credentialOperationToken(generation)
  const pending: PendingSharedProviderCredential = {
    generation,
    operationToken,
    credential
  }
  sharedProviderMutationCoordinator.credentialGeneration = pending.generation
  sharedProviderMutationCoordinator.pendingCredentials.set(providerId, pending)
  sharedProviderMutationCoordinator.credentialRetryStates.delete(providerId)
  if (fence) {
    pending.fenceOperation = fence
    pending.fence = fence(operationToken)
    void pending.fence.catch(() => undefined)
  }
  return pending
}

export async function drainSharedProviderCredentialMutation<T>(
  providerId: string,
  generation: number,
  operation: (
    credential: string,
    operationToken: string,
    isCurrent: () => boolean,
    fenceInstalled: boolean
  ) => Promise<T>
): Promise<{ value: T; committed: boolean } | null> {
  return enqueueSharedModelMutation(async () => {
    const pending = sharedProviderMutationCoordinator.pendingCredentials.get(providerId)
    if (!pending || pending.generation !== generation) return null
    let fenceInstalled: boolean | void
    try {
      fenceInstalled = await pending.fence
    } catch (error) {
      if (!pending.fenceOperation) throw error
      pending.fence = pending.fenceOperation(pending.operationToken)
      void pending.fence.catch(() => undefined)
      fenceInstalled = await pending.fence
    }
    if (sharedProviderMutationCoordinator.pendingCredentials.get(providerId)?.generation !== generation) {
      return null
    }
    const isCurrent = (): boolean =>
      sharedProviderMutationCoordinator.pendingCredentials.get(providerId)?.generation === generation
    const value = await operation(
      pending.credential,
      pending.operationToken,
      isCurrent,
      fenceInstalled === true
    )
    const current = sharedProviderMutationCoordinator.pendingCredentials.get(providerId)
    const committed = current?.generation === generation
    if (committed) {
      sharedProviderMutationCoordinator.pendingCredentials.delete(providerId)
      sharedProviderMutationCoordinator.credentialRetryStates.delete(providerId)
    }
    return { value, committed }
  })
}

function credentialOperationToken(generation: number): string {
  return `credential:${credentialMutationClientId}:${generation}`
}

function createCredentialMutationClientId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  const bytes = new Uint8Array(16)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function replaceMapContents<K, V>(target: Map<K, V>, source: ReadonlyMap<K, V>): void {
  target.clear()
  for (const [key, value] of source) target.set(key, value)
}

/** Test-only reset for module state that intentionally survives React remounts. */
export function resetSharedProviderMutationCoordinatorForTests(): void {
  for (const record of sharedProviderMutationCoordinator.catalogTimers.values()) clearTimeout(record.timer)
  for (const record of sharedProviderMutationCoordinator.credentialTimers.values()) clearTimeout(record.timer)
  sharedProviderMutationCoordinator.pendingDeletions.clear()
  sharedProviderMutationCoordinator.pendingNames.clear()
  sharedProviderMutationCoordinator.pendingCatalogs.clear()
  sharedProviderMutationCoordinator.pendingCredentials.clear()
  sharedProviderMutationCoordinator.credentialRetryStates.clear()
  sharedProviderMutationCoordinator.catalogTimers.clear()
  sharedProviderMutationCoordinator.credentialTimers.clear()
  sharedProviderMutationCoordinator.profileGeneration = 0
  sharedProviderMutationCoordinator.deletionGeneration = 0
  sharedProviderMutationCoordinator.catalogGeneration = 0
  sharedProviderMutationCoordinator.credentialGeneration = 0
  catalogDrains.clear()
  mutationTail = Promise.resolve()
}
