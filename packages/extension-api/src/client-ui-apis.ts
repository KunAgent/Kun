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
  OptionalStringResponseSchema,
  RegistrationResponseSchema,
  ScopedStorageClient,
  StorageValueResponseSchema,
  SecretValueResponseSchema,
  StorageDeleteResponseSchema,
  StringArraySchema,
  requestParsed,
  toWire
} from './client-internals.js'

export function createCommandsApi(
  transport: HostTransport
): CommandsApi {
  return {
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
}

export function createStorageApi(
  transport: HostTransport
): StorageApi {
  return {
      global: new ScopedStorageClient(transport, 'global'),
      workspace: new ScopedStorageClient(transport, 'workspace')
    }
}

export function createSecretStorageApi(
  transport: HostTransport
): SecretStorageApi {
  return {
    get: async (key) => {
      const response = await requestParsed(
        transport,
        'secrets.get',
        { key },
        SecretValueResponseSchema
      )
      return response.found ? response.value : undefined
    },
    set: async (key, value) => {
      await transport.request('secrets.set', toWire({ key, value }))
    },
    delete: async (key) => (
      await requestParsed(
        transport,
        'secrets.delete',
        { key },
        StorageDeleteResponseSchema
      )
    ).deleted
  }
}

export function createConfigurationApi(
  transport: HostTransport,
  onDidChange: Event<z.infer<typeof ConfigurationChangeEventSchema>>
): ConfigurationApi {
  return {
      onDidChange: onDidChange,
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
}

export function createNetworkApi(
  transport: HostTransport
): NetworkApi {
  return {
      fetch: async (request, options) => {
        const parsed = NetworkRequestSchema.parse(request)
        try {
          return NetworkResponseSchema.parse(await transport.request('network.fetch', toWire(parsed), options))
        } catch (error) {
          throw ExtensionApiError.from(error, 'network.fetch')
        }
      }
    }
}

export function createUiApi(
  transport: HostTransport,
  events: {
    onDidChangeTheme: Event<z.infer<typeof ThemeSchema>>
    onDidChangeLocale: Event<z.infer<typeof LocaleSchema>>
    onDidReceiveMessage: Event<z.infer<typeof HostMessageSchema>>
    onDidChangeProviderStatus: Event<z.infer<typeof ProviderStatusSchema>>
  }
): UiApi {
  return {
      onDidChangeTheme: events.onDidChangeTheme,
      onDidChangeLocale: events.onDidChangeLocale,
      onDidReceiveMessage: events.onDidReceiveMessage,
      onDidChangeProviderStatus: events.onDidChangeProviderStatus,
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
}
