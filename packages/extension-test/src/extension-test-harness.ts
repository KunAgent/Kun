import {
  AccountSchema,
  ComposerContextAttachmentRequestSchema,
  ComposerContextAttachmentSchema,
  AgentCreateRunRequestSchema,
  AgentRunEventSchema,
  ExtensionApiError,
  ExtensionHostClient,
  ExtensionToolDeclarationSchema,
  GeneratedArtifactSchema,
  HostMessageSchema,
  JobCancelRequestSchema,
  JobEventSchema,
  JobFilterSchema,
  JobListRequestSchema,
  JobResultSchema,
  JobSnapshotSchema,
  JsonObjectSchema,
  JsonValueSchema,
  MediaAudioAnalysisCapabilitiesSchema,
  MediaAnalyzeVisualFramesRequestSchema,
  MediaEmbedVisualQueryRequestSchema,
  MediaCapabilitiesSchema,
  MediaCreateCacheTargetRequestSchema,
  MediaMetadataSchema,
  MediaOpenViewResourceRequestSchema,
  MediaPickFilesRequestSchema,
  MediaPickSaveTargetRequestSchema,
  MediaProbeRequestSchema,
  MediaProbeResultSchema,
  MediaReadTextRequestSchema,
  MediaReadTextResultSchema,
  MediaReleaseRequestSchema,
  MediaStartFfmpegJobRequestSchema,
  MediaStartAudioAnalysisJobRequestSchema,
  MediaStartArchiveJobRequestSchema,
  MediaVisualModelStatusSchema,
  ModelProviderDeclarationSchema,
  NetworkRequestSchema,
  NetworkResponseSchema,
  NotificationOptionsSchema,
  ProviderStatusSchema,
  ThemeSchema,
  LocaleSchema,
  createExtensionContext,
  hasPermission,
  toDisposable,
  type Account,
  type Activate,
  type AgentCreateRunRequest,
  type AgentRun,
  type AgentRunEvent,
  type Deactivate,
  type Disposable,
  type ExtensionContext,
  type ExtensionIdentity,
  type ExtensionToolDeclaration,
  type HostNotification,
  type HostRequestContext,
  type HostRequestHandler,
  type HostRequestOptions,
  type HostTransport,
  type GeneratedArtifact,
  type JobEvent,
  type JobListRequest,
  type JobResult,
  type JobResultInput,
  type JobSnapshot,
  type JsonObject,
  type JsonValue,
  type MediaAudioAnalysisCapabilities,
  type MediaVisualModelStatus,
  type MediaCapabilities,
  type ModelProviderDeclaration,
  type ModelProviderStreamEvent,
  type MediaMetadata,
  type MediaProbeResult,
  type NetworkResponse,
  type Permission,
  type ProviderStatus,
  type Theme,
  type Locale,
  type WorkspaceContext,
  type WorkspaceFile
} from '@kun/extension-api'
import { createHash } from 'node:crypto'


import { FakeAgentService, FakeSecretStorageService, FakeStorageService, FakeWorkspaceService } from './fake-basic-services.js'
import { FakeJobService } from './fake-job-service.js'
import { FakeMediaService } from './fake-media-service.js'
import { FakeAccountService, FakeProviderService, FakeToolService, FakeWebviewService } from './fake-registration-services.js'
import { storagePermission } from './fake-service-helpers.js'
import { FakeClock, FakeHostTransport } from './fake-transport.js'

export interface ExtensionTestHarnessOptions {
  identity?: ExtensionIdentity
  permissions?: Iterable<Permission | string>
  workspace?: WorkspaceContext
  clock?: FakeClock
}

export class ExtensionTestHarness implements Disposable {
  readonly identity: ExtensionIdentity
  readonly permissions: Set<string>
  readonly clock: FakeClock
  readonly transport: FakeHostTransport
  readonly storage = new FakeStorageService()
  readonly secrets = new FakeSecretStorageService()
  readonly workspace = new FakeWorkspaceService()
  readonly agent: FakeAgentService
  readonly jobs: FakeJobService
  readonly media: FakeMediaService
  readonly tools: FakeToolService
  readonly providers: FakeProviderService
  readonly accounts: FakeAccountService
  readonly webview: FakeWebviewService
  readonly configuration = new Map<string, JsonValue>()
  readonly client: ExtensionHostClient
  readonly context: ExtensionContext
  #deactivate?: Deactivate

  constructor(options: ExtensionTestHarnessOptions = {}) {
    this.identity =
      options.identity ??
      ({ id: 'test.extension', publisher: 'test', name: 'extension', version: '1.0.0' } as const)
    this.clock = options.clock ?? new FakeClock()
    this.transport = new FakeHostTransport({ permissions: options.permissions })
    this.permissions = this.transport.permissions
    this.agent = new FakeAgentService(this.transport, this.clock, this.identity)
    this.jobs = new FakeJobService(
      this.transport,
      this.clock,
      this.identity,
      options.workspace?.id ?? 'test-workspace'
    )
    this.media = new FakeMediaService(this.transport, this.jobs, this.clock)
    this.tools = new FakeToolService(this.transport)
    this.providers = new FakeProviderService(this.transport, this.clock)
    this.accounts = new FakeAccountService(this.clock)
    this.webview = new FakeWebviewService(
      this.identity,
      createHash('sha256').update(options.workspace?.id ?? '').digest('hex')
    )

    this.#installPermissionRules()
    this.#installServices()
    this.client = new ExtensionHostClient(this.transport)
    this.context = createExtensionContext(
      this.transport,
      {
        extension: this.identity,
        apiVersion: '1.4.0',
        capabilities: [
          'artifacts.generated',
          'jobs.observe',
          'media.brokered',
          'media.analysis',
          'media.archive',
          'media.documents',
          'storage.secrets'
        ],
        permissions: [...this.permissions],
        workspaceContext: options.workspace,
        activationEvent: 'onStartup'
      },
      this.client
    )
  }

  async activate(activate: Activate<ExtensionContext>, deactivate?: Deactivate): Promise<ExtensionContext> {
    this.#deactivate = deactivate
    await activate(this.context)
    return this.context
  }

  grant(...permissions: string[]): void {
    this.transport.grant(...permissions)
  }

  deny(...permissions: string[]): void {
    this.transport.deny(...permissions)
  }

  async dispose(): Promise<void> {
    await this.#deactivate?.()
    await this.context.subscriptions.dispose()
  }

  #installServices(): void {
    this.storage.install(this.transport)
    this.secrets.install(this.transport)
    this.workspace.install(this.transport)
    this.agent.install()
    this.jobs.install()
    this.media.install()
    this.tools.install()
    this.providers.install()
    this.accounts.install(this.transport)
    this.webview.install(this.transport)
    this.transport.handle('configuration.get', (params) => {
      const input = JsonObjectSchema.parse(params)
      const key = `${String(input.sectionId)}/${String(input.key)}`
      const value = this.configuration.get(key)
      return value === undefined ? { found: false } : { found: true, value }
    })
    this.transport.handle('configuration.update', (params) => {
      const input = JsonObjectSchema.parse(params)
      const sectionId = String(input.sectionId)
      const key = String(input.key)
      const value = JsonValueSchema.parse(input.value)
      this.configuration.set(`${sectionId}/${key}`, value)
      this.transport.emit('configuration.changed', {
        sectionId,
        key,
        scope: 'workspace',
        value
      })
      return null
    })
    this.transport.handle('configuration.keys', (params) => {
      const sectionId = `${String(JsonObjectSchema.parse(params).sectionId)}/`
      return [...this.configuration.keys()]
        .filter((key) => key.startsWith(sectionId))
        .map((key) => key.slice(sectionId.length))
        .sort()
    })
    this.transport.handle('commands.register', (params) => ({
      registrationId: `command-${String(JsonObjectSchema.parse(params).id)}`
    }))
    this.transport.handle('commands.unregister', () => ({ ok: true }))
    this.transport.handle('commands.execute', (params) => {
      const parsed = JsonObjectSchema.parse(params)
      return this.transport.invokeExtension(`commands.invoke:command-${String(parsed.id)}`, parsed.args)
    })
    this.transport.handle('network.fetch', (params) => {
      const request = NetworkRequestSchema.parse(params)
      return NetworkResponseSchema.parse({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: request.url, method: request.method }),
        bodyEncoding: 'utf8',
        truncated: false
      })
    })
  }

  #installPermissionRules(): void {
    this.transport.requirePermission('commands.register', 'commands.register')
    this.transport.requirePermission('storage.get', storagePermission)
    this.transport.requirePermission('storage.set', storagePermission)
    this.transport.requirePermission('storage.delete', storagePermission)
    this.transport.requirePermission('storage.keys', storagePermission)
    this.transport.requirePermission('secrets.get', 'storage.secrets')
    this.transport.requirePermission('secrets.set', 'storage.secrets')
    this.transport.requirePermission('secrets.delete', 'storage.secrets')
    this.transport.requirePermission('network.fetch', (params) => {
      const request = NetworkRequestSchema.parse(params)
      return `network:${new URL(request.url).hostname}`
    })
    for (const method of [
      'agent.getRunOptions',
      'agent.createRun',
      'agent.getRun',
      'agent.listRunEvents',
      'agent.subscribe',
      'agent.unsubscribe',
      'agent.steer',
      'agent.cancel'
    ]) {
      this.transport.requirePermission(method, 'agent.run')
    }
    this.transport.requirePermission('threads.listOwn', 'agent.threads.readOwn')
    this.transport.requirePermission('threads.getOwn', 'agent.threads.readOwn')
    this.transport.requirePermission('tools.register', 'tools.register')
    this.transport.requirePermission('modelProviders.register', 'providers.register')
    this.transport.requirePermission('authentication.listAccounts', 'accounts.read')
    this.transport.requirePermission('configuration.get', 'ui.actions')
    this.transport.requirePermission('configuration.update', 'ui.actions')
    this.transport.requirePermission('configuration.keys', 'ui.actions')
    this.transport.requirePermission('ui.showNotification', 'ui.notifications')
    this.transport.requirePermission('ui.attachComposerContext', 'ui.actions')
    this.transport.requirePermission('authentication.revealSecret', (params) => {
      const account = this.accounts.accounts.get(String(JsonObjectSchema.parse(params).accountId))
      return account ? `accounts.secrets.read:${account.providerId}` : 'accounts.read'
    })
    this.transport.requirePermission('workspace.readFile', 'workspace.read')
    this.transport.requirePermission('workspace.stat', 'workspace.read')
    this.transport.requirePermission('workspace.list', 'workspace.read')
    this.transport.requirePermission('workspace.writeFile', 'workspace.write')
    this.transport.requirePermission('media.pickFiles', ['media.read', 'workspace.read'])
    this.transport.requirePermission('media.pickSaveTarget', ['media.export', 'workspace.write'])
    this.transport.requirePermission('media.createCacheTarget', [
      'media.process',
      'workspace.write'
    ])
    this.transport.requirePermission('media.stat', ['media.read', 'workspace.read'])
    this.transport.requirePermission('media.readText', ['media.read', 'workspace.read'])
    this.transport.requirePermission('media.openViewResource', ['media.read', 'workspace.read'])
    this.transport.requirePermission('media.getCapabilities', 'media.process')
    this.transport.requirePermission('media.getAudioAnalysisCapabilities', 'media.process')
    for (const method of [
      'media.getVisualModelStatus',
      'media.installVisualModel',
      'media.embedVisualQuery'
    ]) this.transport.requirePermission(method, 'media.process')
    this.transport.requirePermission('media.analyzeVisualFrames', [
      'media.read', 'media.process', 'workspace.read'
    ])
    this.transport.requirePermission('media.probe', [
      'media.read',
      'media.process',
      'workspace.read'
    ])
    this.transport.requirePermission('media.startFfmpegJob', [
      'media.read',
      'media.process',
      'media.export',
      'jobs.manage',
      'workspace.read',
      'workspace.write'
    ])
    this.transport.requirePermission('media.startAudioAnalysisJob', [
      'media.read',
      'media.process',
      'jobs.manage',
      'workspace.read'
    ])
    this.transport.requirePermission('media.startArchiveJob', [
      'media.read',
      'media.export',
      'jobs.manage',
      'workspace.read',
      'workspace.write'
    ])
    for (const method of ['jobs.get', 'jobs.list', 'jobs.subscribe', 'jobs.unsubscribe', 'jobs.cancel']) {
      this.transport.requirePermission(method, 'jobs.manage')
    }
  }
}


export function createExtensionTestHarness(
  options: ExtensionTestHarnessOptions = {}
): ExtensionTestHarness {
  return new ExtensionTestHarness(options)
}
