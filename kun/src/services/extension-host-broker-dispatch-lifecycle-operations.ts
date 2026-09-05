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
import { type ExtensionHostBroker, RegistrationIdSchema, RegistrationRequestSchema, RunIdSchema, ThreadIdSchema, SubscriptionIdSchema, StorageRequestSchema, StorageKeysRequestSchema, StorageSetRequestSchema, ConfigurationSectionSchema, ConfigurationRequestSchema, ConfigurationUpdateRequestSchema, CommandRegisterSchema, CommandExecuteSchema, ModelStreamNotificationSchema, ModelStreamEnvelopePayloadSchema, DEFAULT_PROVIDER_STREAM_QUEUE_EVENTS, DEFAULT_PROVIDER_STREAM_QUEUE_BYTES, type ExtensionHostBrokerOptions, type ToolRegistration, type ProviderRegistration, type AgentSubscription, type JobSubscription, type CommandRegistration, type StoredAccountSession, type ExtensionBrokerDispatchRequest, type ProviderStreamEntry, requiredExtensionBrokerPermission, publicMediaMetadata, cacheFormat, publicMediaCapability, jobCaller, hostOwnsRegistration, registrationOwnedByPrincipal, normalizedRegistrationWorkspaceRoots, registrationIncludesWorkspace, sameRegistrationWorkspace, hostPrincipal, publicAgentRun, publicAgentEvent, publicOwnedThread, publicBudget, publicUsage, publicRunState, publicAccount, publicAccountSession, boundedError, providerCapabilities, resolveAuthentication, effectiveAuthenticationScopes, internalAuthenticationType, toolSideEffect, activationEventFor, requireManifestContribution, assertManifestDeclarationMatches, canonicalizeJson, expandProviderPermissions, requiredWorkspaceKey, viewStateKey, confinedWorkspacePath, verifyWorkspaceTarget, inside, assertNetworkPermission, responseProjection, readBoundedResponseBody, linkedAbortController, agentInputText, cancellationSignal, providerStreamKey, providerQueueLimitError, serializedQueueBytes, positiveQueueLimit, safeJsonObject, toPublicJson, toJson, isObject, AsyncEventQueue } from './extension-host-broker-core.js'

export const extensionHostBrokerDispatchLifecycleOperations = {
/** Complete a PKCE callback collected by a Main-owned protected surface. */
async completePkceAccountSession(this: ExtensionHostBroker, input: {
    principal: ExtensionPrincipal
    sessionId: string
    callbackUrl: string
  }): Promise<AccountSession> {
    const session = this['accountSessions'].get(input.sessionId)
    if (
      !session ||
      session.extensionId !== input.principal.extensionId ||
      session.kind !== 'oauth-pkce' ||
      !session.transactionId ||
      !session.providerId ||
      session.status !== 'pending'
    ) throw new Error('PKCE account session is not pending')
    const callback = new URL(input.callbackUrl)
    const code = callback.searchParams.get('code')
    const state = callback.searchParams.get('state')
    if (!code || !state) throw new Error('OAuth callback URL must contain code and state')
    try {
      const account = await this['options'].accounts.completePkceAuthorization({
        principal: this['expandPrincipalForProviderId'](input.principal, session.providerId),
        transactionId: session.transactionId,
        state,
        code,
        protectedCallback: true
      })
      session.status = 'completed'
      session.lastTouchedAt = this['now']().getTime()
      session.account = publicAccount(account, await this['publicCredentialProtection']())
      session.message = 'Account connected.'
      return publicAccountSession(session)
    } catch (error) {
      session.status = 'failed'
      session.lastTouchedAt = this['now']().getTime()
      session.message = boundedError(error)
      throw error
    }
  },

async disposeExtension(this: ExtensionHostBroker, extensionId: string): Promise<void> {
    const registrationIds = [...this['providers']]
      .filter(([, registration]) => registration.extensionId === extensionId)
      .map(([registrationId]) => registrationId)
    for (const [id, registration] of [...this['tools']]) {
      if (registration.extensionId !== extensionId) continue
      registration.dispose()
      this['tools'].delete(id)
    }
    for (const [id, registration] of [...this['providers']]) {
      if (registration.extensionId !== extensionId) continue
      await registration.dispose().catch(() => undefined)
      await this['options'].providerAccounts.unregisterProvider(
        this['principalWithProviderPermissions'](extensionId, [], registration.providerId),
        registration.providerId
      ).catch(() => undefined)
      this['providers'].delete(id)
    }
    for (const [id, entry] of [...this['subscriptions']]) {
      if (entry.extensionId !== extensionId) continue
      entry.subscription.close()
      this['subscriptions'].delete(id)
    }
    for (const [id, entry] of [...this['jobSubscriptions']]) {
      if (entry.extensionId !== extensionId) continue
      entry.subscription.close()
      this['jobSubscriptions'].delete(id)
    }
    for (const [id, entry] of [...this['commands']]) {
      if (entry.extensionId === extensionId) this['commands'].delete(id)
    }
    this['profileRegistrations'].get(extensionId)?.dispose()
    this['profileRegistrations'].delete(extensionId)
    for (const [id, session] of [...this['accountSessions']]) {
      if (session.extensionId !== extensionId) continue
      if (session.transactionId) {
        this['options'].accounts.cancelAuthorization(
          this['principalWithProviderPermissions'](extensionId, [], ''),
          session.transactionId
        )
      }
      this['accountSessions'].delete(id)
    }
    for (const [key, entry] of [...this['providerStreams']]) {
      if (registrationIds.some((registrationId) => key.startsWith(`${registrationId}:`))) {
        this['failProviderStream'](entry, new Error('extension host was disposed'))
        this['providerStreams'].delete(key)
      }
    }
  },

/** Dispose broker state admitted for one extension workspace only. */
async disposeExtensionWorkspace(this: ExtensionHostBroker, extensionId: string, workspaceId: string): Promise<void> {
    const ownsWorkspace = (entry: { extensionId: string; workspaceRoots: readonly string[] }) =>
      entry.extensionId === extensionId && registrationIncludesWorkspace(entry, workspaceId)
    const registrationIds = [...this['providers']]
      .filter(([, registration]) => ownsWorkspace(registration))
      .map(([registrationId]) => registrationId)
    for (const [id, registration] of [...this['tools']]) {
      if (!ownsWorkspace(registration)) continue
      registration.dispose()
      this['tools'].delete(id)
    }
    for (const [id, registration] of [...this['providers']]) {
      if (!ownsWorkspace(registration)) continue
      await registration.dispose().catch(() => undefined)
      await this['options'].providerAccounts.unregisterProvider(
        this['principalWithProviderPermissions'](extensionId, [], registration.providerId),
        registration.providerId
      ).catch(() => undefined)
      this['providers'].delete(id)
    }
    for (const [id, entry] of [...this['subscriptions']]) {
      if (!ownsWorkspace(entry)) continue
      entry.subscription.close()
      this['subscriptions'].delete(id)
    }
    for (const [id, entry] of [...this['jobSubscriptions']]) {
      if (!ownsWorkspace(entry)) continue
      entry.subscription.close()
      this['jobSubscriptions'].delete(id)
    }
    for (const [id, entry] of [...this['commands']]) {
      if (ownsWorkspace(entry)) this['commands'].delete(id)
    }
    for (const [id, session] of [...this['accountSessions']]) {
      if (!ownsWorkspace(session)) continue
      if (session.transactionId) {
        this['options'].accounts.cancelAuthorization(
          this['principalWithProviderPermissions'](extensionId, [], session.providerId ?? ''),
          session.transactionId
        )
      }
      this['accountSessions'].delete(id)
    }
    for (const [key, entry] of [...this['providerStreams']]) {
      if (registrationIds.some((registrationId) => key.startsWith(`${registrationId}:`))) {
        this['failProviderStream'](entry, new Error('extension host workspace was disposed'))
        this['providerStreams'].delete(key)
      }
    }
  },

/** Dispose only registrations owned by one exact Node Host generation. */
async disposeHost(this: ExtensionHostBroker, hostPrincipalValue: HostExtensionPrincipal): Promise<void> {
    const principal = hostPrincipal(hostPrincipalValue)
    const registrationIds = [...this['providers']]
      .filter(([, registration]) => hostOwnsRegistration(principal, registration))
      .map(([registrationId]) => registrationId)
    for (const [id, registration] of [...this['tools']]) {
      if (!hostOwnsRegistration(principal, registration)) continue
      registration.dispose()
      this['tools'].delete(id)
    }
    for (const [id, registration] of [...this['providers']]) {
      if (!hostOwnsRegistration(principal, registration)) continue
      await registration.dispose().catch(() => undefined)
      await this['options'].providerAccounts.unregisterProvider(
        principal,
        registration.providerId
      ).catch(() => undefined)
      this['providers'].delete(id)
    }
    for (const [id, entry] of [...this['subscriptions']]) {
      if (!hostOwnsRegistration(principal, entry)) continue
      entry.subscription.close()
      this['subscriptions'].delete(id)
    }
    for (const [id, entry] of [...this['jobSubscriptions']]) {
      if (!hostOwnsRegistration(principal, entry)) continue
      entry.subscription.close()
      this['jobSubscriptions'].delete(id)
    }
    for (const [id, entry] of [...this['commands']]) {
      if (hostOwnsRegistration(principal, entry)) this['commands'].delete(id)
    }
    for (const [key, entry] of [...this['providerStreams']]) {
      if (
        hostOwnsRegistration(principal, entry) ||
        registrationIds.some((registrationId) => key.startsWith(`${registrationId}:`))
      ) {
        this['failProviderStream'](entry, new Error('extension host was disposed'))
        this['providerStreams'].delete(key)
      }
    }
  },

disposeViewSession(this: ExtensionHostBroker, viewSessionId: string): number {
    let disposed = 0
    for (const [id, entry] of [...this['subscriptions']]) {
      if (entry.viewSessionId !== viewSessionId) continue
      entry.subscription.close()
      this['subscriptions'].delete(id)
      disposed += 1
    }
    for (const [id, entry] of [...this['jobSubscriptions']]) {
      if (entry.viewSessionId !== viewSessionId) continue
      entry.subscription.close()
      this['jobSubscriptions'].delete(id)
      disposed += 1
    }
    return disposed
  },

async dispose(this: ExtensionHostBroker): Promise<void> {
    const ids = new Set([
      ...[...this['tools'].values()].map((entry) => entry.extensionId),
      ...[...this['providers'].values()].map((entry) => entry.extensionId),
      ...[...this['subscriptions'].values()].map((entry) => entry.extensionId),
      ...[...this['jobSubscriptions'].values()].map((entry) => entry.extensionId),
      ...[...this['commands'].values()].map((entry) => entry.extensionId),
      ...[...this['accountSessions'].values()].map((entry) => entry.extensionId),
      ...[...this['providerStreams'].values()].map((entry) => entry.extensionId),
      ...this['profileRegistrations'].keys()
    ])
    for (const id of ids) await this.disposeExtension(id)
  },

failProviderStream(this: ExtensionHostBroker, entry: ProviderStreamEntry, error: Error): void {
    entry.queue.fail(error)
    if (!entry.controller.signal.aborted) entry.controller.abort(error)
  },

async dispatch(this: ExtensionHostBroker,
    principal: ExtensionPrincipal,
    request: ExtensionBrokerDispatchRequest,
    trustedManagement: boolean,
    nodeHost: boolean
  ): Promise<unknown> {
    switch (request.method) {
      case 'commands.register':
        return this['registerCommand'](principal, request.params)
      case 'commands.unregister':
        return this['unregisterCommand'](principal, request.params)
      case 'commands.execute':
        return this['executeCommand'](principal, request.params, request.signal)
      case 'storage.get':
      case 'storage.set':
      case 'storage.delete':
      case 'storage.keys':
        return this['storage'](principal, request.method, request.params)
      case 'secrets.get':
      case 'secrets.set':
      case 'secrets.delete':
        if (!nodeHost) {
          throw new Error('Protected extension secrets are available only to the Node Extension Host')
        }
        return this['secrets'](principal, request.method, request.params)
      case 'configuration.get':
      case 'configuration.update':
      case 'configuration.keys':
        return this['configuration'](principal, request.method, request.params)
      case 'network.fetch':
        return this['networkFetch'](principal, request.params, request.signal)
      case 'ui.getTheme':
        return (await this['options'].onUiRequest?.({
          principal,
          method: request.method,
          params: request.params,
          signal: request.signal
        })) ?? {
          kind: 'dark', tokens: {}, zoomFactor: 1, reducedMotion: false
        }
      case 'ui.getLocale':
        return (await this['options'].onUiRequest?.({
          principal,
          method: request.method,
          params: request.params,
          signal: request.signal
        })) ?? {
          language: 'en', direction: 'ltr', messages: {}
        }
      case 'ui.getViewState':
        return this['viewStateGet'](principal)
      case 'ui.setViewState':
        return this['viewStateSet'](principal, request.params)
      case 'ui.postMessage':
      case 'ui.showNotification':
        return (await this['options'].onUiRequest?.({
          principal,
          method: request.method,
          params: request.params,
          signal: request.signal
        })) ??
          (request.method === 'ui.showNotification' ? {} : null)
      case 'ui.attachComposerContext':
        throw new Error(
          'ui.attachComposerContext is available only through an authenticated desktop Extension View'
        )
      case 'agent.getRunOptions':
        return this['agentGetRunOptions'](principal)
      case 'agent.createRun':
        await this['ensureProfiles'](principal)
        return this['agentCreateRun'](principal, request.params)
      case 'agent.getRun':
        return this['agentGetRun'](principal, request.params)
      case 'agent.listRunEvents':
        return this['agentListRunEvents'](principal, request.params)
      case 'agent.subscribe':
        return this['agentSubscribe'](principal, request.params)
      case 'agent.unsubscribe':
        return this['agentUnsubscribe'](principal, request.params)
      case 'agent.steer':
        return this['agentSteer'](principal, request.params)
      case 'agent.cancel':
        return this['agentCancel'](principal, request.params)
      case 'threads.listOwn':
        return this['threadsListOwn'](principal, request.params)
      case 'threads.getOwn':
        return this['threadsGetOwn'](principal, request.params)
      case 'tools.register':
        return this['registerTool'](principal, request.params)
      case 'tools.unregister':
        return this['unregisterTool'](principal, request.params)
      case 'modelProviders.register':
        return this['registerProvider'](principal, request.params)
      case 'modelProviders.unregister':
        return this['unregisterProvider'](principal, request.params)
      case 'modelProviders.getStatus':
        return this['providerStatus'](principal, request.params)
      case 'authentication.listAccounts':
        return this['listAccounts'](principal, request.params)
      case 'authentication.createSession':
        return this['createAccountSession'](principal, request.params, trustedManagement)
      case 'authentication.getSession':
        return this['getAccountSession'](principal, request.params, trustedManagement)
      case 'authentication.cancelSession':
        return this['cancelAccountSession'](principal, request.params)
      case 'authentication.deleteAccount':
        return this['deleteAccount'](principal, request.params)
      case 'authentication.authenticatedFetch':
        return this['authenticatedFetch'](principal, request.params, request.signal)
      case 'authentication.revealSecret':
        return this['revealSecret'](principal, request.params, request.signal, nodeHost)
      case 'workspace.readFile':
      case 'workspace.writeFile':
      case 'workspace.stat':
      case 'workspace.list':
        return this['workspace'](principal, request.method, request.params)
      case 'media.pickFiles':
        return this['mediaPickFiles'](principal, request.params, request.signal)
      case 'media.pickSaveTarget':
        return this['mediaPickSaveTarget'](principal, request.params, request.signal)
      case 'media.createCacheTarget':
        return this['mediaCreateCacheTarget'](principal, request.params)
      case 'media.stat':
        return this['mediaStat'](principal, request.params)
      case 'media.readText':
        return this['mediaReadText'](principal, request.params)
      case 'media.release':
        return this['mediaRelease'](principal, request.params, request.signal)
      case 'media.openViewResource':
        return this['mediaOpenViewResource'](principal, request.params, request.signal)
      case 'media.performArtifactAction':
        return this['mediaPerformArtifactAction'](principal, request.params, request.signal)
      case 'media.getCapabilities':
        return this['mediaGetCapabilities'](principal)
      case 'media.getAudioAnalysisCapabilities':
        return this['mediaGetAudioAnalysisCapabilities'](principal)
      case 'media.getVisualModelStatus':
        return this['mediaGetVisualModelStatus'](principal)
      case 'media.installVisualModel':
        return this['mediaInstallVisualModel'](principal, request.params)
      case 'media.analyzeVisualFrames':
        return this['mediaAnalyzeVisualFrames'](principal, request.params, request.signal)
      case 'media.embedVisualQuery':
        return this['mediaEmbedVisualQuery'](principal, request.params, request.signal)
      case 'media.probe':
        return this['mediaProbe'](principal, request.params)
      case 'media.startFfmpegJob':
        return this['mediaStartFfmpegJob'](principal, request.params)
      case 'media.startAudioAnalysisJob':
        return this['mediaStartAudioAnalysisJob'](principal, request.params)
      case 'media.startArchiveJob':
        return this['mediaStartArchiveJob'](principal, request.params)
      case 'jobs.get':
        return this['jobsGet'](principal, request.params)
      case 'jobs.list':
        return this['jobsList'](principal, request.params)
      case 'jobs.subscribe':
        return this['jobsSubscribe'](principal, request.params)
      case 'jobs.unsubscribe':
        return this['jobsUnsubscribe'](principal, request.params)
      case 'jobs.cancel':
        return this['jobsCancel'](principal, request.params)
      default:
        throw new Error(`unsupported Extension Host broker method: ${request.method}`)
    }
  },
}
