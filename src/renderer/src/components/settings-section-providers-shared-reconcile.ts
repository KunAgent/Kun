import type {
  ModelProviderModelProfileV1,
  ModelProviderProfileV1,
  ModelProviderSettingsV1
} from '@shared/app-settings'
import {
  DEFAULT_MODEL_PROVIDER_ID,
  MAX_MODEL_CONTEXT_WINDOW_TOKENS,
  MAX_MODEL_OUTPUT_TOKENS,
  defaultModelRequestRetrySettings,
  resolveModelProviderPresetSource
} from '@shared/app-settings'
import {
  modelProviderRequiresApiKey
} from '@shared/app-settings-provider-core'
import {
  type PendingSharedProviderCatalog,
  type PendingSharedProviderDeletion,
  type PendingSharedProviderName
} from './shared-provider-mutation-coordinator'

export { sharedModelConnectionHasUsableCredential } from '../lib/provider-credential-readiness'

import { isSubscriptionProvider } from './settings-section-providers-profile'
import {
  SharedModelConnectionConflictError,
  requestSharedModelConnections,
  type ProjectedKunSelectionPatch,
  type SharedModelConnection,
  type SharedModelConnectionsSnapshot
} from './settings-section-providers-shared-api'

/** Kinds that authenticate through their own CLI/SDK login instead of a
 * user-entered baseUrl. `gemini-cli-api` always targets Google's Code Assist
 * endpoint from the runtime client, so its AppSettings baseUrl stays empty. */
export function sharedConnectionBaseUrlOptional(kind: string | undefined): boolean {
  return kind === 'agent-sdk' ||
    kind === 'antigravity-cli' ||
    kind === 'gemini-cli-api' ||
    kind === 'gemini-code-assist' ||
    kind === 'cursor-sdk'
}

export function reconcilePendingSharedProviderDeletions(
  snapshot: SharedModelConnectionsSnapshot,
  pending: ReadonlyMap<string, PendingSharedProviderDeletion>,
  localProviderIds: Pick<ReadonlySet<string>, 'has'> = new Set<string>()
): Map<string, PendingSharedProviderDeletion> {
  const next = new Map(pending)
  for (const [providerId, deletion] of next) {
    if (
      deletion.committedRevision !== null &&
      snapshot.revision > deletion.committedRevision &&
      !localProviderIds.has(providerId)
    ) {
      next.delete(providerId)
    }
  }
  return next
}

export function reconcilePendingSharedProviderNames(
  snapshot: SharedModelConnectionsSnapshot,
  pending: ReadonlyMap<string, PendingSharedProviderName>
): Map<string, PendingSharedProviderName> {
  const next = new Map(pending)
  for (const [providerId, rename] of next) {
    const connection = snapshot.providers.find((item) => item.id === providerId)
    if (!connection) {
      next.delete(providerId)
      continue
    }
    const canonicalProfileObserved =
      connection.name === rename.canonicalName &&
      (rename.localBaseUrl === undefined || (connection.baseUrl ?? '') === rename.localBaseUrl) &&
      (rename.localEndpointFormat === undefined || connection.endpointFormat === rename.localEndpointFormat)
    const committedRevisionPassed =
      rename.committedRevision !== null && snapshot.revision > rename.committedRevision
    if (canonicalProfileObserved || committedRevisionPassed) {
      next.delete(providerId)
    }
  }
  return next
}

export function normalizedModelId(model: string): string {
  return model.trim().toLowerCase()
}

export function modelProfileFor(
  profiles: Readonly<Record<string, ModelProviderModelProfileV1>>,
  model: string
): ModelProviderModelProfileV1 | undefined {
  return profiles[model] ?? profiles[normalizedModelId(model)]
}

export function wireModelCapability(
  model: string,
  profile: ModelProviderModelProfileV1 | undefined
): NonNullable<SharedModelConnection['modelCapabilities']>[string] | undefined {
  if (!profile) return undefined
  const { aliases: _aliases, ...capability } = profile
  return { id: model, ...capability }
}

export function catalogCapabilities(
  models: readonly string[],
  profiles: Readonly<Record<string, ModelProviderModelProfileV1>>
): NonNullable<SharedModelConnection['modelCapabilities']> {
  return Object.fromEntries(models.flatMap((model) => {
    const capability = wireModelCapability(model, modelProfileFor(profiles, model))
    return capability ? [[model, capability]] : []
  }))
}

export function sameCatalogCapabilities(
  left: SharedModelConnection['modelCapabilities'],
  right: SharedModelConnection['modelCapabilities']
): boolean {
  return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {})
}

export function reconcilePendingSharedProviderCatalogs(
  snapshot: SharedModelConnectionsSnapshot,
  pending: ReadonlyMap<string, PendingSharedProviderCatalog>
): Map<string, PendingSharedProviderCatalog> {
  const next = new Map(pending)
  for (const [providerId, catalog] of next) {
    const connection = snapshot.providers.find((item) => item.id === providerId)
    if (!connection) {
      if (catalog.committedRevision !== null && snapshot.revision > catalog.committedRevision) {
        next.delete(providerId)
      }
      continue
    }
    const canonicalObserved =
      (catalog.localProviderName === undefined || connection.name === (catalog.localProviderName.trim() || providerId)) &&
      (catalog.localProviderBaseUrl === undefined || (connection.baseUrl ?? '') === catalog.localProviderBaseUrl) &&
      (catalog.localProviderEndpointFormat === undefined ||
        connection.endpointFormat === catalog.localProviderEndpointFormat) &&
      (catalog.localProviderKind === undefined || connection.kind === (catalog.localProviderKind ?? 'http')) &&
      JSON.stringify(connection.models) === JSON.stringify(catalog.localModels) &&
      sameCatalogCapabilities(
        connection.modelCapabilities,
        catalogCapabilities(catalog.localModels, catalog.localModelProfiles)
      ) && (
        catalog.committedRevision === null || snapshot.revision >= catalog.committedRevision
      )
    const committedRevisionPassed =
      catalog.committedRevision !== null && snapshot.revision > catalog.committedRevision
    if (canonicalObserved || committedRevisionPassed) next.delete(providerId)
  }
  return next
}

export function applyPendingSharedProviderCatalog(
  connection: SharedModelConnection,
  pending: PendingSharedProviderCatalog
): Pick<SharedModelConnection, 'models' | 'modelCapabilities' | 'selectedModel'> {
  const baseKeys = new Set(pending.baseModels.map(normalizedModelId))
  const localByKey = new Map(pending.localModels.map((model) => [normalizedModelId(model), model]))
  const removedKeys = new Set(
    pending.baseModels
      .map(normalizedModelId)
      .filter((model) => !localByKey.has(model))
  )
  const models = connection.models.filter((model) => !removedKeys.has(normalizedModelId(model)))
  const modelKeys = new Set(models.map(normalizedModelId))
  for (const model of pending.localModels) {
    const key = normalizedModelId(model)
    if (!baseKeys.has(key) && !modelKeys.has(key)) {
      models.push(model)
      modelKeys.add(key)
    }
  }

  const modelCapabilities: NonNullable<SharedModelConnection['modelCapabilities']> = {}
  for (const model of models) {
    const key = normalizedModelId(model)
    const latestCapability = connection.modelCapabilities?.[model] ?? connection.modelCapabilities?.[key]
    const baseProfile = modelProfileFor(pending.baseModelProfiles, model)
    const localProfile = modelProfileFor(pending.localModelProfiles, localByKey.get(key) ?? model)
    const localCapability = wireModelCapability(model, localProfile)
    const baseCapability = wireModelCapability(model, baseProfile)
    const locallyChanged = !baseKeys.has(key) || !sameCatalogCapabilities(
      baseCapability ? { [model]: baseCapability } : undefined,
      localCapability ? { [model]: localCapability } : undefined
    )
    const capability = locallyChanged ? localCapability : latestCapability
    if (capability) modelCapabilities[model] = { ...capability, id: model }
  }

  const selectedModel = connection.selectedModel && modelKeys.has(normalizedModelId(connection.selectedModel))
    ? connection.selectedModel
    : models[0]
  return {
    models,
    modelCapabilities,
    ...(selectedModel ? { selectedModel } : {})
  }
}

export function rebasePendingSharedProviderCatalog(
  completed: PendingSharedProviderCatalog,
  pending: PendingSharedProviderCatalog,
  connection: SharedModelConnection
): PendingSharedProviderCatalog {
  const incremental = applyPendingSharedProviderCatalog(connection, {
    ...pending,
    baseModels: completed.localModels,
    baseModelProfiles: completed.localModelProfiles
  })
  const mergedConnection: SharedModelConnection = { ...connection, ...incremental }
  return {
    ...pending,
    baseModels: [...connection.models],
    baseModelProfiles: sharedModelProfiles(connection, undefined),
    localModels: [...incremental.models],
    localModelProfiles: sharedModelProfiles(mergedConnection, {
      modelProfiles: pending.localModelProfiles
    }),
    committedRevision: null
  }
}

export type SharedModelConnectionCatalogConnectSource = {
  provider: ModelProviderProfileV1
  credential?: string
}

export async function commitSharedModelConnectionCatalog(
  providerId: string,
  pending: PendingSharedProviderCatalog,
  isProviderTombstoned: (providerId: string) => boolean = () => false,
  connectSource?: SharedModelConnectionCatalogConnectSource
): Promise<SharedModelConnectionsSnapshot> {
  let snapshot = await requestSharedModelConnections('/v1/model-connections')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (isProviderTombstoned(providerId)) {
      throw new Error(`Shared model connection ${providerId} is pending deletion`)
    }
    let connection = snapshot.providers.find((item) => item.id === providerId)
    if (!connection) {
      // Fetch/import can stage a catalog before syncOnce has connected the
      // provider (common for Aliyun Token Plan). Connect with the pending
      // catalog instead of leaving an orphan that SSE later reverts (#1117).
      if (!connectSource) {
        throw new Error(`Shared model connection ${providerId} is no longer available`)
      }
      const credential = connectSource.credential?.trim() ?? ''
      if (modelProviderRequiresApiKey(connectSource.provider) && !credential) return snapshot
      try {
        snapshot = await connectSharedModelConnectionWithCatalog(
          snapshot,
          connectSource.provider,
          pending,
          connectSource.credential
        )
      } catch (error) {
        if (!(error instanceof SharedModelConnectionConflictError) || attempt === 1) throw error
        snapshot = error.snapshot
        continue
      }
      connection = snapshot.providers.find((item) => item.id === providerId)
      if (!connection) {
        throw new Error(`Shared model connection ${providerId} is no longer available`)
      }
      if (
        JSON.stringify(connection.models) === JSON.stringify(pending.localModels) &&
        sameCatalogCapabilities(
          connection.modelCapabilities,
          catalogCapabilities(pending.localModels, pending.localModelProfiles)
        )
      ) {
        return snapshot
      }
    }
    const catalog = applyPendingSharedProviderCatalog(connection, pending)
    const providerPatch = connectSource
      ? sharedConnectionProfilePatch(connectSource.provider)
      : {}
    try {
      return await requestSharedModelConnections(
        `/v1/model-connections/${encodeURIComponent(providerId)}`,
        'PATCH',
        { expectedRevision: snapshot.revision, ...providerPatch, ...catalog }
      )
    } catch (error) {
      if (!(error instanceof SharedModelConnectionConflictError) || attempt === 1) throw error
      snapshot = error.snapshot
    }
  }
  return snapshot
}

export function sharedConnectionProfilePatch(provider: ModelProviderProfileV1): Record<string, unknown> {
  const baseUrlOptional = sharedConnectionBaseUrlOptional(provider.kind)
  return {
    name: provider.name.trim() || provider.id,
    kind: provider.kind ?? 'http',
    authType: isSubscriptionProvider(provider) ? 'subscription' : 'api-key',
    ...(baseUrlOptional ? {} : { baseUrl: provider.baseUrl }),
    endpointFormat: provider.endpointFormat
  }
}

async function connectSharedModelConnectionWithCatalog(
  snapshot: SharedModelConnectionsSnapshot,
  provider: ModelProviderProfileV1,
  pending: PendingSharedProviderCatalog,
  credential?: string
): Promise<SharedModelConnectionsSnapshot> {
  const baseUrlOptional = sharedConnectionBaseUrlOptional(provider.kind)
  const resolvedCredential = (credential ?? provider.apiKey).trim()
  const selectedModel = pending.localModels[0]
  return await requestSharedModelConnections('/v1/model-connections/connect', 'POST', {
    expectedRevision: snapshot.revision,
    id: provider.id,
    name: provider.name.trim() || provider.id,
    ...registryPresetFields(provider),
    kind: provider.kind ?? 'http',
    authType: isSubscriptionProvider(provider) ? 'subscription' : 'api-key',
    ...(baseUrlOptional ? {} : { baseUrl: provider.baseUrl }),
    endpointFormat: provider.endpointFormat,
    ...(resolvedCredential ? { credential: resolvedCredential } : {}),
    models: pending.localModels,
    modelCapabilities: catalogCapabilities(pending.localModels, pending.localModelProfiles),
    ...(selectedModel ? { selectedModel } : {}),
    probe: false,
    select: false
  })
}

export async function replaceSharedModelConnectionCredential(
  providerId: string,
  credential: string,
  isProviderTombstoned: (providerId: string) => boolean = () => false,
  operation?: {
    operationToken: string
    isCurrent: () => boolean
  }
): Promise<SharedModelConnectionsSnapshot> {
  let snapshot = await requestSharedModelConnections('/v1/model-connections')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (isProviderTombstoned(providerId)) {
      throw new Error(`Shared model connection ${providerId} is pending deletion`)
    }
    if (!snapshot.providers.some((item) => item.id === providerId)) {
      if (!credential.trim()) return snapshot
      throw new Error(`Shared model connection ${providerId} is no longer available`)
    }
    try {
      if (!credential.trim()) {
        return await requestSharedModelConnections(
          `/v1/model-connections/${encodeURIComponent(providerId)}/credential?expected_revision=${snapshot.revision}`,
          'DELETE'
        )
      }
      if (!operation) {
        return await requestSharedModelConnections(
          `/v1/model-connections/${encodeURIComponent(providerId)}/credential`,
          'PUT',
          { expectedRevision: snapshot.revision, credential }
        )
      }
      const prepared = await requestSharedModelConnections(
        `/v1/model-connections/${encodeURIComponent(providerId)}/credential`,
        'PUT',
        {
          expectedRevision: snapshot.revision,
          credential,
          operationToken: operation.operationToken
        }
      )
      if (!operation.isCurrent()) return prepared
      return await requestSharedModelConnections(
        `/v1/model-connections/${encodeURIComponent(providerId)}/credential/commit`,
        'POST',
        {
          expectedRevision: prepared.revision,
          operationToken: operation.operationToken
        }
      )
    } catch (error) {
      if (operation && !operation.isCurrent() && error instanceof SharedModelConnectionConflictError) {
        return error.snapshot
      }
      if (!(error instanceof SharedModelConnectionConflictError) || attempt === 1) throw error
      snapshot = error.snapshot
    }
  }
  return snapshot
}

export async function fenceSharedModelConnectionCredential(
  providerId: string,
  operationToken: string
): Promise<boolean> {
  let snapshot = await requestSharedModelConnections('/v1/model-connections')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!snapshot.providers.some((provider) => provider.id === providerId)) return false
    try {
      await requestSharedModelConnections(
        `/v1/model-connections/${encodeURIComponent(providerId)}/credential/fence`,
        'POST',
        { expectedRevision: snapshot.revision, operationToken }
      )
      return true
    } catch (error) {
      if (!(error instanceof SharedModelConnectionConflictError) || attempt === 1) throw error
      snapshot = error.snapshot
    }
  }
  return false
}

export async function connectOrReplaceSharedModelConnectionCredential(
  provider: ModelProviderProfileV1,
  credential: string,
  isProviderTombstoned: (providerId: string) => boolean = () => false,
  operation?: {
    operationToken: string
    isCurrent: () => boolean
    fenceInstalled?: boolean
  }
): Promise<SharedModelConnectionsSnapshot> {
  let snapshot = await requestSharedModelConnections('/v1/model-connections')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (isProviderTombstoned(provider.id)) {
      throw new Error(`Shared model connection ${provider.id} is pending deletion`)
    }
    const existing = snapshot.providers.find((item) => item.id === provider.id)
    try {
      if (existing) {
        if (operation && !operation.fenceInstalled) {
          if (!operation.isCurrent()) return snapshot
          await fenceSharedModelConnectionCredential(provider.id, operation.operationToken)
          if (!operation.isCurrent()) return snapshot
        }
        return await replaceSharedModelConnectionCredential(
          provider.id,
          credential,
          isProviderTombstoned,
          operation
        )
      }
      if (operation && !operation.isCurrent()) return snapshot
      const baseUrlOptional = sharedConnectionBaseUrlOptional(provider.kind)
      const connected = await requestSharedModelConnections('/v1/model-connections/connect', 'POST', {
        expectedRevision: snapshot.revision,
        id: provider.id,
        name: provider.name.trim() || provider.id,
        ...registryPresetFields(provider),
        kind: provider.kind ?? 'http',
        authType: isSubscriptionProvider(provider) ? 'subscription' : 'api-key',
        ...(baseUrlOptional ? {} : { baseUrl: provider.baseUrl }),
        endpointFormat: provider.endpointFormat,
        ...(!operation ? { credential } : {}),
        models: provider.models,
        modelCapabilities: sharedCapabilitiesFromProvider(provider),
        ...(provider.models[0] ? { selectedModel: provider.models[0] } : {}),
        probe: false,
        select: false
      })
      if (!operation || !operation.isCurrent()) return connected
      await fenceSharedModelConnectionCredential(provider.id, operation.operationToken)
      if (!operation.isCurrent()) return connected
      return await replaceSharedModelConnectionCredential(
        provider.id,
        credential,
        isProviderTombstoned,
        operation
      )
    } catch (error) {
      if (!(error instanceof SharedModelConnectionConflictError) || attempt === 1) throw error
      snapshot = error.snapshot
    }
  }
  return snapshot
}

export function registryPresetFields(
  provider: Pick<ModelProviderProfileV1, 'id' | 'presetSource'>
): { presetSource?: string; presetMode?: 'api' | 'token-plan' } {
  const source = resolveModelProviderPresetSource(provider)
  return source ? { presetSource: source.preset.id, presetMode: source.mode } : {}
}

export function createSharedModelMutationQueue(): <T>(operation: () => Promise<T>) => Promise<T> {
  let tail: Promise<void> = Promise.resolve()
  return <T,>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation, operation)
    tail = result.then(() => undefined, () => undefined)
    return result
  }
}

export function sharedProvidersEligibleForSync<T extends { id: string }>(
  providers: readonly T[],
  pendingDeletions: Pick<ReadonlySet<string>, 'has'>
): T[] {
  return providers.filter((provider) => !pendingDeletions.has(provider.id))
}

export function clearPendingSharedProviderDeletionForExplicitAdd(
  pendingDeletions: Map<string, PendingSharedProviderDeletion>,
  providerId: string
): void {
  pendingDeletions.delete(providerId)
}

export function sharedModelProfiles(
  connection: SharedModelConnection,
  existing: Pick<ModelProviderProfileV1, 'modelProfiles'> | undefined
): Record<string, ModelProviderModelProfileV1> {
  return Object.fromEntries(connection.models.map((model) => {
    const previous = existing?.modelProfiles[model] ??
      existing?.modelProfiles[model.trim().toLowerCase()]
    const capability = connection.modelCapabilities?.[model] ??
      connection.modelCapabilities?.[model.trim().toLowerCase()]
    const contextWindowTokens = boundedSharedModelLimit(
      capability?.contextWindowTokens ?? previous?.contextWindowTokens,
      MAX_MODEL_CONTEXT_WINDOW_TOKENS
    )
    const maxOutputTokens = boundedSharedModelLimit(
      capability?.maxOutputTokens ?? previous?.maxOutputTokens,
      MAX_MODEL_OUTPUT_TOKENS
    )
    return [model, {
      ...(previous?.aliases ? { aliases: [...previous.aliases] } : {}),
      inputModalities: capability?.inputModalities ?? previous?.inputModalities ?? ['text'],
      outputModalities: capability?.outputModalities ?? previous?.outputModalities ?? ['text'],
      supportsToolCalling: capability?.supportsToolCalling ?? previous?.supportsToolCalling ?? true,
      messageParts: capability?.messageParts ?? previous?.messageParts ?? ['text'],
      ...(contextWindowTokens ? { contextWindowTokens } : {}),
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
      ...(capability?.reasoning ?? previous?.reasoning
        ? { reasoning: capability?.reasoning ?? previous?.reasoning }
        : {}),
      ...(capability?.endpointFormat ?? previous?.endpointFormat
        ? { endpointFormat: capability?.endpointFormat ?? previous?.endpointFormat }
        : {}),
      ...(capability?.responsesMode ?? previous?.responsesMode
        ? { responsesMode: capability?.responsesMode ?? previous?.responsesMode }
        : {})
    }]
  }))
}

function boundedSharedModelLimit(value: unknown, maximum: number): number | undefined {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= maximum
    ? value
    : undefined
}

export function projectSharedModelConnections(
  current: ModelProviderSettingsV1,
  snapshot: SharedModelConnectionsSnapshot,
  pendingDeletions: Pick<ReadonlyMap<string, PendingSharedProviderDeletion>, 'get'> = new Map(),
  pendingNames: Pick<ReadonlyMap<string, PendingSharedProviderName>, 'get'> = new Map(),
  pendingCatalogs: Pick<ReadonlyMap<string, PendingSharedProviderCatalog>, 'get'> = new Map()
): {
  provider: Pick<ModelProviderSettingsV1, 'providers' | 'proxy' | 'routePools' | 'localGateway'>
  kun: ProjectedKunSelectionPatch
} {
  const existingById = new Map(current.providers.map((item) => [item.id, item]))
  const visibleConnections = snapshot.providers.filter((connection) =>
    pendingDeletions.get(connection.id)?.committedRevision == null
  )
  const projectedProviders = visibleConnections.map((connection): ModelProviderProfileV1 => {
    const existing = existingById.get(connection.id)
    const pendingCatalog = pendingCatalogs.get(connection.id)
    const presetSource = connection.presetSource
      ? { presetId: connection.presetSource, mode: connection.presetMode ?? 'api' as const }
      : existing?.presetSource
    return {
      ...(existing ?? {
        id: connection.id,
        name: connection.name,
        apiKey: '',
        baseUrl: connection.baseUrl ?? '',
        endpointFormat: connection.endpointFormat,
        retry: defaultModelRequestRetrySettings(),
        models: [],
        modelProfiles: {}
      }),
      id: connection.id,
      name: pendingNames.get(connection.id)?.localName ?? connection.name,
      ...(presetSource ? { presetSource } : {}),
      // Canonical connections expose only configured state. Secret material
      // stays in the protected Registry and the in-memory edit generation.
      apiKey: '',
      baseUrl: pendingNames.get(connection.id)?.localBaseUrl ?? connection.baseUrl ?? '',
      endpointFormat: pendingNames.get(connection.id)?.localEndpointFormat ?? connection.endpointFormat,
      kind: connection.kind,
      models: pendingCatalog ? [...pendingCatalog.localModels] : [...connection.models],
      modelProfiles: pendingCatalog
        ? structuredClone(pendingCatalog.localModelProfiles)
        : sharedModelProfiles(connection, existing)
    }
  })
  // Keep local-only providers that are not yet in the registry (or are waiting
  // on a catalog commit). Without this, SSE projections drop freshly fetched
  // Aliyun Token Plan catalogs before connect finishes (#1117).
  const projectedIds = new Set(projectedProviders.map((provider) => provider.id))
  const retainedLocalProviders = current.providers
    .filter((provider) => {
      if (projectedIds.has(provider.id)) return false
      if (pendingDeletions.get(provider.id) != null) return false
      if (provider.id === DEFAULT_MODEL_PROVIDER_ID) return true
      if (pendingCatalogs.get(provider.id) != null) return true
      // Mirror the sync loop's skip conditions: key-requiring presets
      // committed without a credential ("configure later"), and providers
      // whose baseUrl is still empty, are never connected to the registry,
      // so a registry projection must not drop them from AppSettings.
      const baseUrlOptional = sharedConnectionBaseUrlOptional(provider.kind)
      return (modelProviderRequiresApiKey(provider) && !provider.apiKey.trim()) ||
        (!baseUrlOptional && !provider.baseUrl.trim())
    })
    .map((provider) => {
      const pendingCatalog = pendingCatalogs.get(provider.id)
      if (!pendingCatalog) return provider
      return {
        ...provider,
        models: [...pendingCatalog.localModels],
        modelProfiles: structuredClone(pendingCatalog.localModelProfiles)
      }
    })
  const providers = [...retainedLocalProviders, ...projectedProviders]
  const defaultProviderId = snapshot.defaultProviderId?.trim()
  const defaultModel = snapshot.defaultModel?.trim()
  const hasUsableDefault = Boolean(
    defaultProviderId &&
    defaultModel &&
    pendingDeletions.get(defaultProviderId)?.committedRevision == null
  )
  return {
    provider: {
      providers,
      proxy: snapshot.proxy ?? current.proxy,
      // Route pools and the local gateway are edited as one AppSettings draft.
      // A registry snapshot may lag that draft while its globals are being
      // persisted, so it must never replace the renderer's intended config.
      routePools: current.routePools,
      localGateway: current.localGateway
    },
    kun: hasUsableDefault
      ? { providerId: defaultProviderId!, model: defaultModel! }
      : { providerId: '' }
  }
}

export function sharedSettingsFingerprint(input: {
  providers: readonly ModelProviderProfileV1[]
  providerId: string
  model: string
  proxy: ModelProviderSettingsV1['proxy']
  routePools: ModelProviderSettingsV1['routePools']
  localGateway: ModelProviderSettingsV1['localGateway']
}): string {
  return JSON.stringify({
    providers: input.providers.map((item) => ({
      id: item.id,
      name: item.name,
      baseUrl: item.baseUrl,
      endpointFormat: item.endpointFormat,
      kind: item.kind,
      models: item.models,
      modelProfiles: item.modelProfiles
    })),
    providerId: input.providerId,
    model: input.model,
    proxy: input.proxy,
    routePools: input.routePools,
    localGateway: input.localGateway
  })
}

export function sharedCapabilitiesFromProvider(
  provider: ModelProviderProfileV1
): SharedModelConnection['modelCapabilities'] {
  return catalogCapabilities(provider.models, provider.modelProfiles)
}
