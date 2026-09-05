import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, vi } from 'vitest'
import { parseExtensionManifest } from '@kun/extension-api'
import {
  ExtensionPaths,
  ExtensionRegistry,
  manifestCompatibilityReport,
  type DevelopmentExtensionRecord
} from '../../src/extensions/index.js'
import { ExtensionViewSessionService } from '../../src/services/extension-view-session-service.js'
import { extensionProviderId } from '../../src/services/extension-provider-account-store.js'
import type { ExtensionAgentEvent } from '../../src/services/extension-agent-service.js'
import type { ServerRuntime } from '../../src/server/routes/server-runtime.js'
import {
  buildExtensionPublicRouter,
  EXTENSION_SESSION_ID_HEADER,
  EXTENSION_SESSION_NONCE_HEADER
} from '../../src/server/routes/extension-public.js'

const cleanupRoots: string[] = []
export const WORKSPACE_ROOT = resolve('/workspace')

afterEach(async () => {
  for (const root of cleanupRoots.splice(0)) await rm(root, { recursive: true, force: true })
})


export async function createFixture(options: {
  maxEvents?: number
  apiVersion?: string
  showInRightRail?: boolean
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'kun-extension-public-routes-'))
  cleanupRoots.push(root)
  const paths = new ExtensionPaths({
    packageRoot: join(root, 'packages'),
    dataRoot: join(root, 'data')
  })
  const registry = new ExtensionRegistry(paths)
  const permissions = [
    'commands.register',
    'ui.views',
    'webview',
    'agent.run',
    'agent.threads.readOwn',
    'tools.register',
    'providers.register',
    'ui.actions',
    'accounts.read',
    'accounts.use:provider',
    'accounts.manage:provider',
    'accounts.use:ext-provider',
    'accounts.manage:ext-provider',
    'media.read',
    'media.process',
    'media.export',
    'jobs.manage',
    'workspace.read',
    'workspace.write'
  ]
  const manifest = parseExtensionManifest({
    publisher: 'acme',
    name: 'dashboard',
    displayName: 'Dashboard',
    localizations: {
      'zh-CN': {
        displayName: '仪表盘',
        contributes: {
          commands: { refresh: { title: '刷新面板' } },
          'views.rightSidebar': { panel: { title: '仪表盘' } },
          settings: {
            general: {
              title: '通用',
              properties: {
                mode: { title: '模式', description: '选择处理模式。' }
              }
            }
          }
        }
      }
    },
    version: '1.0.0',
    manifestVersion: 1,
    apiVersion: options.apiVersion ?? '1.0.0',
    engines: { kun: '*' },
    main: 'dist/main.mjs',
    browser: 'webview/index.html',
    activationEvents: [
      'onView:panel',
      'onCommand:refresh',
      'onTool:echo',
      'onAuthentication:key-auth',
      'onProvider:provider'
    ],
    contributes: {
      commands: [{ id: 'refresh', title: 'Refresh dashboard' }],
      'views.rightSidebar': [{
        id: 'panel',
        title: 'Dashboard',
        entry: 'webview/index.html',
        ...(options.showInRightRail === undefined ? {} : { showInRightRail: options.showInRightRail })
      }],
      tools: [{
        id: 'echo',
        description: 'Echo input',
        inputSchema: { type: 'object' }
      }],
      modelProviders: [{
        id: 'provider',
        displayName: 'Provider',
        authenticationProviderId: 'key-auth',
        models: [{
          id: 'custom-model',
          displayName: 'Custom model',
          capabilities: {
            input: ['text'],
            output: ['text'],
            tools: true,
            reasoning: false,
            parallelTools: false,
            streaming: true
          }
        }]
      }],
      authentication: [{
        id: 'key-auth',
        displayName: 'API key',
        type: 'api-key',
        apiKey: { header: 'Authorization', prefix: 'Bearer ' }
      }],
      settings: [{
        id: 'general',
        title: 'General',
        scope: 'workspace',
        properties: { mode: { type: 'string', enum: ['safe', 'fast'], default: 'safe' } }
      }]
    },
    permissions,
    stateSchemaVersion: 0
  })
  const now = new Date().toISOString()
  const canonicalProviderId = extensionProviderId('acme.dashboard', 'provider')
  const development: DevelopmentExtensionRecord = {
    path: join(root, 'development'),
    source: { type: 'development', locator: join(root, 'development') },
    digest: 'a'.repeat(64),
    manifest,
    requestedPermissions: [...permissions],
    grantedPermissions: [...permissions],
    registeredAt: now,
    reloadedAt: now,
    generation: 1,
    mutable: true
  }
  await registry.registerDevelopment('acme.dashboard', development)
  await registry.setWorkspacePermissionGrant(
    'acme.dashboard',
    paths.workspaceKey(WORKSPACE_ROOT),
    permissions,
    development.manifest.version
  )

  const viewSessions = new ExtensionViewSessionService({
    ...(options.maxEvents ? { maxEvents: options.maxEvents } : {})
  })
  const manager = {
    activate: vi.fn().mockResolvedValue(undefined),
    notify: vi.fn().mockResolvedValue(undefined)
  }
  const agent = {
    createRun: vi.fn(),
    getRun: vi.fn(),
    steer: vi.fn(),
    cancel: vi.fn(),
    subscribe: vi.fn(),
    listOwnThreads: vi.fn(),
    getOwnThread: vi.fn()
  }
  const broker = {
    handlePrincipal: vi.fn(),
    handleTrustedManagement: vi.fn(),
    completePkceAccountSession: vi.fn()
  }
  const provider = {
    id: 'ext-provider',
    ownerExtensionId: 'acme.dashboard',
    ownerExtensionVersion: '1.0.0',
    displayName: 'Provider',
    authTypes: ['api-key'],
    apiKey: { headerName: 'Authorization', prefix: 'Bearer ' },
    capabilities: {
      streaming: true,
      toolCalls: true,
      reasoning: false,
      images: false,
      documents: false,
      tokenCounting: false
    },
    createdAt: now,
    updatedAt: now
  }
  const accounts = {
    listAccounts: vi.fn().mockResolvedValue([{
      id: 'account-1',
      providerId: 'ext-provider',
      ownerExtensionId: 'acme.dashboard',
      label: 'Personal',
      authType: 'api-key',
      status: 'connected',
      metadata: {},
      createdAt: now,
      updatedAt: now
    }]),
    createApiKeyAccount: vi.fn().mockResolvedValue({
      id: 'account-created',
      providerId: 'ext-provider',
      ownerExtensionId: 'acme.dashboard',
      label: 'Protected account',
      authType: 'api-key',
      status: 'connected',
      metadata: {},
      createdAt: now,
      updatedAt: now
    }),
    renameAccount: vi.fn().mockImplementation(async ({ accountId, label }: {
      accountId: string
      label: string
    }) => ({
      id: accountId,
      providerId: 'ext-provider',
      ownerExtensionId: 'acme.dashboard',
      label,
      authType: 'api-key',
      status: 'connected',
      metadata: {},
      createdAt: now,
      updatedAt: now
    })),
    replaceApiKeyAccount: vi.fn().mockImplementation(async ({ accountId }: {
      accountId: string
    }) => ({
      id: accountId,
      providerId: 'ext-provider',
      ownerExtensionId: 'acme.dashboard',
      label: 'Renamed account',
      authType: 'api-key',
      status: 'connected',
      metadata: {},
      createdAt: now,
      updatedAt: now
    })),
    deleteAccount: vi.fn().mockResolvedValue(true)
  }
  const secretReveals = {
    list: vi.fn((): Array<Record<string, string>> => []),
    decide: vi.fn(() => false)
  }
  const configuration = {
    snapshot: vi.fn().mockResolvedValue({
      schemaVersion: 1,
      revision: 0,
      values: { 'extension:acme.dashboard/general': { mode: 'safe' } }
    }),
    update: vi.fn().mockResolvedValue({
      schemaVersion: 1,
      revision: 1,
      values: { 'extension:acme.dashboard/general': { mode: 'fast' } }
    })
  }
  const mediaHandles = {
    register: vi.fn(async (_principal, input: { mode: 'read' | 'write'; displayName: string }) => ({
      id: input.mode === 'write' ? 'media_export_000000001' : 'media_handle_0000000001',
      displayName: input.displayName,
      mode: input.mode,
      source: 'picker',
      mimeType: 'video/mp4',
      ...(input.mode === 'read' ? {
        byteSize: 1234,
        modifiedAt: '2026-07-13T00:00:00.000Z',
        completionIdentity: 'identity_0000000001'
      } : {}),
      available: true,
      createdAt: '2026-07-13T00:00:00.000Z'
    })),
    release: vi.fn(async () => true),
    resolve: vi.fn(async () => ({
      id: 'media_handle_0000000001',
      displayName: 'interview.mp4',
      mode: 'read',
      source: 'picker',
      mimeType: 'video/mp4',
      byteSize: 1234,
      modifiedAt: '2026-07-13T00:00:00.000Z',
      completionIdentity: 'identity_0000000001',
      available: true,
      createdAt: '2026-07-13T00:00:00.000Z',
      absolutePath: '/private/media/interview.mp4',
      workspaceRoot: WORKSPACE_ROOT,
      ownerExtensionId: 'acme.dashboard',
      ownerExtensionVersion: '1.0.0',
      identity: { size: 1234, mtimeMs: 1000, device: 2, inode: 3 }
    }))
  }
  const artifacts = {
    getOwned: vi.fn(async (_principal, artifactId: string) => ({
      schemaVersion: 1,
      artifactId,
      ownerExtensionId: 'acme.dashboard',
      ownerExtensionVersion: '1.0.0',
      workspaceId: paths.workspaceKey(WORKSPACE_ROOT),
      mediaHandleId: 'media_handle_0000000001',
      displayName: 'interview.mp4',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      byteSize: 1234,
      completionIdentity: 'identity_0000000001',
      availability: 'available',
      provenance: { invocationId: 'invocation_1', operation: 'video-render' }
    }))
  }
  const platform = {
    paths,
    registry,
    packageManager: {
      waitForPendingOperation: vi.fn().mockResolvedValue(undefined),
      compatibilityReport: (input: typeof manifest) => manifestCompatibilityReport(input, {
        kunVersion: '0.1.0',
        supportedManifestVersions: [1],
        supportedApiVersions: ['1.0.0']
      }),
      admitManifest: (input: typeof manifest) => {
        const report = manifestCompatibilityReport(input, {
          kunVersion: '0.1.0',
          supportedManifestVersions: [1],
          supportedApiVersions: ['1.0.0']
        })
        if (!report.api.compatible) throw new Error(report.api.message)
        return report
      }
    },
    manager,
    broker,
    viewSessions,
    agent,
    tools: {
      list: vi.fn(() => [{
        canonicalToolId: 'extension:acme.dashboard/echo',
        modelAlias: 'ext_echo',
        extensionId: 'acme.dashboard',
        declaration: {
          name: 'echo',
          description: 'Echo input',
          inputSchema: { type: 'object' },
          sideEffect: 'none',
          idempotent: true
        }
      }])
    },
    providerAccounts: {
      listProviders: vi.fn().mockResolvedValue([provider]),
      getProvider: vi.fn(async (id: string) => {
        if (id === canonicalProviderId) return { ...provider, id: canonicalProviderId }
        return id === 'ext-provider' ? provider : null
      }),
      getAccount: vi.fn(async (id: string) => id === 'account-1' ? {
        id: 'account-1',
        providerId: canonicalProviderId,
        ownerExtensionId: 'acme.dashboard',
        label: 'Personal',
        authType: 'api-key',
        status: 'connected',
        credentialRef: 'cred-secret',
        metadata: {},
        createdAt: now,
        updatedAt: now
      } : null),
      validateBinding: vi.fn(),
      getBinding: vi.fn().mockResolvedValue(null),
      setBinding: vi.fn().mockImplementation(async (input) => ({
        scopeKey: input.scopeKey,
        ownerExtensionId: input.ownerExtensionId,
        ownerExtensionVersion: input.ownerExtensionVersion,
        binding: input.binding,
        dataAccessDigest: input.dataAccessDigest,
        dataCategories: input.dataCategories,
        acknowledgedAt: now,
        updatedAt: now
      }))
    },
    accounts,
    credentials: {
      protection: vi.fn().mockResolvedValue({
        mode: 'encrypted-fallback',
        degraded: true,
        available: true
      })
    },
    secretReveals,
    configuration,
    mediaHandles,
    artifacts,
    modelProviders: {
      probe: vi.fn(),
      listModels: vi.fn().mockResolvedValue(manifest.contributes.modelProviders[0]!.models),
      isAvailable: vi.fn(() => true)
    }
  }
  const runtime = {
    extensionPlatform: platform,
    runtimeToken: 'route-runtime-token',
    insecure: false
  } as unknown as ServerRuntime
  return {
    runtime,
    paths,
    registry,
    manager,
    agent,
    broker,
    accounts,
    providerAccounts: platform.providerAccounts,
    canonicalProviderId,
    secretReveals,
    configuration,
    mediaHandles,
    viewSessions
  }
}

export async function createSession(router: ReturnType<typeof buildExtensionPublicRouter>) {
  return dispatchJson(router, 'POST', '/v1/extensions/view-sessions', {
    contributionId: 'extension:acme.dashboard/panel'
  }, runtimeHeaders())
}

export function runtimeHeaders(): Record<string, string> {
  return { authorization: 'Bearer route-runtime-token' }
}

export function sessionHeaders(sessionId: string, nonce: string): Record<string, string> {
  return {
    [EXTENSION_SESSION_ID_HEADER]: sessionId,
    [EXTENSION_SESSION_NONCE_HEADER]: nonce
  }
}

export async function dispatchJson(
  router: ReturnType<typeof buildExtensionPublicRouter>,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  const response = await dispatchRaw(router, method, path, body, headers)
  if (!(response instanceof Response)) {
    return { status: response.status, body: JSON.parse(response.body) }
  }
  return { status: response.status, body: await response.json() }
}

export async function dispatchRaw(
  router: ReturnType<typeof buildExtensionPublicRouter>,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
) {
  const request = new Request(`http://127.0.0.1${path}`, {
    method,
    headers: {
      ...headers,
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  const match = router.match(method, new URL(request.url).pathname)
  if (!match) throw new Error(`route did not match: ${method} ${path}`)
  return match.handler(request, { params: match.params })
}
