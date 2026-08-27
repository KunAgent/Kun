import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { assertManagerAtomicJsonPath, AtomicJsonFile } from '../extensions/atomic-json.js'
import type { ServeProviderConfig } from '../config/kun-config.js'
import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import {
  ModelConnectionConnectRequestSchema,
  ModelConnectionCredentialCommitRequestSchema,
  ModelConnectionCredentialFenceRequestSchema,
  ModelConnectionCredentialPrepareRequestSchema,
  ModelConnectionCredentialRequestSchema,
  ModelConnectionGlobalsRequestSchema,
  ModelConnectionPatchRequestSchema,
  ModelConnectionSelectRequestSchema,
  ModelConnectionSnapshotSchema,
  type ModelConnectionConnectRequest,
  type ModelConnectionCredentialErrorCode,
  type ModelConnectionCredentialStatus,
  type ModelConnectionProfile,
  type ModelConnectionSnapshot
} from '../contracts/model-connections.js'
import { materializeLegacyProviderCredential } from './legacy-provider-credential-migration.js'
import type { ExtensionCredentialStore } from './extension-credential-store.js'
import { createProxyFetch } from '../adapters/model/proxy-fetch.js'
import { type ModelConnectionRegistry, StoredProfileSchema, DeletedProfileTombstoneSchema, CredentialTransactionPreviousSchema, CredentialTransactionSchema, CredentialRefCleanupEntrySchema, RegistryDocumentSchema, type RegistryDocument, type StoredProfile, type CredentialTransaction, type PreparedCredentialSecret, type ModelConnectionSeed, type AuthenticatedModelConnectionInput, MODEL_CONNECTION_CREDENTIAL_SOURCE_PREFIX, isModelConnectionCredentialSourceId, modelConnectionCredentialSourceId, providerIdFromCredentialSource, ModelConnectionConflictError, type MaterializedModelConnections, type ProjectedCredentialHealth, credentialHealth, readLatestIfChanged, parseCredentialOperationToken, previousCredentialState, boundedCredentialHighWater, appendCredentialRefs, requireCredentialTransaction, credentialReferenceIsLive, processIsAlive, emptyDocument, configuredFallback, reconcileSeedProfile, sameStoredProfile, project, isProfileUsable, mergeProjectedCapability, assertRevision, requireProfile, capabilitiesForModels, sameCapabilities, allocateId, normalizeProviderId, preparedCredentialSecretTimerKey, uniqueModels, sameModels, probeModels, modelsUrl } from './model-connection-registry-core.js'

export const modelConnectionRegistryMaterializationOperations = {
async materialize(this: ModelConnectionRegistry): Promise<MaterializedModelConnections> {
    const document = await this['file'].read(emptyDocument)
    await this['recoverExpiredCredentialTransactions'](document)
    return this['materializeDocument'](await this['file'].read(emptyDocument))
  },

async materializeReadOnly(this: ModelConnectionRegistry): Promise<MaterializedModelConnections> {
    return this['materializeDocument'](await this['file'].read(emptyDocument))
  },

async materializeDocument(this: ModelConnectionRegistry,
    document: RegistryDocument,
    recoveryProviderId?: string
  ): Promise<MaterializedModelConnections> {
    const credentialHealth = await this['inspectCredentialHealth'](document)
    const providers = new Map<string, ServeProviderConfig>()
    let selected: MaterializedModelConnections['selected']
    for (const profile of Object.values(document.profiles)) {
      const credentialReplacementPending = Boolean(
        document.credentialTransactions[profile.id] && profile.id !== recoveryProviderId
      )
      const profileUsable = (recoveryProviderId === profile.id && profile.configured) ||
        isProfileUsable(profile, credentialHealth.get(profile.id))
      // A pending replacement must remain in the live provider map with an
      // empty credential so onChanged can retire the old client atomically.
      // Other unusable profiles stay visible in the Registry snapshot but are
      // intentionally absent from executable runtime configuration.
      if (!profileUsable && !credentialReplacementPending) continue
      let credential: Awaited<ReturnType<ExtensionCredentialStore['get']>> = null
      if (profile.credentialRef && !credentialReplacementPending) {
        try {
          credential = await this['options'].credentials.get(profile.credentialRef)
        } catch {
          // Keep materializing the remaining providers. Request-time resolution
          // for this provider will fail closed until its credential is replaced.
        }
      }
      const material = materializeLegacyProviderCredential(credential?.apiKey ?? '')
      const credentialSourceId = credentialReplacementPending || !profileUsable
        ? undefined
        : profile.credentialRef
          ? modelConnectionCredentialSourceId(profile.id)
          : profile.credentialSourceId
      // A managed source is authoritative and may already have rotated beyond
      // the Registry's pre-migration credential copy. Never expose that stale
      // copy as a fallback client key.
      const usesRequestTimeCredential = !credentialReplacementPending &&
        profile.kind === 'http' &&
        !profile.credentialRef &&
        Boolean(profile.credentialSourceId)
      const apiKey = usesRequestTimeCredential ? '' : material.apiKey
      const materialHeaders = usesRequestTimeCredential ? undefined : material.headers
      const config: ServeProviderConfig =
        profile.kind === 'agent-sdk' ||
        profile.kind === 'antigravity-cli' ||
        profile.kind === 'cursor-sdk' ||
        profile.kind === 'gemini-cli-api'
        ? {
            kind: profile.kind,
            apiKey,
            ...(credentialSourceId ? { credentialSourceId } : {}),
            ...(profile.presetSource ? { presetSource: profile.presetSource } : {}),
            ...(profile.presetMode ? { presetMode: profile.presetMode } : {}),
            authType: profile.authType,
            models: [...profile.models],
            ...(profile.modelCapabilities ? { modelCapabilities: profile.modelCapabilities } : {}),
            ...(profile.selectedModel ? { selectedModel: profile.selectedModel } : {})
          }
        : profile.kind === 'gemini-code-assist'
          ? {
              kind: 'gemini-code-assist',
              apiKey,
              ...(credentialSourceId ? { credentialSourceId } : {}),
              ...(profile.presetSource ? { presetSource: profile.presetSource } : {}),
              ...(profile.presetMode ? { presetMode: profile.presetMode } : {}),
              authType: profile.authType,
              baseUrl: profile.baseUrl!,
              endpointFormat: profile.endpointFormat,
              models: [...profile.models],
              ...(profile.modelCapabilities ? { modelCapabilities: profile.modelCapabilities } : {}),
              ...(profile.selectedModel ? { selectedModel: profile.selectedModel } : {}),
              ...(material.geminiAuth ? { geminiAuth: material.geminiAuth } : {})
            }
          : {
              kind: 'http',
              apiKey,
              ...(credentialSourceId ? { credentialSourceId } : {}),
              ...(profile.presetSource ? { presetSource: profile.presetSource } : {}),
              ...(profile.presetMode ? { presetMode: profile.presetMode } : {}),
              authType: profile.authType,
              baseUrl: profile.baseUrl!,
              endpointFormat: profile.endpointFormat,
              models: [...profile.models],
              ...(profile.modelCapabilities ? { modelCapabilities: profile.modelCapabilities } : {}),
              ...(profile.selectedModel ? { selectedModel: profile.selectedModel } : {}),
              ...(materialHeaders || profile.headers
                ? { headers: { ...(profile.headers ?? {}), ...(materialHeaders ?? {}) } }
                : {})
            }
      providers.set(profile.id, config)
      if (profileUsable && profile.id === document.defaultProviderId && document.defaultModel) {
        selected = { profile, config, model: document.defaultModel }
      }
    }
    return {
      providers,
      proxy: document.proxy,
      routePools: document.routePools,
      localModelGateway: document.localModelGateway,
      ...(selected ? { selected } : {})
    }
  },

async probeInput(this: ModelConnectionRegistry, input: ModelConnectionConnectRequest): Promise<string[]> {
    return probeModels({
      kind: input.kind,
      baseUrl: input.baseUrl,
      endpointFormat: input.endpointFormat,
      apiKey: input.credential?.trim() ?? '',
      fallbackModels: input.models,
      proxyUrl: ''
    })
  },

async apply(this: ModelConnectionRegistry, document: RegistryDocument): Promise<void> {
    await this['options'].onChanged?.(await this['materializeDocument'](document))
  },

async retryLegacyCredentialSourceRetirements(this: ModelConnectionRegistry): Promise<void> {
    const document = await this['file'].read(emptyDocument)
    for (const profile of Object.values(document.profiles)) {
      if (profile.legacyCredentialSourceToRetire) {
        await this['retireLegacyCredentialSource'](profile.id)
      }
    }
    for (const [providerId, tombstone] of Object.entries(document.tombstones)) {
      if (tombstone.legacyCredentialSourceToRetire) {
        await this['retireDeletedLegacyCredentialSource'](providerId)
      }
    }
  },

async retireLegacyCredentialSource(this: ModelConnectionRegistry, providerId: string): Promise<void> {
    const retire = this['options'].retireLegacyCredentialSource
    if (!retire) return
    const profile = (await this['file'].read(emptyDocument)).profiles[providerId]
    const sourceId = profile?.legacyCredentialSourceToRetire
    if (!sourceId) return
    try {
      await retire(sourceId)
      await this['file'].update(emptyDocument, (current) => {
        const currentProfile = current.profiles[providerId]
        if (currentProfile?.legacyCredentialSourceToRetire !== sourceId) return current
        return {
          ...current,
          profiles: {
            ...current.profiles,
            [providerId]: {
              ...currentProfile,
              legacyCredentialSourceToRetire: undefined
            }
          }
        }
      })
    } catch (error) {
      console.warn('[kun] Registry credential replaced, but its legacy source retirement is pending.', {
        providerId,
        sourceId,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  },

async retireDeletedLegacyCredentialSource(this: ModelConnectionRegistry, providerId: string): Promise<void> {
    const retire = this['options'].retireLegacyCredentialSource
    if (!retire) return
    const tombstone = (await this['file'].read(emptyDocument)).tombstones[providerId]
    const sourceId = tombstone?.legacyCredentialSourceToRetire
    if (!sourceId) return
    try {
      await retire(sourceId)
      await this['file'].update(emptyDocument, (current) => {
        const currentTombstone = current.tombstones[providerId]
        if (currentTombstone?.legacyCredentialSourceToRetire !== sourceId) return current
        return {
          ...current,
          tombstones: {
            ...current.tombstones,
            [providerId]: {
              ...currentTombstone,
              legacyCredentialSourceToRetire: undefined
            }
          }
        }
      })
    } catch (error) {
      console.warn('[kun] Deleted Registry provider still has a pending legacy source retirement.', {
        providerId,
        sourceId,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  },

async changed(this: ModelConnectionRegistry, _document: RegistryDocument): Promise<void> {
    await this['applyLatest']()
  },
}
