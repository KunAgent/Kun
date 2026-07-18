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
  AgentMutationResultSchema,
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

const MAX_AGENT_REPLAY_EVENTS = 20_000
const RegistrationResponseSchema = z.strictObject({ registrationId: z.string().min(1).max(256) })
const SubscriptionResponseSchema = z.strictObject({
  subscriptionId: z.string().min(1).max(256),
  replay: z.array(AgentRunEventSchema).max(MAX_AGENT_REPLAY_EVENTS).default([])
})
const AgentEventNotificationSchema = z.strictObject({
  subscriptionId: z.string().min(1).max(256),
  event: AgentRunEventSchema
})
type PublicAgentRunEvent = z.infer<typeof AgentRunEventSchema>
type AgentSubscriptionState = {
  emitter: Emitter<PublicAgentRunEvent>
  initialReplay: PublicAgentRunEvent[]
  buffered: PublicAgentRunEvent[]
  listenerCount: number
  deliveringBuffered: boolean
  lastDeliveredSequence: number
}

type JobSubscriptionState = {
  emitter: Emitter<JobEvent>
  snapshot: JobSnapshot
  replayGap: boolean
  cursor: string
  complete: boolean
  initialReplay: JobEvent[]
  buffered: JobEvent[]
  listenerCount: number
  deliveringBuffered: boolean
  lastDeliveredSequence: number
}

const MAX_BUFFERED_AGENT_EVENTS = 256
const MAX_ORPHAN_AGENT_SUBSCRIPTIONS = 32
const MAX_BUFFERED_JOB_EVENTS = 256
const MAX_ORPHAN_JOB_SUBSCRIPTIONS = 32
const StorageValueResponseSchema = z.strictObject({ found: z.boolean(), value: JsonValueSchema.optional() })
const StorageDeleteResponseSchema = z.strictObject({ deleted: z.boolean() })
const StringArraySchema = z.array(z.string())
const OptionalStringResponseSchema = z.strictObject({ value: z.string().optional() })
const SecretResponseSchema = z.strictObject({ secret: z.string() })

const ProviderInvocationSchema = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('probe'), binding: ProviderBindingSchema }),
  z.strictObject({ operation: z.literal('listModels'), binding: ProviderBindingSchema }),
  z.strictObject({ operation: z.literal('stream'), request: ModelProviderRequestSchema }),
  z.strictObject({ operation: z.literal('cancel'), requestId: z.string().min(1).max(256) }),
  z.strictObject({ operation: z.literal('countTokens'), request: ModelProviderRequestSchema })
])

const ProviderStreamPayloadSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('event'),
    registrationId: z.string().min(1).max(256),
    requestId: z.string().min(1).max(256),
    event: ModelProviderStreamEventSchema
  }),
  z.strictObject({
    kind: z.literal('end'),
    registrationId: z.string().min(1).max(256),
    requestId: z.string().min(1).max(256),
    outcome: z.enum(['ended', 'failed'])
  })
])

function toWire(value: unknown): JsonValue {
  const serialized = JSON.stringify(value)
  return JsonValueSchema.parse(serialized === undefined ? null : JSON.parse(serialized))
}

function cancellationFromContext(context: HostRequestContext): CancellationToken {
  return {
    get isCancellationRequested() {
      return context.signal?.aborted ?? false
    },
    onCancellationRequested(listener) {
      if (!context.signal) return toDisposable(() => undefined)
      if (context.signal.aborted) listener()
      context.signal.addEventListener('abort', listener, { once: true })
      return toDisposable(() => context.signal?.removeEventListener('abort', listener))
    }
  }
}

function fallbackProviderStreamId(registrationId: string, requestId: string): string {
  const normalized = `${registrationId}_${requestId}`
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 119)
  return `p_${normalized || 'stream'}`
}

async function requestParsed<T>(
  transport: HostTransport,
  method: string,
  params: unknown,
  schema: z.ZodType<T>,
  options?: HostRequestOptions
): Promise<T> {
  try {
    return schema.parse(await transport.request(method, toWire(params), options))
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ExtensionApiError({
        code: 'PROTOCOL_ERROR',
        message: `Host returned an invalid ${method} response`,
        operation: method,
        retryable: false,
        details: { issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) }
      })
    }
    throw ExtensionApiError.from(error, method)
  }
}

class ScopedStorageClient implements ScopedStorageApi {
  constructor(
    private readonly transport: HostTransport,
    private readonly scope: 'global' | 'workspace'
  ) {}

  async get<T extends JsonValue = JsonValue>(key: string): Promise<T | undefined> {
    const response = await requestParsed(
      this.transport,
      'storage.get',
      { scope: this.scope, key },
      StorageValueResponseSchema
    )
    return response.found ? (response.value as T) : undefined
  }

  async set(key: string, value: JsonValue): Promise<void> {
    await this.transport.request('storage.set', toWire({ scope: this.scope, key, value }))
  }

  async delete(key: string): Promise<boolean> {
    return (
      await requestParsed(
        this.transport,
        'storage.delete',
        { scope: this.scope, key },
        StorageDeleteResponseSchema
      )
    ).deleted
  }

  keys(): Promise<string[]> {
    return requestParsed(this.transport, 'storage.keys', { scope: this.scope }, StringArraySchema)
  }
}

export interface ExtensionContext extends ActivationContextData {
  readonly subscriptions: DisposableStore
  readonly onDidError: Event<ExtensionApiError>
  readonly commands: CommandsApi
  readonly storage: StorageApi
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
  readonly workspaceContext?: WorkspaceContext
}

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

    this.commands = {
      registerCommand: async (id, handler) => {
        LocalIdSchema.parse(id)
        const { registrationId } = await requestParsed(
          transport,
          'commands.register',
          { id },
          RegistrationResponseSchema
        )
        const localHandler = transport.registerHandler(`commands.invoke:${registrationId}`, async (params) =>
          toWire(await handler(params))
        )
        return toDisposable(async () => {
          localHandler.dispose()
          await transport.request('commands.unregister', toWire({ registrationId }))
        })
      },
      executeCommand: async (id, args) =>
        JsonValueSchema.parse(await transport.request('commands.execute', toWire({ id, args }))) as never
    }

    this.storage = {
      global: new ScopedStorageClient(transport, 'global'),
      workspace: new ScopedStorageClient(transport, 'workspace')
    }

    this.configuration = {
      onDidChange: this.#configuration.event,
      get: async <T extends JsonValue = JsonValue>(sectionId: string, key: string) => {
        const response = await requestParsed(
          transport,
          'configuration.get',
          { sectionId, key },
          StorageValueResponseSchema
        )
        return response.found ? response.value as T : undefined
      },
      update: async (sectionId, key, value) => {
        await transport.request('configuration.update', toWire({ sectionId, key, value }))
      },
      keys: (sectionId) => requestParsed(
        transport,
        'configuration.keys',
        { sectionId },
        StringArraySchema
      )
    }

    this.network = {
      fetch: async (request, options) => {
        const parsed = NetworkRequestSchema.parse(request)
        try {
          return NetworkResponseSchema.parse(await transport.request('network.fetch', toWire(parsed), options))
        } catch (error) {
          throw ExtensionApiError.from(error, 'network.fetch')
        }
      }
    }

    this.ui = {
      onDidChangeTheme: this.#theme.event,
      onDidChangeLocale: this.#locale.event,
      onDidReceiveMessage: this.#messages.event,
      onDidChangeProviderStatus: this.#providerStatus.event,
      getTheme: () => requestParsed(transport, 'ui.getTheme', {}, ThemeSchema),
      getLocale: () => requestParsed(transport, 'ui.getLocale', {}, LocaleSchema),
      getViewState: async <T extends JsonValue = JsonValue>() => {
        const response = await requestParsed(transport, 'ui.getViewState', {}, StorageValueResponseSchema)
        return response.found ? (response.value as T) : undefined
      },
      setViewState: async (value) => {
        await transport.request('ui.setViewState', toWire({ value }))
      },
      postMessage: async (message) => {
        await transport.request('ui.postMessage', toWire(HostMessageSchema.parse(message)))
      },
      showNotification: async (options) =>
        (
          await requestParsed(
            transport,
            'ui.showNotification',
            NotificationOptionsSchema.parse(options),
            OptionalStringResponseSchema
          )
        ).value,
      attachComposerContext: (request) =>
        requestParsed(
          transport,
          'ui.attachComposerContext',
          ComposerContextAttachmentRequestSchema.parse(request),
          ComposerContextAttachmentSchema
        )
    }

    this.agent = {
      createRun: (request) =>
        requestParsed(
          transport,
          'agent.createRun',
          AgentCreateRunRequestSchema.parse(request),
          AgentCreateRunResponseSchema
        ),
      getRun: (runId) => requestParsed(transport, 'agent.getRun', { runId }, AgentRunSchema),
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
        this.#registerProvider(ModelProviderDeclarationSchema.parse(declaration), adapter),
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

  async #registerProvider(
    declaration: z.infer<typeof ModelProviderDeclarationSchema>,
    adapter: ModelProviderAdapter
  ): Promise<Disposable> {
    const { registrationId } = await requestParsed(
      this.transport,
      'modelProviders.register',
      declaration,
      RegistrationResponseSchema
    )
    const localHandler = this.transport.registerHandler(
      `modelProviders.invoke:${registrationId}`,
      async (params, context) => {
        const invocation = ProviderInvocationSchema.parse(params)
        const operationContext = { cancellation: cancellationFromContext(context) }
        switch (invocation.operation) {
          case 'probe':
            return toWire(
              ProviderProbeResultSchema.parse(await adapter.probe(invocation.binding, operationContext))
            )
          case 'listModels':
            return toWire(
              z.array(ProviderModelSchema).parse(await adapter.listModels(invocation.binding, operationContext))
            )
          case 'stream':
            {
              if (this.transport.sendStream === undefined) {
                for await (const event of adapter.stream(invocation.request, operationContext)) {
                  await this.transport.notify(
                    'modelProviders.streamEvent',
                    toWire({ registrationId, event: ModelProviderStreamEventSchema.parse(event) })
                  )
                }
                return { accepted: true }
              }
              const sendStream = this.transport.sendStream.bind(this.transport)
              const streamId = context.requestId ?? fallbackProviderStreamId(
                registrationId,
                invocation.request.requestId
              )
              let terminalSent = false
              try {
                for await (const rawEvent of adapter.stream(invocation.request, operationContext)) {
                  const event = ModelProviderStreamEventSchema.parse(rawEvent)
                  const terminal = event.type === 'completed' || event.type === 'error'
                  await sendStream(
                    streamId,
                    toWire(ProviderStreamPayloadSchema.parse({
                      kind: 'event',
                      registrationId,
                      requestId: invocation.request.requestId,
                      event
                    })),
                    terminal
                  )
                  if (terminal) {
                    terminalSent = true
                    break
                  }
                }
                if (!terminalSent) {
                  await sendStream(
                    streamId,
                    toWire(ProviderStreamPayloadSchema.parse({
                      kind: 'end',
                      registrationId,
                      requestId: invocation.request.requestId,
                      outcome: 'ended'
                    })),
                    true
                  )
                }
              } catch (error) {
                if (!terminalSent) {
                  await sendStream(
                    streamId,
                    toWire(ProviderStreamPayloadSchema.parse({
                      kind: 'end',
                      registrationId,
                      requestId: invocation.request.requestId,
                      outcome: 'failed'
                    })),
                    true
                  ).catch(() => undefined)
                }
                throw error
              }
            }
            return { accepted: true }
          case 'cancel':
            await adapter.cancel(invocation.requestId)
            return { accepted: true }
          case 'countTokens':
            if (!adapter.countTokens) {
              throw new ExtensionApiError({
                code: 'UNSUPPORTED_CAPABILITY',
                message: 'Provider does not implement countTokens',
                operation: 'modelProviders.countTokens',
                retryable: false
              })
            }
            return toWire({ count: await adapter.countTokens(invocation.request, operationContext) })
        }
      }
    )
    return toDisposable(async () => {
      localHandler.dispose()
      await this.transport.request('modelProviders.unregister', toWire({ registrationId }))
    })
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

function appendBoundedAgentEvent(
  events: PublicAgentRunEvent[],
  event: PublicAgentRunEvent
): void {
  const existing = events.findIndex((candidate) => candidate.sequence === event.sequence)
  if (existing >= 0) events[existing] = event
  else events.push(event)
  events.sort((left, right) => left.sequence - right.sequence)
  if (events.length > MAX_BUFFERED_AGENT_EVENTS) {
    events.splice(0, events.length - MAX_BUFFERED_AGENT_EVENTS)
  }
}

function mergeAgentEvents(
  replay: readonly PublicAgentRunEvent[],
  live: readonly PublicAgentRunEvent[]
): PublicAgentRunEvent[] {
  const bySequence = new Map<number, PublicAgentRunEvent>()
  for (const event of [...replay, ...live]) bySequence.set(event.sequence, event)
  return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence)
}

function appendBoundedJobEvent(events: JobEvent[], event: JobEvent): void {
  const existing = events.findIndex((candidate) => candidate.sequence === event.sequence)
  if (existing >= 0) events[existing] = event
  else events.push(event)
  events.sort((left, right) => left.sequence - right.sequence)
  if (events.length > MAX_BUFFERED_JOB_EVENTS) {
    events.splice(0, events.length - MAX_BUFFERED_JOB_EVENTS)
  }
}

function mergeJobEvents(replay: readonly JobEvent[], live: readonly JobEvent[]): JobEvent[] {
  const bySequence = new Map<number, JobEvent>()
  for (const event of [...replay, ...live]) bySequence.set(event.sequence, event)
  return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence)
}

function updateJobSubscriptionState(state: JobSubscriptionState, event: JobEvent): void {
  state.lastDeliveredSequence = event.sequence
  state.cursor = event.cursor
  state.snapshot = JobSnapshotSchema.parse({
    ...state.snapshot,
    state: event.state,
    updatedAt: event.timestamp,
    executionAttempt: event.executionAttempt,
    latestCursor: event.cursor,
    progress: event.progress ?? state.snapshot.progress,
    result: event.result ?? state.snapshot.result,
    error: event.error ?? state.snapshot.error,
    terminalAt: ['completed', 'failed', 'cancelled', 'interrupted'].includes(event.state)
      ? event.timestamp
      : state.snapshot.terminalAt
  })
  state.complete = ['completed', 'failed', 'cancelled', 'interrupted'].includes(event.state)
}

export function createExtensionContext(
  transport: HostTransport,
  data: ActivationContextData,
  client = new ExtensionHostClient(transport)
): ExtensionContext {
  const parsed = ActivationContextDataSchema.parse(data)
  const subscriptions = new DisposableStore()
  subscriptions.add(client)
  return {
    ...parsed,
    subscriptions,
    onDidError: client.onDidError,
    commands: client.commands,
    storage: client.storage,
    configuration: client.configuration,
    network: client.network,
    ui: client.ui,
    agent: client.agent,
    threads: client.threads,
    tools: client.tools,
    modelProviders: client.modelProviders,
    authentication: client.authentication,
    media: client.media,
    jobs: client.jobs,
    workspace: client.workspace
  }
}
