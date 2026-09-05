import { z } from 'zod'
import {
  AccountSchema,
  AccountSessionSchema,
  AuthenticatedFetchRequestSchema,
  CreateAccountSessionRequestSchema,
  ListAccountsRequestSchema,
  RevealSecretRequestSchema
} from './accounts.js'
import { ProviderBindingSchema } from './accounts.js'
import {
  ArtifactHostActionRequestSchema,
  ArtifactHostActionResultSchema
} from './artifacts.js'
import {
  AgentCancelRequestSchema,
  AgentCreateRunRequestSchema,
  AgentCreateRunResponseSchema,
  AgentListRunEventsRequestSchema,
  AgentListRunEventsResponseSchema,
  AgentMutationResultSchema,
  AgentRunOptionsSchema,
  AgentRunEventSchema,
  AgentRunSchema,
  AgentSteerRequestSchema,
  AgentSubscribeRequestSchema,
  ExtensionThreadProjectionSchema,
  ListOwnThreadsRequestSchema,
  ListOwnThreadsResponseSchema
} from './agent.js'
import {
  JsonObjectSchema,
  JsonValueSchema,
  LocalIdSchema,
  type JsonObject,
  type JsonValue
} from './common.js'
import { ExtensionApiError } from './errors.js'
import {
  ComposerContextAttachmentRequestSchema,
  ComposerContextAttachmentSchema
} from './composer-context.js'
import {
  JobCancelRequestSchema,
  JobCancellationResultSchema,
  JobEventNotificationSchema,
  JobEventSchema,
  JobGetRequestSchema,
  JobListRequestSchema,
  JobPageSchema,
  JobSnapshotSchema,
  JobSubscribeRequestSchema,
  JobSubscriptionResponseSchema,
  type JobEvent,
  type JobSnapshot
} from './jobs.js'
import {
  ActivationContextDataSchema,
  DisposableStore,
  Emitter,
  toDisposable,
  type ActivationContextData,
  type Disposable,
  type Event,
  type WorkspaceContext
} from './lifecycle.js'
import {
  ModelProviderDeclarationSchema,
  ModelProviderRequestSchema,
  ModelProviderStreamEventSchema,
  ProviderModelSchema,
  ProviderProbeResultSchema,
  ProviderStatusSchema,
  type ModelProviderAdapter
} from './providers.js'
import {
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
  MediaReleaseResultSchema,
  MediaResourceLeaseSchema,
  MediaStartFfmpegJobRequestSchema,
  MediaStartFfmpegJobResultSchema,
  MediaStartAudioAnalysisJobRequestSchema,
  MediaStartAudioAnalysisJobResultSchema,
  MediaStartArchiveJobRequestSchema,
  MediaStartArchiveJobResultSchema,
  MediaStatRequestSchema,
  MediaVisualModelStatusSchema
} from './media.js'
import {
  HostMessageSchema,
  ConfigurationChangeEventSchema,
  LocaleSchema,
  NetworkRequestSchema,
  NetworkResponseSchema,
  NotificationOptionsSchema,
  ThemeSchema,
  WorkspaceFileSchema,
  type AgentApi,
  type AgentRunSubscription,
  type AuthenticationApi,
  type CommandsApi,
  type ConfigurationApi,
  type HostRequestContext,
  type HostRequestOptions,
  type HostTransport,
  type JobsApi,
  type JobSubscription,
  type MediaApi,
  type ModelProvidersApi,
  type NetworkApi,
  type ScopedStorageApi,
  type SecretStorageApi,
  type StorageApi,
  type ThreadsApi,
  type ToolsApi,
  type UiApi,
  type WorkspaceApi
} from './services.js'
import {
  ExtensionToolDeclarationSchema,
  ToolInvocationSchema,
  ToolResultSchema,
  type CancellationToken,
  type ExtensionToolHandler
} from './tools.js'

import {
  AgentEventNotificationSchema,
  RegistrationResponseSchema,
  SecretResponseSchema,
  SubscriptionResponseSchema,
  appendBoundedAgentEvent,
  appendBoundedJobEvent,
  cancellationFromContext,
  mergeAgentEvents,
  mergeJobEvents,
  requestParsed,
  toWire,
  updateJobSubscriptionState,
  type AgentSubscriptionState,
  type JobSubscriptionState,
  type PublicAgentRunEvent,
  MAX_ORPHAN_AGENT_SUBSCRIPTIONS,
  MAX_ORPHAN_JOB_SUBSCRIPTIONS
} from './client-internals.js'
import {
  createCommandsApi,
  createConfigurationApi,
  createNetworkApi,
  createSecretStorageApi,
  createStorageApi,
  createUiApi
} from './client-ui-apis.js'
import { registerProvider } from './client-provider-registration.js'

export class ExtensionHostClient implements Disposable {
  readonly #disposables = new DisposableStore()
  readonly #errors = new Emitter<ExtensionApiError>()
  readonly #theme = new Emitter<z.infer<typeof ThemeSchema>>()
  readonly #locale = new Emitter<z.infer<typeof LocaleSchema>>()
  readonly #messages = new Emitter<z.infer<typeof HostMessageSchema>>()
  readonly #providerStatus = new Emitter<z.infer<typeof ProviderStatusSchema>>()
  readonly #configuration = new Emitter<z.infer<typeof ConfigurationChangeEventSchema>>()
  readonly #agentSubscriptions = new Map<string, AgentSubscriptionState>()
  readonly #orphanAgentEvents = new Map<string, PublicAgentRunEvent[]>()
  readonly #jobSubscriptions = new Map<string, JobSubscriptionState>()
  readonly #orphanJobEvents = new Map<string, JobEvent[]>()

  readonly commands: CommandsApi
  readonly storage: StorageApi
  readonly secrets: SecretStorageApi
  readonly configuration: ConfigurationApi
  readonly network: NetworkApi
  readonly ui: UiApi
  readonly agent: AgentApi
  readonly threads: ThreadsApi
  readonly tools: ToolsApi
  readonly modelProviders: ModelProvidersApi
  readonly authentication: AuthenticationApi
  readonly media: MediaApi
  readonly jobs: JobsApi
  readonly workspace: WorkspaceApi
  readonly onDidError: Event<ExtensionApiError> = this.#errors.event

  constructor(readonly transport: HostTransport) {
    this.#disposables.add(
      this.#errors,
      this.#theme,
      this.#locale,
      this.#messages,
      this.#providerStatus,
      this.#configuration
    )
    this.#disposables.add(
      transport.onNotification((notification) => this.#handleNotification(notification.method, notification.params))
    )

    this.commands = createCommandsApi(transport)
    this.storage = createStorageApi(transport)
    this.secrets = createSecretStorageApi(transport)
    this.configuration = createConfigurationApi(transport, this.#configuration.event)
    this.network = createNetworkApi(transport)
    this.ui = createUiApi(transport, {
      onDidChangeTheme: this.#theme.event,
      onDidChangeLocale: this.#locale.event,
      onDidReceiveMessage: this.#messages.event,
      onDidChangeProviderStatus: this.#providerStatus.event
    })
    this.agent = {
      getRunOptions: () => requestParsed(transport, 'agent.getRunOptions', {}, AgentRunOptionsSchema),
      createRun: (request) =>
        requestParsed(
          transport,
          'agent.createRun',
          AgentCreateRunRequestSchema.parse(request),
          AgentCreateRunResponseSchema
        ),
      getRun: (runId) => requestParsed(transport, 'agent.getRun', { runId }, AgentRunSchema),
      listRunEvents: (request) => requestParsed(
        transport, 'agent.listRunEvents', AgentListRunEventsRequestSchema.parse(request),
        AgentListRunEventsResponseSchema
      ),
      subscribe: async (request) => {
        const parsedRequest = AgentSubscribeRequestSchema.parse(request)
        const response = await requestParsed(
          transport,
          'agent.subscribe',
          parsedRequest,
          SubscriptionResponseSchema
        )
        const state: AgentSubscriptionState = {
          emitter: new Emitter<PublicAgentRunEvent>(),
          initialReplay: mergeAgentEvents(response.replay, []),
          buffered: this.#orphanAgentEvents.get(response.subscriptionId) ?? [],
          listenerCount: 0,
          deliveringBuffered: false,
          lastDeliveredSequence: 0
        }
        this.#orphanAgentEvents.delete(response.subscriptionId)
        this.#agentSubscriptions.set(response.subscriptionId, state)
        const event: Event<z.infer<typeof AgentRunEventSchema>> = (listener) => {
          state.listenerCount += 1
          const disposable = state.emitter.event(listener)
          if (
            state.listenerCount === 1 &&
            (state.initialReplay.length > 0 || state.buffered.length > 0)
          ) {
            state.deliveringBuffered = true
            try {
              let queued = mergeAgentEvents(state.initialReplay, state.buffered)
              state.initialReplay = []
              state.buffered = []
              while (queued.length > 0) {
                for (const bufferedEvent of queued) {
                  if (bufferedEvent.sequence <= state.lastDeliveredSequence) continue
                  state.lastDeliveredSequence = bufferedEvent.sequence
                  listener(bufferedEvent)
                }
                queued = state.buffered
                state.buffered = []
              }
            } finally {
              state.deliveringBuffered = false
            }
          }
          return toDisposable(() => {
            disposable.dispose()
            state.listenerCount = Math.max(0, state.listenerCount - 1)
          })
        }
        const subscription: AgentRunSubscription = {
          onEvent: event,
          dispose: async () => {
            if (!this.#agentSubscriptions.delete(response.subscriptionId)) return
            state.emitter.dispose()
            state.initialReplay = []
            state.buffered = []
            await transport.request('agent.unsubscribe', toWire({ subscriptionId: response.subscriptionId }))
          }
        }
        return subscription
      },
      steer: (request) =>
        requestParsed(
          transport,
          'agent.steer',
          AgentSteerRequestSchema.parse(request),
          AgentMutationResultSchema
        ),
      cancel: (request) =>
        requestParsed(
          transport,
          'agent.cancel',
          AgentCancelRequestSchema.parse(request),
          AgentMutationResultSchema
        )
    }

    this.threads = {
      listOwn: (request = {}) =>
        requestParsed(
          transport,
          'threads.listOwn',
          ListOwnThreadsRequestSchema.parse(request),
          ListOwnThreadsResponseSchema
        ),
      getOwn: (threadId) =>
        requestParsed(transport, 'threads.getOwn', { threadId }, ExtensionThreadProjectionSchema)
    }

    this.tools = {
      registerTool: async <TInput extends JsonObject = JsonObject, TResult extends JsonValue = JsonValue>(
        declaration: z.input<typeof ExtensionToolDeclarationSchema>,
        handler: ExtensionToolHandler<TInput, TResult>
      ) => {
        const parsed = ExtensionToolDeclarationSchema.parse(declaration)
        const { registrationId } = await requestParsed(
          transport,
          'tools.register',
          parsed,
          RegistrationResponseSchema
        )
        const localHandler = transport.registerHandler(`tools.invoke:${registrationId}`, async (params, context) => {
          const invocation = ToolInvocationSchema.parse(params)
          const result = await handler(invocation.input as TInput, {
            invocation,
            cancellation: cancellationFromContext(context),
            reportProgress: (progress) =>
              transport.notify('tools.progress', toWire({ ...progress, invocationId: invocation.invocationId }))
          })
          const normalized = ToolResultSchema.safeParse(result)
          return toWire(normalized.success ? normalized.data : { content: result })
        })
        return toDisposable(async () => {
          localHandler.dispose()
          await transport.request('tools.unregister', toWire({ registrationId }))
        })
      }
    }

    this.modelProviders = {
      registerProvider: async (declaration, adapter) =>
        registerProvider(transport, ModelProviderDeclarationSchema.parse(declaration), adapter),
      getStatus: (providerId) =>
        requestParsed(transport, 'modelProviders.getStatus', { providerId }, ProviderStatusSchema)
    }

    this.authentication = {
      listAccounts: (request = {}) =>
        requestParsed(
          transport,
          'authentication.listAccounts',
          ListAccountsRequestSchema.parse(request),
          z.array(AccountSchema)
        ),
      createSession: (request) =>
        requestParsed(
          transport,
          'authentication.createSession',
          CreateAccountSessionRequestSchema.parse(request),
          AccountSessionSchema
        ),
      getSession: (sessionId) =>
        requestParsed(transport, 'authentication.getSession', { sessionId }, AccountSessionSchema),
      cancelSession: async (sessionId) => {
        await transport.request('authentication.cancelSession', toWire({ sessionId }))
      },
      deleteAccount: async (accountId) => {
        await transport.request('authentication.deleteAccount', toWire({ accountId }))
      },
      authenticatedFetch: (request) =>
        requestParsed(
          transport,
          'authentication.authenticatedFetch',
          AuthenticatedFetchRequestSchema.parse(request),
          NetworkResponseSchema
        ),
      revealSecret: async (request) =>
        (
          await requestParsed(
            transport,
            'authentication.revealSecret',
            RevealSecretRequestSchema.parse(request),
            SecretResponseSchema
          )
        ).secret
    }

    this.media = {
      pickFiles: (request = {}) =>
        requestParsed(
          transport,
          'media.pickFiles',
          MediaPickFilesRequestSchema.parse(request),
          MediaPickFilesResultSchema
        ),
      pickSaveTarget: (request = {}) =>
        requestParsed(
          transport,
          'media.pickSaveTarget',
          MediaPickSaveTargetRequestSchema.parse(request),
          MediaPickSaveTargetResultSchema
        ),
      createCacheTarget: (request) =>
        requestParsed(
          transport,
          'media.createCacheTarget',
          MediaCreateCacheTargetRequestSchema.parse(request),
          MediaCreateCacheTargetResultSchema
        ),
      stat: (request) =>
        requestParsed(transport, 'media.stat', MediaStatRequestSchema.parse(request), MediaMetadataSchema),
      readText: (request) =>
        requestParsed(
          transport,
          'media.readText',
          MediaReadTextRequestSchema.parse(request),
          MediaReadTextResultSchema
        ),
      release: (request) =>
        requestParsed(
          transport,
          'media.release',
          MediaReleaseRequestSchema.parse(request),
          MediaReleaseResultSchema
        ),
      openViewResource: (request) =>
        requestParsed(
          transport,
          'media.openViewResource',
          MediaOpenViewResourceRequestSchema.parse(request),
          MediaResourceLeaseSchema
        ),
      performArtifactAction: (request) =>
        requestParsed(
          transport,
          'media.performArtifactAction',
          ArtifactHostActionRequestSchema.parse(request),
          ArtifactHostActionResultSchema
        ),
      getCapabilities: () =>
        requestParsed(transport, 'media.getCapabilities', {}, MediaCapabilitiesSchema),
      getAudioAnalysisCapabilities: () =>
        requestParsed(
          transport,
          'media.getAudioAnalysisCapabilities',
          {},
          MediaAudioAnalysisCapabilitiesSchema
        ),
      getVisualModelStatus: () =>
        requestParsed(
          transport,
          'media.getVisualModelStatus',
          {},
          MediaVisualModelStatusSchema
        ),
      installVisualModel: (request = {}) =>
        requestParsed(
          transport,
          'media.installVisualModel',
          MediaInstallVisualModelRequestSchema.parse(request),
          MediaVisualModelStatusSchema
        ),
      analyzeVisualFrames: (request, options) =>
        requestParsed(
          transport,
          'media.analyzeVisualFrames',
          MediaAnalyzeVisualFramesRequestSchema.parse(request),
          MediaAnalyzeVisualFramesResultSchema,
          options
        ),
      embedVisualQuery: (request, options) =>
        requestParsed(
          transport,
          'media.embedVisualQuery',
          MediaEmbedVisualQueryRequestSchema.parse(request),
          MediaEmbedVisualQueryResultSchema,
          options
        ),
      probe: (request) =>
        requestParsed(
          transport,
          'media.probe',
          MediaProbeRequestSchema.parse(request),
          MediaProbeResultSchema
        ),
      startFfmpegJob: (request) =>
        requestParsed(
          transport,
          'media.startFfmpegJob',
          MediaStartFfmpegJobRequestSchema.parse(request),
          MediaStartFfmpegJobResultSchema
        ),
      startAudioAnalysisJob: (request) =>
        requestParsed(
          transport,
          'media.startAudioAnalysisJob',
          MediaStartAudioAnalysisJobRequestSchema.parse(request),
          MediaStartAudioAnalysisJobResultSchema
        ),
      startArchiveJob: (request) =>
        requestParsed(
          transport,
          'media.startArchiveJob',
          MediaStartArchiveJobRequestSchema.parse(request),
          MediaStartArchiveJobResultSchema
        )
    }

    this.jobs = {
      get: (jobId) =>
        requestParsed(transport, 'jobs.get', JobGetRequestSchema.parse({ jobId }), JobSnapshotSchema),
      list: (request = {}) =>
        requestParsed(transport, 'jobs.list', JobListRequestSchema.parse(request), JobPageSchema),
      subscribe: async (request) => {
        const parsedRequest = JobSubscribeRequestSchema.parse(request)
        const response = await requestParsed(
          transport,
          'jobs.subscribe',
          parsedRequest,
          JobSubscriptionResponseSchema
        )
        const state: JobSubscriptionState = {
          emitter: new Emitter<JobEvent>(),
          snapshot: response.snapshot,
          replayGap: response.gap,
          cursor: response.cursor,
          complete: response.complete,
          initialReplay: mergeJobEvents(response.replay, []),
          buffered: this.#orphanJobEvents.get(response.subscriptionId) ?? [],
          listenerCount: 0,
          deliveringBuffered: false,
          lastDeliveredSequence: 0
        }
        this.#orphanJobEvents.delete(response.subscriptionId)
        this.#jobSubscriptions.set(response.subscriptionId, state)
        const event: Event<JobEvent> = (listener) => {
          state.listenerCount += 1
          const disposable = state.emitter.event(listener)
          if (state.listenerCount === 1 && (state.initialReplay.length > 0 || state.buffered.length > 0)) {
            state.deliveringBuffered = true
            try {
              let queued = mergeJobEvents(state.initialReplay, state.buffered)
              state.initialReplay = []
              state.buffered = []
              while (queued.length > 0) {
                for (const bufferedEvent of queued) {
                  if (bufferedEvent.sequence <= state.lastDeliveredSequence) continue
                  updateJobSubscriptionState(state, bufferedEvent)
                  listener(bufferedEvent)
                }
                queued = state.buffered
                state.buffered = []
              }
            } finally {
              state.deliveringBuffered = false
            }
          }
          return toDisposable(() => {
            disposable.dispose()
            state.listenerCount = Math.max(0, state.listenerCount - 1)
          })
        }
        const subscription: JobSubscription = {
          get snapshot() { return state.snapshot },
          get replayGap() { return state.replayGap },
          get cursor() { return state.cursor },
          get complete() { return state.complete },
          onEvent: event,
          dispose: async () => {
            if (!this.#jobSubscriptions.delete(response.subscriptionId)) return
            state.emitter.dispose()
            state.initialReplay = []
            state.buffered = []
            await transport.request('jobs.unsubscribe', toWire({ subscriptionId: response.subscriptionId }))
          }
        }
        return subscription
      },
      cancel: (request) =>
        requestParsed(
          transport,
          'jobs.cancel',
          JobCancelRequestSchema.parse(request),
          JobCancellationResultSchema
        )
    }

    this.workspace = {
      readFile: (path, encoding = 'utf8') =>
        requestParsed(transport, 'workspace.readFile', { path, encoding }, WorkspaceFileSchema),
      writeFile: async (file) => {
        await transport.request('workspace.writeFile', toWire(WorkspaceFileSchema.parse(file)))
      },
      stat: (path) => requestParsed(transport, 'workspace.stat', { path }, JsonObjectSchema),
      list: (path = '.') => requestParsed(transport, 'workspace.list', { path }, z.array(JsonObjectSchema))
    }
  }


  #handleNotification(method: string, params: JsonValue | undefined): void {
    try {
      if (method === 'ui.themeChanged') this.#theme.fire(ThemeSchema.parse(params))
      else if (method === 'ui.localeChanged') this.#locale.fire(LocaleSchema.parse(params))
      else if (method === 'ui.message') this.#messages.fire(HostMessageSchema.parse(params))
      else if (method === 'configuration.changed') {
        this.#configuration.fire(ConfigurationChangeEventSchema.parse(params))
      }
      else if (method === 'modelProviders.statusChanged') {
        this.#providerStatus.fire(ProviderStatusSchema.parse(params))
      } else if (method === 'agent.event') {
        const event = AgentEventNotificationSchema.parse(params)
        const subscription = this.#agentSubscriptions.get(event.subscriptionId)
        if (subscription) {
          if (event.event.sequence <= subscription.lastDeliveredSequence) return
          if (subscription.listenerCount > 0 && !subscription.deliveringBuffered) {
            subscription.lastDeliveredSequence = event.event.sequence
            subscription.emitter.fire(event.event)
          }
          else appendBoundedAgentEvent(subscription.buffered, event.event)
        } else {
          if (
            !this.#orphanAgentEvents.has(event.subscriptionId) &&
            this.#orphanAgentEvents.size >= MAX_ORPHAN_AGENT_SUBSCRIPTIONS
          ) {
            const oldest = this.#orphanAgentEvents.keys().next().value
            if (oldest !== undefined) this.#orphanAgentEvents.delete(oldest)
          }
          const buffered = this.#orphanAgentEvents.get(event.subscriptionId) ?? []
          appendBoundedAgentEvent(buffered, event.event)
          this.#orphanAgentEvents.set(event.subscriptionId, buffered)
        }
      } else if (method === 'jobs.event') {
        const event = JobEventNotificationSchema.parse(params)
        const subscription = this.#jobSubscriptions.get(event.subscriptionId)
        if (subscription) {
          if (event.event.sequence <= subscription.lastDeliveredSequence) return
          if (subscription.listenerCount > 0 && !subscription.deliveringBuffered) {
            updateJobSubscriptionState(subscription, event.event)
            subscription.emitter.fire(event.event)
          } else appendBoundedJobEvent(subscription.buffered, event.event)
        } else {
          if (
            !this.#orphanJobEvents.has(event.subscriptionId) &&
            this.#orphanJobEvents.size >= MAX_ORPHAN_JOB_SUBSCRIPTIONS
          ) {
            const oldest = this.#orphanJobEvents.keys().next().value
            if (oldest !== undefined) this.#orphanJobEvents.delete(oldest)
          }
          const buffered = this.#orphanJobEvents.get(event.subscriptionId) ?? []
          appendBoundedJobEvent(buffered, event.event)
          this.#orphanJobEvents.set(event.subscriptionId, buffered)
        }
      }
    } catch (error) {
      this.#errors.fire(
        new ExtensionApiError({
          code: 'PROTOCOL_ERROR',
          message: `Host delivered an invalid ${method} notification`,
          operation: method,
          retryable: false,
          details:
            error instanceof z.ZodError
              ? { issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) }
              : undefined
        })
      )
    }
  }

  async dispose(): Promise<void> {
    for (const subscription of this.#agentSubscriptions.values()) subscription.emitter.dispose()
    this.#agentSubscriptions.clear()
    this.#orphanAgentEvents.clear()
    for (const subscription of this.#jobSubscriptions.values()) subscription.emitter.dispose()
    this.#jobSubscriptions.clear()
    this.#orphanJobEvents.clear()
    await this.#disposables.dispose()
    await this.transport.dispose()
  }
}
