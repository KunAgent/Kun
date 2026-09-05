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
  AgentListRunEventsRequestSchema,
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

export const extensionHostBrokerAgentsOperations = {
async agentGetRunOptions(this: ExtensionHostBroker, principal: ExtensionPrincipal) {
    return this['options'].agent.getRunOptions(principal)
  },

async agentCreateRun(this: ExtensionHostBroker, principal: ExtensionPrincipal, params: JsonValue) {
    const input = AgentCreateRunRequestSchema.parse(params)
    let normalizedBinding = input.providerBinding
      ? { ...input.providerBinding, providerId: this['resolveProviderId'](principal, input.providerBinding.providerId) }
      : undefined
    if (!normalizedBinding && input.profileId) {
      const manifest = await this['options'].resolveManifest?.(principal.extensionId)
      const localProfileId = input.profileId.startsWith(`${principal.extensionId}/`)
        ? input.profileId.slice(principal.extensionId.length + 1)
        : input.profileId
      const profileBinding = manifest?.contributes.agentProfiles.find(
        (profile) => profile.id === localProfileId
      )?.providerBinding
      if (profileBinding) {
        const providerId = this['resolveProviderId'](principal, profileBinding.providerId)
        const stored = profileBinding.accountId
          ? undefined
          : await this['options'].providerAccounts.getBinding(
              extensionProviderBindingScope(input.workspace ?? principal.workspaceRoots[0]),
              providerId
            )
        if (
          !profileBinding.accountId &&
          (!stored ||
            stored.ownerExtensionId !== principal.extensionId ||
            stored.ownerExtensionVersion !== principal.extensionVersion)
        ) {
          throw new Error(`connected account binding is required for extension provider profile: ${localProfileId}`)
        }
        normalizedBinding = {
          providerId,
          accountId: profileBinding.accountId ?? stored!.binding.accountId,
          modelId: profileBinding.modelId
        }
      }
    }
    if (normalizedBinding) await this['options'].providerAccounts.validateBinding(normalizedBinding)
    const servicePrincipal = await this['expandPrincipalForBinding'](principal, normalizedBinding)
    const run = await this['options'].agent.createRun(servicePrincipal, {
      input: agentInputText(input.input),
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.workspace ? { workspace: input.workspace } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
      ...(input.profileId ? { profileId: input.profileId } : {}),
      ...(normalizedBinding ? { providerBinding: normalizedBinding } : {}),
      ...(input.budget ? { budget: {
        ...input.budget,
        ...(input.budget.maxEvents ? { maxRetainedEvents: input.budget.maxEvents } : {})
      } } : {}),
      ...(input.allowedTools ? { allowedTools: input.allowedTools } : {}),
      ...(input.visibility ? { visibility: input.visibility } : {})
    })
    return { run: publicAgentRun(run), createdThread: !input.threadId }
  },

async agentGetRun(this: ExtensionHostBroker, principal: ExtensionPrincipal, params: JsonValue) {
    const { runId } = RunIdSchema.parse(params)
    return publicAgentRun(await this['options'].agent.getRun(principal, runId))
  },

async agentListRunEvents(this: ExtensionHostBroker, principal: ExtensionPrincipal, params: JsonValue) {
    const input = AgentListRunEventsRequestSchema.parse(params)
    const page = await this['options'].agent.listRunEvents(principal, input)
    return {
      items: page.items.map(publicAgentEvent),
      cursor: page.cursor,
      hasMore: page.hasMore,
      historyIncomplete: page.historyIncomplete
    }
  },

async agentSubscribe(this: ExtensionHostBroker, principal: ExtensionPrincipal, params: JsonValue) {
    const input = AgentSubscribeRequestSchema.parse(params)
    const subscriptionId = `agentsub_${randomUUID()}`
    const replay: AgentRunEvent[] = []
    let replaying = true
    let terminalSeen = false
    const listener = async (event: ExtensionAgentEvent) => {
      const projected = publicAgentEvent(event)
      if (replaying) replay.push(projected)
      else {
        const notification = toJson({ subscriptionId, event: projected })
        try {
          if (principal.viewSessionId) {
            if (!this['options'].notifyView) throw new Error('View notification bridge is unavailable')
            await this['options'].notifyView({
              principal,
              method: 'agent.event',
              params: notification
            })
          } else {
            await this['options'].notifyExtension?.(
              principal,
              'agent.event',
              notification
            )
          }
        } catch (error) {
          const entry = this['subscriptions'].get(subscriptionId)
          if (entry) {
            entry.subscription.close()
            this['subscriptions'].delete(subscriptionId)
          }
          throw error
        }
      }
      if (projected.type === 'terminal') {
        terminalSeen = true
        const entry = this['subscriptions'].get(subscriptionId)
        if (entry) {
          entry.subscription.close()
          this['subscriptions'].delete(subscriptionId)
        }
      }
    }
    const subscription = await this['options'].agent.subscribe(principal, {
      runId: input.runId,
      afterSeq: input.afterSequence - 1
    }, listener)
    if (terminalSeen) subscription.close()
    else this['subscriptions'].set(subscriptionId, {
      extensionId: principal.extensionId,
      ...(principal.hostLifecycleNonce
        ? { hostLifecycleNonce: principal.hostLifecycleNonce }
        : {}),
      ...(principal.viewSessionId ? { viewSessionId: principal.viewSessionId } : {}),
      workspaceRoots: normalizedRegistrationWorkspaceRoots(principal.workspaceRoots),
      subscription
    })
    replaying = false
    return { subscriptionId, replay }
  },

agentUnsubscribe(this: ExtensionHostBroker, principal: ExtensionPrincipal, params: JsonValue) {
    const { subscriptionId } = SubscriptionIdSchema.parse(params)
    const entry = this['subscriptions'].get(subscriptionId)
    if (entry && registrationOwnedByPrincipal(entry, principal)) {
      entry.subscription.close()
      this['subscriptions'].delete(subscriptionId)
    }
    return null
  },

async agentSteer(this: ExtensionHostBroker, principal: ExtensionPrincipal, params: JsonValue) {
    const input = AgentSteerRequestSchema.parse(params)
    await this['options'].agent.steer(principal, input.runId, agentInputText(input.input))
    return { accepted: true, run: publicAgentRun(await this['options'].agent.getRun(principal, input.runId)) }
  },

async agentCancel(this: ExtensionHostBroker, principal: ExtensionPrincipal, params: JsonValue) {
    const input = AgentCancelRequestSchema.parse(params)
    return { accepted: true, run: publicAgentRun(await this['options'].agent.cancel(principal, input.runId)) }
  },

async threadsListOwn(this: ExtensionHostBroker, principal: ExtensionPrincipal, params: JsonValue) {
    const input = ListOwnThreadsRequestSchema.parse(params)
    const response = await this['options'].agent.listOwnThreads(principal, {
      limit: input.limit,
      cursor: input.cursor,
      ...(input.workspace ? { workspace: input.workspace } : {}),
      ...(input.state ? { state: input.state } : {})
    })
    return {
      items: response.items.map((thread) => publicOwnedThread(principal, thread)),
      page: {
        hasMore: Boolean(response.nextCursor),
        ...(response.nextCursor ? { nextCursor: response.nextCursor } : {})
      }
    }
  },

async threadsGetOwn(this: ExtensionHostBroker, principal: ExtensionPrincipal, params: JsonValue) {
    const { threadId } = ThreadIdSchema.parse(params)
    return publicOwnedThread(principal, await this['options'].agent.getOwnThread(principal, threadId))
  },
}
