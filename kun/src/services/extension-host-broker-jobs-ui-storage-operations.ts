import { createHash, randomUUID } from 'node:crypto'
import { readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { z } from 'zod'
import {
  AccountSchema,
  ArtifactHostActionRequestSchema,
  ArtifactHostActionResultSchema,
  AgentCancelRequestSchema,
  AgentCreateRunRequestSchema,
  AgentRunEventSchema,
  AgentRunSchema,
  AgentSteerRequestSchema,
  AgentSubscribeRequestSchema,
  AuthenticatedFetchRequestSchema,
  CreateAccountSessionRequestSchema,
  ExtensionToolDeclarationSchema,
  JsonObjectSchema,
  JsonValueSchema,
  ListAccountsRequestSchema,
  ListOwnThreadsRequestSchema,
  JobCancelRequestSchema,
  JobGetRequestSchema,
  JobListRequestSchema,
  JobSnapshotSchema,
  MediaAudioAnalysisCapabilitiesSchema,
  MediaAnalyzeVisualFramesRequestSchema,
  MediaAnalyzeVisualFramesResultSchema,
  MediaEmbedVisualQueryRequestSchema,
  MediaEmbedVisualQueryResultSchema,
  MediaInstallVisualModelRequestSchema,
  MediaMetadataSchema,
  MediaCapabilitiesSchema,
  MediaCreateCacheTargetRequestSchema,
  MediaCreateCacheTargetResultSchema,
  MediaOpenViewResourceRequestSchema,
  MediaPickFilesRequestSchema,
  MediaPickFilesResultSchema,
  MediaPickSaveTargetRequestSchema,
  MediaPickSaveTargetResultSchema,
  MediaProbeRequestSchema,
  MediaProbeResultSchema,
  MediaReadTextRequestSchema,
  MediaReadTextResultSchema,
  MediaReleaseRequestSchema,
  MediaResourceLeaseSchema,
  MediaStartFfmpegJobRequestSchema,
  MediaStartAudioAnalysisJobRequestSchema,
  MediaStartAudioAnalysisJobResultSchema,
  MediaStartArchiveJobRequestSchema,
  MediaStartArchiveJobResultSchema,
  MediaVisualModelStatusSchema,
  ModelProviderDeclarationSchema,
  ModelProviderStreamEventSchema,
  NetworkRequestSchema,
  ProviderBindingSchema,
  RevealSecretRequestSchema,
  ToolProgressSchema,
  ToolResultSchema,
  WorkspaceFileSchema,
  type Account,
  type AccountSession,
  type AgentRun,
  type AgentRunEvent,
  type AuthenticationProviderDeclaration,
  type CommandContribution,
  type ExtensionManifest,
  type JsonValue as PublicJsonValue,
  type ModelProviderAdapter,
  type ModelProviderRequest,
  type ModelProviderStreamEvent,
  type ProviderBinding
} from '@kun/extension-api'
import type { ExtensionModelProviderRegistry } from '../adapters/model/extension-model-provider.js'
import type { ExtensionToolRegistry } from '../adapters/tool/extension-tool-provider.js'
import type { ToolExecutionUpdate } from '../ports/tool-host.js'
import type {
  ExtensionBrokerRequest,
  ExtensionPrincipal as HostExtensionPrincipal
} from '../extensions/host-process.js'
import { extensionWorkspaceKey } from '../extensions/paths.js'
import type { JsonValue } from '../extensions/types.js'
import type { ExtensionStateStore } from '../extensions/state-store.js'
import {
  assertBrokeredNetworkUrl,
  createSafeNetworkFetch,
  normalizedBrokerHostname
} from '../extensions/safe-network-fetch.js'
import {
  extensionProviderBindingScope,
  extensionProviderId,
  type ExtensionProviderAccountStore
} from './extension-provider-account-store.js'
import type { ExtensionAccountBroker } from './extension-account-broker.js'
import type { ExtensionCredentialStore } from './extension-credential-store.js'
import type { ExtensionConfigurationService } from './extension-configuration-service.js'
import type { ExtensionArtifactService } from './extension-artifact-service.js'
import type { ExtensionMediaHandleService, MediaHandleProjection } from './extension-media-handle-service.js'
import type { ExtensionMediaProcessService } from './extension-media-process-service.js'
import type { ExtensionMediaJobService } from './extension-media-job-service.js'
import type { ExtensionAudioAnalysisJobService } from './extension-audio-analysis-job-service.js'
import type { ExtensionMediaArchiveJobService } from './extension-media-archive-job-service.js'
import type { ExtensionVisualAnalysisService } from './extension-visual-analysis-service.js'
import type { ExtensionJobService } from './extension-job-service.js'
import type { ExtensionJobSubscription } from './extension-job-subscription.js'
import type {
  ExtensionAgentEvent,
  ExtensionAgentRun,
  ExtensionAgentService,
  ExtensionAgentSubscription,
  ExtensionOwnedThread,
  ExtensionPrincipal
} from './extension-agent-service.js'
import type { ExtensionAgentProfileRegistry } from './extension-agent-profile-registry.js'
import {
  compileExtensionJsonSchema,
  type ExtensionJsonSchemaValidator
} from '../extensions/json-schema-validator.js'
import { extensionError } from '../extensions/errors.js'
import { type ExtensionHostBroker, RegistrationIdSchema, RegistrationRequestSchema, RunIdSchema, ThreadIdSchema, SubscriptionIdSchema, StorageRequestSchema, StorageKeysRequestSchema, StorageSetRequestSchema, SecretRequestSchema, SecretSetRequestSchema, ConfigurationSectionSchema, ConfigurationRequestSchema, ConfigurationUpdateRequestSchema, CommandRegisterSchema, CommandExecuteSchema, ModelStreamNotificationSchema, ModelStreamEnvelopePayloadSchema, DEFAULT_PROVIDER_STREAM_QUEUE_EVENTS, DEFAULT_PROVIDER_STREAM_QUEUE_BYTES, type ExtensionHostBrokerOptions, type ToolRegistration, type ProviderRegistration, type AgentSubscription, type JobSubscription, type CommandRegistration, type StoredAccountSession, type ExtensionBrokerDispatchRequest, type ProviderStreamEntry, requiredExtensionBrokerPermission, publicMediaMetadata, cacheFormat, publicMediaCapability, jobCaller, hostOwnsRegistration, registrationOwnedByPrincipal, normalizedRegistrationWorkspaceRoots, registrationIncludesWorkspace, sameRegistrationWorkspace, hostPrincipal, publicAgentRun, publicAgentEvent, publicOwnedThread, publicBudget, publicUsage, publicRunState, publicAccount, publicAccountSession, boundedError, providerCapabilities, resolveAuthentication, effectiveAuthenticationScopes, internalAuthenticationType, toolSideEffect, activationEventFor, requireManifestContribution, assertManifestDeclarationMatches, canonicalizeJson, expandProviderPermissions, requiredWorkspaceKey, viewStateKey, confinedWorkspacePath, verifyWorkspaceTarget, inside, assertNetworkPermission, responseProjection, readBoundedResponseBody, linkedAbortController, agentInputText, cancellationSignal, providerStreamKey, providerQueueLimitError, serializedQueueBytes, positiveQueueLimit, safeJsonObject, toPublicJson, toJson, isObject, AsyncEventQueue } from './extension-host-broker-core.js'

export const extensionHostBrokerJobsUiStorageOperations = {
async jobsGet(this: ExtensionHostBroker, principal: ExtensionPrincipal, params: JsonValue) {
    const jobs = this['requireJobs'](principal)
    const request = JobGetRequestSchema.parse(params)
    return JobSnapshotSchema.parse(await jobs.getOwned(jobCaller(principal), request.jobId))
  },

async jobsList(this: ExtensionHostBroker, principal: ExtensionPrincipal, params: JsonValue) {
    const jobs = this['requireJobs'](principal)
    const request = JobListRequestSchema.parse(params)
    return await jobs.listOwned(jobCaller(principal), {
      ...(request.filter ? { filter: request.filter } : {}),
      ...(request.cursor ? { cursor: request.cursor } : {}),
      limit: request.limit
    })
  },

async jobsSubscribe(this: ExtensionHostBroker, principal: ExtensionPrincipal, params: JsonValue) {
    const jobs = this['requireJobs'](principal)
    const request = z.strictObject({
      jobId: z.string().min(8).max(512),
      afterCursor: z.string().min(8).max(512).optional()
    }).parse(params)
    const subscription = await jobs.subscribe(
      jobCaller(principal),
      request.jobId,
      request.afterCursor
    )
    if (!subscription.complete) {
      this['jobSubscriptions'].set(subscription.subscriptionId, {
        extensionId: principal.extensionId,
        ...(principal.hostLifecycleNonce
          ? { hostLifecycleNonce: principal.hostLifecycleNonce }
          : {}),
        ...(principal.viewSessionId ? { viewSessionId: principal.viewSessionId } : {}),
        workspaceRoots: normalizedRegistrationWorkspaceRoots(principal.workspaceRoots),
        subscription
      })
      void this['pumpJobSubscription'](principal, subscription)
    }
    return {
      subscriptionId: subscription.subscriptionId,
      snapshot: JobSnapshotSchema.parse(subscription.snapshot),
      replay: subscription.replay,
      cursor: subscription.cursor,
      gap: subscription.gap,
      complete: subscription.complete
    }
  },

jobsUnsubscribe(this: ExtensionHostBroker, principal: ExtensionPrincipal, params: JsonValue) {
    const jobs = this['requireJobs'](principal)
    const { subscriptionId } = SubscriptionIdSchema.parse(params)
    const entry = this['jobSubscriptions'].get(subscriptionId)
    if (entry && registrationOwnedByPrincipal(entry, principal)) {
      jobs.unsubscribe(jobCaller(principal), subscriptionId)
      entry.subscription.close()
      this['jobSubscriptions'].delete(subscriptionId)
    }
    return null
  },

async jobsCancel(this: ExtensionHostBroker, principal: ExtensionPrincipal, params: JsonValue) {
    const jobs = this['requireJobs'](principal)
    const request = JobCancelRequestSchema.parse(params)
    return await jobs.cancel(jobCaller(principal), request.jobId, request.reason)
  },

requireJobs(this: ExtensionHostBroker, principal: ExtensionPrincipal): ExtensionJobService {
    if (!principal.permissions.includes('jobs.manage')) throw new Error('Missing permission: jobs.manage')
    if (!this['options'].jobs) throw new Error('Extension job service is unavailable')
    return this['options'].jobs
  },

async pumpJobSubscription(this: ExtensionHostBroker,
    principal: ExtensionPrincipal,
    subscription: ExtensionJobSubscription
  ): Promise<void> {
    try {
      for await (const item of subscription) {
        if (item.type === 'overflow') break
        const notification = toJson({ subscriptionId: subscription.subscriptionId, event: item.event })
        if (principal.viewSessionId) {
          if (!this['options'].notifyView) throw new Error('View notification bridge is unavailable')
          await this['options'].notifyView({ principal, method: 'jobs.event', params: notification })
        } else {
          await this['options'].notifyExtension?.(principal, 'jobs.event', notification)
        }
      }
    } finally {
      const entry = this['jobSubscriptions'].get(subscription.subscriptionId)
      if (entry?.subscription === subscription) this['jobSubscriptions'].delete(subscription.subscriptionId)
      subscription.close()
    }
  },

async requireUiOperation(this: ExtensionHostBroker,
    principal: ExtensionPrincipal,
    method: string,
    params: unknown,
    signal: AbortSignal
  ): Promise<JsonValue> {
    if (!this['options'].onUiRequest) {
      throw extensionError(
        'MEDIA_INTERACTION_REQUIRED',
        'Media operation requires protected desktop interaction',
        { operation: method }
      )
    }
    const result = await this['options'].onUiRequest({
      principal,
      method,
      params: toJson(params),
      signal
    })
    if (result === undefined) {
      throw extensionError(
        'MEDIA_INTERACTION_REQUIRED',
        'Media operation requires protected desktop interaction',
        { operation: method }
      )
    }
    return result
  },

async registerCommand(this: ExtensionHostBroker, principal: ExtensionPrincipal, params: JsonValue) {
    const input = CommandRegisterSchema.parse(params)
    const manifest = await this['options'].resolveManifest?.(principal.extensionId)
    const contribution = requireManifestContribution(manifest?.contributes.commands, input.id, 'command')
    const inputValidator = contribution.inputSchema
      ? compileExtensionJsonSchema(contribution.inputSchema, `command ${input.id} input`)
      : undefined
    const outputValidator = contribution.outputSchema
      ? compileExtensionJsonSchema(contribution.outputSchema, `command ${input.id} output`)
      : undefined
    const registrationId = `command_${randomUUID()}`
    this['commands'].set(registrationId, {
      extensionId: principal.extensionId,
      ...(principal.hostLifecycleNonce
        ? { hostLifecycleNonce: principal.hostLifecycleNonce }
        : {}),
      workspaceRoots: normalizedRegistrationWorkspaceRoots(principal.workspaceRoots),
      localId: input.id,
      activationEvent: activationEventFor(manifest, `onCommand:${input.id}`),
      contribution,
      ...(inputValidator ? { inputValidator } : {}),
      ...(outputValidator ? { outputValidator } : {})
    })
    return { registrationId }
  },

unregisterCommand(this: ExtensionHostBroker, principal: ExtensionPrincipal, params: JsonValue) {
    const { registrationId } = RegistrationRequestSchema.parse(params)
    const registration = this['commands'].get(registrationId)
    if (registrationOwnedByPrincipal(registration, principal)) this['commands'].delete(registrationId)
    return null
  },

async executeCommand(this: ExtensionHostBroker, principal: ExtensionPrincipal, params: JsonValue, signal: AbortSignal) {
    const input = CommandExecuteSchema.parse(params)
    const registration = [...this['commands'].entries()].find(([, entry]) =>
      entry.extensionId === principal.extensionId &&
      entry.localId === input.id &&
      sameRegistrationWorkspace(entry.workspaceRoots, principal.workspaceRoots) &&
      (principal.hostLifecycleNonce === undefined ||
        entry.hostLifecycleNonce === principal.hostLifecycleNonce)
    )
    if (!registration) throw new Error(`command is not registered: ${input.id}`)
    const [registrationId, entry] = registration
    const args = input.args ?? null
    entry.inputValidator?.assert(args, `command ${input.id} arguments`)
    const result = await this['options'].invokeExtension(
      principal.extensionId,
      entry.activationEvent,
      `commands.invoke:${registrationId}`,
      toJson(args),
      { signal, workspaceRoots: [...entry.workspaceRoots] }
    )
    entry.outputValidator?.assert(result, `command ${input.id} result`)
    return result
  },

async storage(this: ExtensionHostBroker, principal: ExtensionPrincipal, method: string, params: JsonValue) {
    const input = method === 'storage.keys'
      ? StorageKeysRequestSchema.parse(params)
      : method === 'storage.set'
        ? StorageSetRequestSchema.parse(params)
        : StorageRequestSchema.parse(params)
    const workspaceKey = input.scope === 'workspace' ? requiredWorkspaceKey(principal) : undefined
    if (method === 'storage.keys') {
      const document = await this['options'].state.read(principal.extensionId)
      const values = input.scope === 'global'
        ? document.global
        : document.workspaces[workspaceKey!] ?? {}
      return Object.keys(values).filter((key) => !key.startsWith('__kun_')).sort()
    }
    const keyed = input as z.infer<typeof StorageRequestSchema>
    if (keyed.key.startsWith('__kun_')) throw new Error('Reserved extension state key')
    const get = () => input.scope === 'global'
      ? this['options'].state.getGlobal(principal.extensionId, keyed.key)
      : this['options'].state.getWorkspace(principal.extensionId, workspaceKey!, keyed.key)
    const set = (value: JsonValue | undefined) => input.scope === 'global'
      ? this['options'].state.setGlobal(principal.extensionId, keyed.key, value)
      : this['options'].state.setWorkspace(principal.extensionId, workspaceKey!, keyed.key, value)
    if (method === 'storage.get') {
      const value = await get()
      return value === undefined ? { found: false } : { found: true, value }
    }
    if (method === 'storage.set') {
      await set(toJson(StorageSetRequestSchema.parse(params).value))
      return null
    }
    if (method === 'storage.delete') {
      const existed = (await get()) !== undefined
      await set(undefined)
      return { deleted: existed }
    }
    throw new Error(`unsupported storage broker method: ${method}`)
  },

async secrets(this: ExtensionHostBroker, principal: ExtensionPrincipal, method: string, params: JsonValue) {
    const input = method === 'secrets.set'
      ? SecretSetRequestSchema.parse(params)
      : SecretRequestSchema.parse(params)
    const reference = extensionSecretReference(principal.extensionId, input.key)
    if (method === 'secrets.get') {
      const stored = await this['options'].credentials.get(reference)
      return stored?.clientSecret === undefined
        ? { found: false }
        : { found: true, value: stored.clientSecret }
    }
    if (method === 'secrets.set') {
      await this['options'].credentials.set(reference, {
        clientSecret: SecretSetRequestSchema.parse(params).value
      })
      return null
    }
    if (method === 'secrets.delete') {
      const existed = (await this['options'].credentials.get(reference)) !== null
      if (existed) await this['options'].credentials.delete(reference)
      return { deleted: existed }
    }
    throw new Error(`unsupported secrets broker method: ${method}`)
  },

async configuration(this: ExtensionHostBroker, principal: ExtensionPrincipal, method: string, params: JsonValue) {
    const manifest = await this['options'].resolveManifest?.(principal.extensionId)
    if (!manifest || manifest.version !== principal.extensionVersion) {
      throw new Error('Extension manifest is unavailable or changed')
    }
    if (method === 'configuration.keys') {
      const input = z.strictObject({ sectionId: ConfigurationSectionSchema }).parse(params)
      return this['options'].configuration.keys({ manifest, sectionId: input.sectionId })
    }
    const input = method === 'configuration.update'
      ? ConfigurationUpdateRequestSchema.parse(params)
      : ConfigurationRequestSchema.parse(params)
    if (method === 'configuration.get') {
      const value = await this['options'].configuration.get({
        principal,
        manifest,
        sectionId: input.sectionId,
        key: input.key
      })
      return value === undefined ? { found: false } : { found: true, value }
    }
    await this['options'].configuration.update({
      principal,
      manifest,
      sectionId: input.sectionId,
      key: input.key,
      value: ConfigurationUpdateRequestSchema.parse(params).value
    })
    return null
  },

async viewStateGet(this: ExtensionHostBroker, principal: ExtensionPrincipal) {
    const key = viewStateKey(principal)
    const value = principal.workspaceRoots.length > 0
      ? await this['options'].state.getWorkspace(
          principal.extensionId,
          requiredWorkspaceKey(principal),
          key
        )
      : await this['options'].state.getGlobal(principal.extensionId, key)
    return value === undefined ? { found: false } : { found: true, value }
  },

async viewStateSet(this: ExtensionHostBroker, principal: ExtensionPrincipal, params: JsonValue) {
    const input = z.strictObject({ value: JsonValueSchema }).parse(params)
    const key = viewStateKey(principal)
    if (principal.workspaceRoots.length > 0) {
      await this['options'].state.setWorkspace(
        principal.extensionId,
        requiredWorkspaceKey(principal),
        key,
        toJson(input.value)
      )
    } else {
      await this['options'].state.setGlobal(principal.extensionId, key, toJson(input.value))
    }
    return null
  },

async networkFetch(this: ExtensionHostBroker, principal: ExtensionPrincipal, params: JsonValue, signal: AbortSignal) {
    const input = NetworkRequestSchema.parse(params)
    const url = new URL(input.url)
    assertBrokeredNetworkUrl(url)
    assertNetworkPermission(principal, normalizedBrokerHostname(url))
    const controller = linkedAbortController(signal, input.timeoutMs)
    try {
      const response = await this['fetchImpl'](input.url, {
        method: input.method,
        headers: input.headers,
        ...(input.body === undefined ? {} : {
          body: input.bodyEncoding === 'base64' ? Buffer.from(input.body, 'base64') : input.body
        }),
        signal: controller.signal,
        redirect: 'manual'
      })
      return responseProjection(response)
    } finally {
      controller.dispose()
    }
  },
}

function extensionSecretReference(extensionId: string, key: string): string {
  const digest = createHash('sha256')
    .update('kun-extension-secret\0')
    .update(extensionId)
    .update('\0')
    .update(key)
    .digest('hex')
  return `cred_${digest}`
}
