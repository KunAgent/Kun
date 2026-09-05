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

export const modelConnectionRegistryCredentialMutationOperations = {
async patch(this: ModelConnectionRegistry, providerId: string, raw: unknown): Promise<ModelConnectionSnapshot> {
    const input = ModelConnectionPatchRequestSchema.parse(raw)
    const { expectedRevision: _expectedRevision, ...changes } = input
    const fallbackHealth = await this['inspectCredentialHealth'](await this['file'].read(emptyDocument))
    const document = await this['file'].update(emptyDocument, (current) => {
      assertRevision(current, input.expectedRevision, this['options'].modelCapabilities, this['credentialHealth'])
      const profile = requireProfile(current, providerId)
      if (current.credentialTransactions[providerId]) {
        throw new ModelConnectionConflictError(this['project'](current))
      }
      const kind = input.kind ?? profile.kind
      const baseUrl = input.baseUrl ?? profile.baseUrl
      if (kind === 'http' && !baseUrl) throw new Error('baseUrl is required for HTTP providers')
      const models = input.models ? uniqueModels(input.models) : profile.models
      const modelCapabilities = input.modelCapabilities
        ? capabilitiesForModels(input.modelCapabilities, models)
        : profile.modelCapabilities
          ? capabilitiesForModels(profile.modelCapabilities, models)
          : undefined
      if (input.selectedModel && !models.includes(input.selectedModel)) {
        throw new Error('selected model is not present in the provider model list')
      }
      const selectedModel = input.selectedModel ?? (
        profile.selectedModel && models.includes(profile.selectedModel)
          ? profile.selectedModel
          : models[0]
      )
      const { selectedModel: _previousSelectedModel, ...profileWithoutSelection } = profile
      const nextProfile = StoredProfileSchema.parse({
        ...profileWithoutSelection,
        ...changes,
        models,
        ...(modelCapabilities ? { modelCapabilities } : {}),
        ...(selectedModel ? { selectedModel } : {})
      })
      const profiles = {
        ...current.profiles,
        [providerId]: nextProfile
      }
      const fallback = current.defaultProviderId === providerId && !selectedModel
        ? configuredFallback(Object.values(profiles), fallbackHealth)
        : undefined
      return {
        ...current,
        revision: current.revision + 1,
        profiles,
        ...(current.defaultProviderId === providerId
          ? selectedModel
            ? {
                defaultProviderId: providerId,
                defaultAccountId: profile.accountId,
                defaultModel: selectedModel
              }
            : fallback
              ? {
                  defaultProviderId: fallback.profile.id,
                  defaultAccountId: fallback.profile.accountId,
                  defaultModel: fallback.model
                }
              : {
                  defaultProviderId: undefined,
                  defaultAccountId: undefined,
                  defaultModel: undefined
                }
          : {})
      }
    })
    await this['changed'](document)
    return this['projectWithCredentialHealth'](document)
  },

/**
   * Installs a secret-free fence in the Manager-owned Registry document. The
   * client id/generation high-water survives a successful commit, so a delayed
   * request from an older renderer generation cannot re-fence the final key.
   */
async fenceCredential(this: ModelConnectionRegistry, providerId: string, raw: unknown): Promise<ModelConnectionSnapshot> {
    const input = ModelConnectionCredentialFenceRequestSchema.parse(raw)
    const token = parseCredentialOperationToken(input.operationToken)
    await this['options'].beforeCredentialFenceInstall?.(providerId)
    let supersededToken: string | undefined
    const document = await this['file'].update(emptyDocument, (current) => {
      const profile = requireProfile(current, providerId)
      const active = current.credentialTransactions[providerId]
      if (
        active?.operationToken === input.operationToken &&
        active.incarnationId === profile.incarnationId
      ) return current
      assertRevision(current, input.expectedRevision, this['options'].modelCapabilities, this['credentialHealth'])
      if (active?.phase === 'recovering') {
        throw new ModelConnectionConflictError(this['project'](current))
      }
      const incarnationId = profile.incarnationId ?? randomUUID()
      const highWater = profile.credentialMutationHighWater?.[token.clientId] ?? 0
      if (token.generation <= highWater) {
        throw new ModelConnectionConflictError(this['project'](current))
      }
      supersededToken = active?.operationToken
      const credentialTransactions = { ...current.credentialTransactions }
      credentialTransactions[providerId] = {
        operationToken: input.operationToken,
        clientId: token.clientId,
        generation: token.generation,
        incarnationId,
        phase: 'fenced',
        expiresAt: this['nowMs']() + this['credentialFenceTtlMs'](),
        previous: previousCredentialState(profile)
      }
      return {
        ...current,
        revision: current.revision + 1,
        profiles: {
          ...current.profiles,
          [providerId]: {
            ...profile,
            incarnationId,
            credentialMutationHighWater: boundedCredentialHighWater(
              profile.credentialMutationHighWater,
              token.clientId,
              token.generation
            )
          }
        },
        credentialTransactions,
        credentialRefCleanup: appendCredentialRefs(
          current.credentialRefCleanup,
          this['nowMs'](),
          active?.nextCredentialRef,
          active?.writerInstanceId,
          active?.writerPid
        )
      }
    })
    const local = this['preparedCredentialSecrets'].get(providerId)
    if (local && local.operationToken !== input.operationToken) {
      this['clearPreparedCredentialSecret'](providerId, local.operationToken)
    }
    if (supersededToken && supersededToken !== input.operationToken) {
      this['cancelCredentialRecoveryTimer'](providerId)
    }
    this['scheduleCredentialRecovery'](providerId, document.credentialTransactions[providerId])
    await this['changed'](document)
    await this['drainCredentialRefCleanup']()
    return this['projectWithCredentialHealth'](await this['file'].read(emptyDocument))
  },

/**
   * Stages a protected credential behind a provider-scoped fence. A prepared
   * value is deliberately absent from the durable Registry document and all
   * credential consumers fail closed until the matching operation token is
   * committed. A prepare without its previously admitted fence is rejected.
   */
async prepareCredential(this: ModelConnectionRegistry, providerId: string, raw: unknown): Promise<ModelConnectionSnapshot> {
    const input = ModelConnectionCredentialPrepareRequestSchema.parse(raw)
    let incarnationId = ''
    const document = await this['file'].update(emptyDocument, (current) => {
      assertRevision(current, input.expectedRevision, this['options'].modelCapabilities, this['credentialHealth'])
      const profile = requireProfile(current, providerId)
      const transaction = requireCredentialTransaction(current, providerId, input.operationToken)
      if (!profile.incarnationId || transaction.incarnationId !== profile.incarnationId) {
        throw new ModelConnectionConflictError(this['project'](current))
      }
      incarnationId = transaction.incarnationId
      return {
        ...current,
        revision: current.revision + 1,
        credentialTransactions: {
          ...current.credentialTransactions,
          [providerId]: {
            ...transaction,
            phase: 'prepared',
            expiresAt: this['nowMs']() + this['credentialFenceTtlMs']()
          }
        }
      }
    })
    const latest = await this['file'].read(emptyDocument)
    const latestTransaction = latest.credentialTransactions[providerId]
    if (
      latestTransaction?.operationToken !== input.operationToken ||
      latestTransaction.incarnationId !== incarnationId ||
      latestTransaction.phase !== 'prepared'
    ) {
      throw new ModelConnectionConflictError(await this['projectWithCredentialHealth'](latest))
    }
    this['clearPreparedCredentialSecret'](providerId)
    this['preparedCredentialSecrets'].set(providerId, {
      operationToken: input.operationToken,
      incarnationId,
      credential: input.credential.trim()
    })
    this['schedulePreparedCredentialSecretExpiry'](
      providerId,
      input.operationToken,
      latestTransaction.expiresAt
    )
    this['scheduleCredentialRecovery'](providerId, latestTransaction)
    await this['changed'](document)
    return this['projectWithCredentialHealth'](await this['file'].read(emptyDocument))
  },

/** Commits only the latest prepared token for this provider. */
async commitPreparedCredential(this: ModelConnectionRegistry, providerId: string, raw: unknown): Promise<ModelConnectionSnapshot> {
    const input = ModelConnectionCredentialCommitRequestSchema.parse(raw)
    const pending = this['preparedCredentialSecrets'].get(providerId)
    if (!pending || pending.operationToken !== input.operationToken) {
      throw new ModelConnectionConflictError(await this.snapshot())
    }
    const nextRef = `cred_${randomUUID()}`
    let previousRef: string | undefined
    let legacyCredentialSourceToRetire: string | undefined
    const committing = await this['file'].update(emptyDocument, (current) => {
      assertRevision(current, input.expectedRevision, this['options'].modelCapabilities, this['credentialHealth'])
      const transaction = requireCredentialTransaction(current, providerId, input.operationToken)
      const profile = requireProfile(current, providerId)
      if (
        transaction.phase !== 'prepared' ||
        transaction.incarnationId !== profile.incarnationId ||
        transaction.incarnationId !== pending.incarnationId
      ) {
        throw new ModelConnectionConflictError(this['project'](current))
      }
      previousRef = profile.credentialRef
      legacyCredentialSourceToRetire = this['options'].retireLegacyCredentialSource
        ? profile.legacyCredentialSourceToRetire ?? profile.credentialSourceId
        : undefined
      return {
        ...current,
        revision: current.revision + 1,
        credentialTransactions: {
          ...current.credentialTransactions,
          [providerId]: {
            ...transaction,
            phase: 'committing',
            expiresAt: this['nowMs']() + this['credentialFenceTtlMs'](),
            nextCredentialRef: nextRef,
            writerInstanceId: this['registryInstanceId'],
            writerPid: process.pid
          }
        }
      }
    })
    this['scheduleCredentialRecovery'](providerId, committing.credentialTransactions[providerId])
    try {
      await this['changed'](committing)
      await this['options'].afterCredentialCommitRecord?.(providerId)
      await this['options'].credentials.set(nextRef, { apiKey: pending.credential })
    } catch (error) {
      await this['abandonCredentialWrite'](providerId, input.operationToken, nextRef)
      throw error
    }
    await this['options'].afterCredentialCommitWrite?.(providerId)
    let document: RegistryDocument
    try {
      document = await this['file'].update(emptyDocument, (current) => {
        const transaction = requireCredentialTransaction(current, providerId, input.operationToken)
        const profile = requireProfile(current, providerId)
        if (
          transaction.phase !== 'committing' ||
          transaction.nextCredentialRef !== nextRef ||
          transaction.incarnationId !== profile.incarnationId ||
          transaction.incarnationId !== pending.incarnationId
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
            [providerId]: {
              ...profile,
              credentialRef: nextRef,
              credentialSourceId: undefined,
              ...(legacyCredentialSourceToRetire
                ? { legacyCredentialSourceToRetire }
                : {}),
              configured: true
            }
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
      throw error
    } finally {
      this['clearPreparedCredentialSecret'](providerId, input.operationToken)
    }
    this['cancelCredentialRecoveryTimer'](providerId)
    await this['changed'](document)
    await this['drainCredentialRefCleanup']()
    await this['retireLegacyCredentialSource'](providerId)
    return this['projectWithCredentialHealth'](await this['file'].read(emptyDocument))
  },

async replaceCredential(this: ModelConnectionRegistry, providerId: string, raw: unknown): Promise<ModelConnectionSnapshot> {
    const input = ModelConnectionCredentialRequestSchema.parse(raw)
    const nextRef = `cred_${randomUUID()}`
    const operationToken = `replace:${randomUUID()}`
    let previousRef: string | undefined
    let legacyCredentialSourceToRetire: string | undefined
    const committing = await this['file'].update(emptyDocument, (current) => {
      assertRevision(current, input.expectedRevision, this['options'].modelCapabilities, this['credentialHealth'])
      if (current.credentialTransactions[providerId]) {
        throw new ModelConnectionConflictError(this['project'](current))
      }
      const profile = requireProfile(current, providerId)
      const incarnationId = profile.incarnationId ?? randomUUID()
      previousRef = profile.credentialRef
      legacyCredentialSourceToRetire = this['options'].retireLegacyCredentialSource
        ? profile.legacyCredentialSourceToRetire ?? profile.credentialSourceId
        : undefined
      return {
        ...current,
        revision: current.revision + 1,
        profiles: profile.incarnationId
          ? current.profiles
          : { ...current.profiles, [providerId]: { ...profile, incarnationId } },
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
    this['scheduleCredentialRecovery'](providerId, committing.credentialTransactions[providerId])
    try {
      await this['changed'](committing)
      await this['options'].credentials.set(nextRef, { apiKey: input.credential.trim() })
    } catch (error) {
      await this['abandonCredentialWrite'](providerId, operationToken, nextRef)
      throw error
    }
    let document: RegistryDocument
    try {
      document = await this['file'].update(emptyDocument, (current) => {
        const transaction = current.credentialTransactions[providerId]
        const profile = current.profiles[providerId]
        if (
          transaction?.operationToken !== operationToken ||
          transaction.phase !== 'committing' ||
          transaction.nextCredentialRef !== nextRef ||
          !profile ||
          profile.incarnationId !== transaction.incarnationId
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
            [providerId]: {
              ...profile,
              credentialRef: nextRef,
              credentialSourceId: undefined,
              ...(legacyCredentialSourceToRetire
                ? { legacyCredentialSourceToRetire }
                : {}),
              configured: true
            }
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
      throw error
    }
    this['cancelCredentialRecoveryTimer'](providerId)
    await this['changed'](document)
    await this['drainCredentialRefCleanup']()
    await this['retireLegacyCredentialSource'](providerId)
    return this['projectWithCredentialHealth'](await this['file'].read(emptyDocument))
  },

async clearCredential(this: ModelConnectionRegistry,
    providerId: string,
    expectedRevision: number
  ): Promise<ModelConnectionSnapshot> {
    const fallbackHealth = await this['inspectCredentialHealth'](await this['file'].read(emptyDocument))
    let previousRef: string | undefined
    let legacyCredentialSourceToRetire: string | undefined
    let cancelledTransactionToken: string | undefined
    const document = await this['file'].update(emptyDocument, (current) => {
      assertRevision(current, expectedRevision, this['options'].modelCapabilities, this['credentialHealth'])
      const profile = requireProfile(current, providerId)
      previousRef = profile.credentialRef
      legacyCredentialSourceToRetire = this['options'].retireLegacyCredentialSource
        ? profile.legacyCredentialSourceToRetire ?? profile.credentialSourceId
        : undefined
      const transaction = current.credentialTransactions[providerId]
      if (transaction?.phase === 'recovering') {
        throw new ModelConnectionConflictError(this['project'](current))
      }
      cancelledTransactionToken = transaction?.operationToken
      const credentialTransactions = { ...current.credentialTransactions }
      delete credentialTransactions[providerId]
      const configured =
        profile.kind === 'agent-sdk' ||
        profile.kind === 'antigravity-cli' ||
        profile.kind === 'cursor-sdk'
      const profiles = {
        ...current.profiles,
        [providerId]: {
          ...profile,
          credentialRef: undefined,
          credentialSourceId: undefined,
          ...(legacyCredentialSourceToRetire ? { legacyCredentialSourceToRetire } : {}),
          configured
        }
      }
      const fallback = !configured && current.defaultProviderId === providerId
        ? configuredFallback(
            Object.values(profiles).filter((candidate) => candidate.id !== providerId),
            fallbackHealth
          )
        : undefined
      return {
        schemaVersion: 1,
        proxyRoutingVersion: 1,
        revision: current.revision + 1,
        profiles,
        tombstones: current.tombstones,
        credentialTransactions,
        credentialRefCleanup: appendCredentialRefs(
          appendCredentialRefs(current.credentialRefCleanup, this['nowMs'](), previousRef),
          this['nowMs'](),
          transaction?.nextCredentialRef,
          transaction?.writerInstanceId,
          transaction?.writerPid
        ),
        proxy: current.proxy,
        routePools: current.routePools,
        localModelGateway: current.localModelGateway,
        ...(!configured && current.defaultProviderId === providerId
          ? fallback ? {
              defaultProviderId: fallback.profile.id,
              defaultAccountId: fallback.profile.accountId,
              defaultModel: fallback.model
            } : {}
          : {
              defaultProviderId: current.defaultProviderId,
              defaultAccountId: current.defaultAccountId,
              defaultModel: current.defaultModel
            })
      }
    })
    this['clearPreparedCredentialSecret'](providerId, cancelledTransactionToken)
    this['cancelCredentialRecoveryTimer'](providerId)
    await this['changed'](document)
    await this['drainCredentialRefCleanup']()
    await this['retireLegacyCredentialSource'](providerId)
    return this['projectWithCredentialHealth'](await this['file'].read(emptyDocument))
  },

async delete(this: ModelConnectionRegistry, providerId: string, expectedRevision: number): Promise<ModelConnectionSnapshot> {
    const fallbackHealth = await this['inspectCredentialHealth'](await this['file'].read(emptyDocument))
    let credentialRef: string | undefined
    let legacyCredentialSourceToRetire: string | undefined
    let cancelledTransactionToken: string | undefined
    const document = await this['file'].update(emptyDocument, (current) => {
      assertRevision(current, expectedRevision, this['options'].modelCapabilities, this['credentialHealth'])
      const profile = requireProfile(current, providerId)
      credentialRef = profile.credentialRef
      legacyCredentialSourceToRetire = this['options'].retireLegacyCredentialSource
        ? profile.legacyCredentialSourceToRetire ?? profile.credentialSourceId
        : undefined
      const transaction = current.credentialTransactions[providerId]
      if (transaction?.phase === 'recovering') {
        throw new ModelConnectionConflictError(this['project'](current))
      }
      cancelledTransactionToken = transaction?.operationToken
      const credentialTransactions = { ...current.credentialTransactions }
      delete credentialTransactions[providerId]
      const profiles = { ...current.profiles }
      delete profiles[providerId]
      const fallback = configuredFallback(Object.values(profiles), fallbackHealth)
      return {
        schemaVersion: 1,
        proxyRoutingVersion: 1,
        revision: current.revision + 1,
        profiles,
        tombstones: {
          ...current.tombstones,
          [providerId]: {
            deletedRevision: current.revision + 1,
            credentialMutationHighWater: profile.credentialMutationHighWater,
            ...(legacyCredentialSourceToRetire ? { legacyCredentialSourceToRetire } : {})
          }
        },
        credentialTransactions,
        credentialRefCleanup: appendCredentialRefs(
          appendCredentialRefs(current.credentialRefCleanup, this['nowMs'](), credentialRef),
          this['nowMs'](),
          transaction?.nextCredentialRef,
          transaction?.writerInstanceId,
          transaction?.writerPid
        ),
        proxy: current.proxy,
        routePools: current.routePools,
        localModelGateway: current.localModelGateway,
        ...(current.defaultProviderId === providerId
          ? fallback ? {
              defaultProviderId: fallback.profile.id,
              defaultAccountId: fallback.profile.accountId,
              defaultModel: fallback.model
            } : {}
          : {
              defaultProviderId: current.defaultProviderId,
              defaultAccountId: current.defaultAccountId,
              defaultModel: current.defaultModel
            })
      }
    })
    this['clearPreparedCredentialSecret'](providerId, cancelledTransactionToken)
    this['cancelCredentialRecoveryTimer'](providerId)
    await this['changed'](document)
    await this['drainCredentialRefCleanup']()
    await this['retireDeletedLegacyCredentialSource'](providerId)
    return this['projectWithCredentialHealth'](await this['file'].read(emptyDocument))
  },
}
