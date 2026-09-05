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
import { resolveRegistryProfileProxyUrl } from './model-connection-registry-proxy.js'

export const modelConnectionRegistrySelectionOperations = {
async select(this: ModelConnectionRegistry, raw: unknown): Promise<ModelConnectionSnapshot> {
    const input = ModelConnectionSelectRequestSchema.parse(raw)
    const selectionHealth = await this['inspectCredentialHealth'](await this['file'].read(emptyDocument))
    const document = await this['file'].update(emptyDocument, (current) => {
      assertRevision(current, input.expectedRevision, this['options'].modelCapabilities, this['credentialHealth'])
      const profile = requireProfile(current, input.providerId)
      if (current.credentialTransactions[profile.id]) {
        throw new Error('provider credential replacement is pending')
      }
      if (!isProfileUsable(profile, selectionHealth.get(profile.id))) {
        throw new Error('provider is not connected')
      }
      if (input.accountId && input.accountId !== profile.accountId) {
        throw new Error('account does not belong to the selected provider')
      }
      if (profile.models.length > 0 && !profile.models.includes(input.model)) {
        throw new Error('model is not available for this provider')
      }
      const updated = { ...profile, selectedModel: input.model }
      return {
        ...current,
        revision: current.revision + 1,
        profiles: { ...current.profiles, [profile.id]: updated },
        defaultProviderId: profile.id,
        defaultAccountId: input.accountId ?? profile.accountId,
        defaultModel: input.model
      }
    })
    await this['changed'](document)
    return this['projectWithCredentialHealth'](document)
  },

/**
   * Reconcile an explicit, authenticated configuration selection after its
   * provider catalog has been imported. Ordinary initialize() calls do not use
   * this path, so a daemon restart cannot replace a newer registry selection
   * with a stale config.json value.
   */
async synchronizeDefaultSelection(this: ModelConnectionRegistry, raw: {
    providerId: string
    accountId?: string
    model: string
  }): Promise<ModelConnectionSnapshot> {
    const input = ModelConnectionSelectRequestSchema
      .omit({ expectedRevision: true })
      .parse(raw)
    const selectionHealth = await this['inspectCredentialHealth'](await this['file'].read(emptyDocument))
    let changed = false
    const document = await this['file'].update(emptyDocument, (current) => {
      const profile = requireProfile(current, input.providerId)
      if (current.credentialTransactions[profile.id]) {
        throw new Error('provider credential replacement is pending')
      }
      if (!isProfileUsable(profile, selectionHealth.get(profile.id))) {
        throw new Error('provider is not connected')
      }
      if (input.accountId && input.accountId !== profile.accountId) {
        throw new Error('account does not belong to the selected provider')
      }
      if (profile.models.length > 0 && !profile.models.includes(input.model)) {
        throw new Error('model is not available for this provider')
      }
      const accountId = input.accountId ?? profile.accountId
      if (
        current.defaultProviderId === profile.id &&
        current.defaultAccountId === accountId &&
        current.defaultModel === input.model &&
        profile.selectedModel === input.model
      ) {
        return current
      }
      changed = true
      return {
        ...current,
        revision: current.revision + 1,
        profiles: {
          ...current.profiles,
          [profile.id]: { ...profile, selectedModel: input.model }
        },
        defaultProviderId: profile.id,
        defaultAccountId: accountId,
        defaultModel: input.model
      }
    })
    if (changed) await this['changed'](document)
    return this['projectWithCredentialHealth'](document)
  },

async updateGlobals(this: ModelConnectionRegistry, raw: unknown): Promise<ModelConnectionSnapshot> {
    const input = ModelConnectionGlobalsRequestSchema.parse(raw)
    const document = await this['file'].update(emptyDocument, (current) => {
      assertRevision(current, input.expectedRevision, this['options'].modelCapabilities, this['credentialHealth'])
      return {
        ...current,
        revision: current.revision + 1,
        proxy: input.proxy,
        routePools: input.routePools,
        localModelGateway: input.localModelGateway
      }
    })
    await this['changed'](document)
    return this['projectWithCredentialHealth'](document)
  },

async probe(this: ModelConnectionRegistry, providerId: string): Promise<{ ok: true; models: string[] }> {
    const document = await this['readDocumentForCredentialConsumer'](providerId)
    if (document.credentialTransactions[providerId]) {
      throw new Error('provider credential replacement is pending')
    }
    const profile = requireProfile(document, providerId)
    const credential = profile.credentialRef
      ? await this['options'].credentials.get(profile.credentialRef)
      : null
    const credentialSourceId = profile.credentialRef
      ? modelConnectionCredentialSourceId(profile.id)
      : profile.credentialSourceId
    const resolved = credentialSourceId && this['options'].resolveCredentialSource
      ? await this['options'].resolveCredentialSource(credentialSourceId)
      : materializeLegacyProviderCredential(credential?.apiKey ?? '')
    const models = await probeModels({
      kind: profile.kind,
      baseUrl: profile.baseUrl,
      endpointFormat: profile.endpointFormat,
      apiKey: resolved.apiKey,
      headers: { ...(profile.headers ?? {}), ...(resolved.headers ?? {}) },
      fallbackModels: profile.models,
      proxyUrl: resolveRegistryProfileProxyUrl(document, profile)
    })
    return { ok: true, models }
  },

/**
   * Internal compatibility hook for rolling-upgrade clients. The returned
   * material must only be copied into Kun's protected account store and must
   * never cross HTTP, logs, ordinary settings, or terminal output.
   */
async credentialForCompatibility(this: ModelConnectionRegistry, providerId: string): Promise<string | null> {
    const document = await this['readDocumentForCredentialConsumer'](providerId)
    if (document.credentialTransactions[providerId]) return null
    const profile = requireProfile(document, providerId)
    if (!profile.credentialRef) return null
    const credential = await this['options'].credentials.get(profile.credentialRef)
    return credential?.apiKey?.trim() || null
  },

/**
   * Main-only bridge for request paths that have not moved into Kun yet. A
   * Registry profile without a credentialRef is authoritative unless it is
   * still explicitly bound to a legacy settings source. No HTTP route exposes
   * this result.
   */
async credentialStateForInternalConsumer(this: ModelConnectionRegistry, providerId: string): Promise<{
    authoritative: boolean
    apiKey: string
  }> {
    const document = await this['readDocumentForCredentialConsumer'](providerId)
    if (document.credentialTransactions[providerId]) {
      return { authoritative: true, apiKey: '' }
    }
    const profile = document.profiles[providerId]
    if (!profile || (!profile.credentialRef && profile.credentialSourceId)) {
      return { authoritative: false, apiKey: '' }
    }
    if (!profile.credentialRef) return { authoritative: true, apiKey: '' }
    let credential: Awaited<ReturnType<ExtensionCredentialStore['get']>> = null
    try {
      credential = await this['options'].credentials.get(profile.credentialRef)
    } catch {
      // An unreadable credential must not break unrelated Main-process model
      // consumers. The public snapshot carries the safe per-provider status.
    }
    return { authoritative: true, apiKey: credential?.apiKey?.trim() ?? '' }
  },

/** Resolves a Registry-owned protected credential for request-time refresh. */
async resolveApiKey(this: ModelConnectionRegistry, sourceId: string): Promise<{ apiKey: string } | null> {
    const providerId = providerIdFromCredentialSource(sourceId)
    if (!providerId) return null
    const document = await this['readDocumentForCredentialConsumer'](providerId)
    if (document.credentialTransactions[providerId]) return null
    const profile = document.profiles[providerId]
    if (!profile?.credentialRef) return null
    const credential = await this['options'].credentials.get(profile.credentialRef)
    const apiKey = credential?.apiKey?.trim() ?? ''
    return apiKey ? { apiKey } : null
  },

/** Atomically rotates a Registry-owned protected credential in place. */
async updateResolvedApiKey(this: ModelConnectionRegistry,
    sourceId: string,
    expectedApiKey: string,
    apiKey: string
  ): Promise<boolean> {
    const providerId = providerIdFromCredentialSource(sourceId)
    const trimmed = apiKey.trim()
    if (!providerId || !trimmed) return false
    const initial = await this['readDocumentForCredentialConsumer'](providerId)
    if (initial.credentialTransactions[providerId]) return false
    const initialProfile = initial.profiles[providerId]
    if (!initialProfile?.credentialRef || !initialProfile.incarnationId) return false
    const incarnationId = initialProfile.incarnationId
    const currentCredential = await this['options'].credentials.get(initialProfile.credentialRef)
    if (currentCredential?.apiKey?.trim() !== expectedApiKey.trim()) return false

    const operationToken = `refresh:${randomUUID()}`
    const nextRef = `cred_${randomUUID()}`
    let previousRef: string | undefined
    let committing: RegistryDocument
    try {
      committing = await this['file'].update(emptyDocument, (current) => {
        if (current.credentialTransactions[providerId]) {
          throw new ModelConnectionConflictError(this['project'](current))
        }
        const profile = current.profiles[providerId]
        if (
          !profile?.credentialRef ||
          profile.credentialRef !== initialProfile.credentialRef ||
          profile.incarnationId !== incarnationId
        ) {
          throw new ModelConnectionConflictError(this['project'](current))
        }
        previousRef = profile.credentialRef
        return {
          ...current,
          revision: current.revision + 1,
          credentialTransactions: {
            ...current.credentialTransactions,
            [providerId]: {
              operationToken,
              clientId: randomUUID(),
              generation: 1,
              incarnationId,
              phase: 'committing',
              expiresAt: this['nowMs']() + this['credentialFenceTtlMs'](),
              previous: previousCredentialState(profile),
              nextCredentialRef: nextRef,
              writerInstanceId: this['registryInstanceId'],
              writerPid: process.pid
            }
          }
        }
      })
    } catch (error) {
      if (error instanceof ModelConnectionConflictError) return false
      throw error
    }
    this['scheduleCredentialRecovery'](providerId, committing.credentialTransactions[providerId])
    try {
      await this['changed'](committing)
      await this['options'].credentials.set(nextRef, {
        ...currentCredential,
        apiKey: trimmed
      })
    } catch (error) {
      await this['abandonCredentialWrite'](providerId, operationToken, nextRef)
      throw error
    }
    let finalized: RegistryDocument
    try {
      finalized = await this['file'].update(emptyDocument, (current) => {
        const transaction = current.credentialTransactions[providerId]
        const profile = current.profiles[providerId]
        if (
          transaction?.operationToken !== operationToken ||
          transaction.phase !== 'committing' ||
          transaction.nextCredentialRef !== nextRef ||
          !profile ||
          profile.incarnationId !== incarnationId ||
          profile.credentialRef !== previousRef
        ) {
          throw new ModelConnectionConflictError(this['project'](current))
        }
        const credentialTransactions = { ...current.credentialTransactions }
        delete credentialTransactions[providerId]
        return {
          ...current,
          revision: current.revision + 1,
          profiles: {
            ...current.profiles,
            [providerId]: { ...profile, credentialRef: nextRef }
          },
          credentialTransactions,
          credentialRefCleanup: appendCredentialRefs(
            current.credentialRefCleanup,
            this['nowMs'](),
            previousRef
          )
        }
      })
    } catch (error) {
      await this['retireStaleCredentialWrite'](nextRef)
      if (error instanceof ModelConnectionConflictError) return false
      throw error
    }
    this['cancelCredentialRecoveryTimer'](providerId)
    await this['drainCredentialRefCleanup']()
    // Keep live consumers monotonic without synchronously rebuilding the model
    // client that initiated this request-time OAuth refresh.
    void this['changed'](finalized).catch(() => undefined)
    return true
  },
}
