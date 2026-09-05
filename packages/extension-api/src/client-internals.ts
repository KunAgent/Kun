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


export const MAX_AGENT_REPLAY_EVENTS = 20_000
export const RegistrationResponseSchema = z.strictObject({ registrationId: z.string().min(1).max(256) })
export const SubscriptionResponseSchema = z.strictObject({
  subscriptionId: z.string().min(1).max(256),
  replay: z.array(AgentRunEventSchema).max(MAX_AGENT_REPLAY_EVENTS).default([])
})
export const AgentEventNotificationSchema = z.strictObject({
  subscriptionId: z.string().min(1).max(256),
  event: AgentRunEventSchema
})
export type PublicAgentRunEvent = z.infer<typeof AgentRunEventSchema>
export type AgentSubscriptionState = {
  emitter: Emitter<PublicAgentRunEvent>
  initialReplay: PublicAgentRunEvent[]
  buffered: PublicAgentRunEvent[]
  listenerCount: number
  deliveringBuffered: boolean
  lastDeliveredSequence: number
}

export type JobSubscriptionState = {
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

export const MAX_BUFFERED_AGENT_EVENTS = 256
export const MAX_ORPHAN_AGENT_SUBSCRIPTIONS = 32
export const MAX_BUFFERED_JOB_EVENTS = 256
export const MAX_ORPHAN_JOB_SUBSCRIPTIONS = 32
export const StorageValueResponseSchema = z.strictObject({ found: z.boolean(), value: JsonValueSchema.optional() })
export const StorageDeleteResponseSchema = z.strictObject({ deleted: z.boolean() })
export const SecretValueResponseSchema = z.strictObject({ found: z.boolean(), value: z.string().optional() })
export const StringArraySchema = z.array(z.string())
export const OptionalStringResponseSchema = z.strictObject({ value: z.string().optional() })
export const SecretResponseSchema = z.strictObject({ secret: z.string() })

export const ProviderInvocationSchema = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('probe'), binding: ProviderBindingSchema }),
  z.strictObject({ operation: z.literal('listModels'), binding: ProviderBindingSchema }),
  z.strictObject({ operation: z.literal('stream'), request: ModelProviderRequestSchema }),
  z.strictObject({ operation: z.literal('cancel'), requestId: z.string().min(1).max(256) }),
  z.strictObject({ operation: z.literal('countTokens'), request: ModelProviderRequestSchema })
])

export const ProviderStreamPayloadSchema = z.discriminatedUnion('kind', [
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

export function toWire(value: unknown): JsonValue {
  const serialized = JSON.stringify(value)
  return JsonValueSchema.parse(serialized === undefined ? null : JSON.parse(serialized))
}

export function cancellationFromContext(context: HostRequestContext): CancellationToken {
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

export function fallbackProviderStreamId(registrationId: string, requestId: string): string {
  const normalized = `${registrationId}_${requestId}`
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 119)
  return `p_${normalized || 'stream'}`
}

export async function requestParsed<T>(
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

export class ScopedStorageClient implements ScopedStorageApi {
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

export function appendBoundedAgentEvent(
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

export function mergeAgentEvents(
  replay: readonly PublicAgentRunEvent[],
  live: readonly PublicAgentRunEvent[]
): PublicAgentRunEvent[] {
  const bySequence = new Map<number, PublicAgentRunEvent>()
  for (const event of [...replay, ...live]) bySequence.set(event.sequence, event)
  return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence)
}

export function appendBoundedJobEvent(events: JobEvent[], event: JobEvent): void {
  const existing = events.findIndex((candidate) => candidate.sequence === event.sequence)
  if (existing >= 0) events[existing] = event
  else events.push(event)
  events.sort((left, right) => left.sequence - right.sequence)
  if (events.length > MAX_BUFFERED_JOB_EVENTS) {
    events.splice(0, events.length - MAX_BUFFERED_JOB_EVENTS)
  }
}

export function mergeJobEvents(replay: readonly JobEvent[], live: readonly JobEvent[]): JobEvent[] {
  const bySequence = new Map<number, JobEvent>()
  for (const event of [...replay, ...live]) bySequence.set(event.sequence, event)
  return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence)
}

export function updateJobSubscriptionState(state: JobSubscriptionState, event: JobEvent): void {
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
