import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemorySessionStore } from '../src/adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../src/adapters/in-memory-thread-store.js'
import { createThreadRecord } from '../src/domain/thread.js'
import { UsageService } from '../src/services/usage-service.js'
import { createKunServeRuntime, seedUsageCarryover } from '../src/server/runtime-factory.js'
import type { UsageSnapshot } from '../src/contracts/usage.js'
import type { SessionStore } from '../src/ports/session-store.js'
import { KunCapabilitiesConfig } from '../src/contracts/capabilities.js'

function usage(overrides: Partial<UsageSnapshot>): UsageSnapshot {
  const promptTokens = overrides.promptTokens ?? 10
  const completionTokens = overrides.completionTokens ?? 5
  const cacheHitTokens = overrides.cacheHitTokens ?? 0
  const cacheMissTokens = overrides.cacheMissTokens ?? Math.max(promptTokens - cacheHitTokens, 0)
  const cacheTotal = cacheHitTokens + cacheMissTokens
  return {
    promptTokens,
    completionTokens,
    totalTokens: overrides.totalTokens ?? promptTokens + completionTokens,
    cachedTokens: overrides.cachedTokens ?? cacheHitTokens,
    cacheHitTokens,
    cacheMissTokens,
    cacheHitRate: cacheTotal === 0 ? null : cacheHitTokens / cacheTotal,
    turns: overrides.turns ?? 1,
    ...(overrides.costUsd !== undefined ? { costUsd: overrides.costUsd } : {})
  }
}

describe('runtime factory usage carryover', () => {
  const tempDirs: string[] = []
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('seeds runtime usage from the latest persisted cumulative usage event per thread', async () => {
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const usageService = new UsageService()
    await threadStore.upsert(createThreadRecord({
      id: 'thr_seed',
      title: 'Seeded thread',
      workspace: '/tmp/project',
      model: 'deepseek-chat'
    }))
    await sessionStore.appendEvent('thr_seed', {
      kind: 'usage',
      seq: 2,
      timestamp: '2026-06-02T09:00:00.000Z',
      threadId: 'thr_seed',
      usage: usage({ promptTokens: 20, completionTokens: 5, cacheHitTokens: 10, cacheMissTokens: 10, turns: 1 })
    })
    await sessionStore.appendEvent('thr_seed', {
      kind: 'usage',
      seq: 5,
      timestamp: '2026-06-02T09:05:00.000Z',
      threadId: 'thr_seed',
      usage: usage({ promptTokens: 80, completionTokens: 20, cacheHitTokens: 72, cacheMissTokens: 8, turns: 3 })
    })

    await seedUsageCarryover({ threadStore, sessionStore, usageService })

    expect(usageService.forThread('thr_seed')).toMatchObject({
      promptTokens: 80,
      completionTokens: 20,
      totalTokens: 100,
      cacheHitTokens: 72,
      cacheMissTokens: 8,
      turns: 3
    })
    expect(usageService.cacheSnapshot('thr_seed')).toMatchObject({
      hits: 72,
      misses: 8,
      hitRate: 0.9
    })
  })

  it('seeds runtime usage from indexed latest snapshots without replaying event logs', async () => {
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore() as InMemorySessionStore & {
      loadLatestUsageSnapshots: NonNullable<SessionStore['loadLatestUsageSnapshots']>
    }
    const usageService = new UsageService()
    sessionStore.loadLatestUsageSnapshots = vi.fn(async () => [
      {
        threadId: 'thr_indexed',
        seq: 9,
        usage: usage({ promptTokens: 120, completionTokens: 30, cacheHitTokens: 100, cacheMissTokens: 20, turns: 4 })
      }
    ])
    const loadEventsSince = vi.spyOn(sessionStore, 'loadEventsSince')

    await seedUsageCarryover({ threadStore, sessionStore, usageService })

    expect(loadEventsSince).not.toHaveBeenCalled()
    expect(usageService.forThread('thr_indexed')).toMatchObject({
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
      cacheHitTokens: 100,
      cacheMissTokens: 20,
      turns: 4
    })
  })

  it('hot-applies model and tool capabilities into runtime info and diagnostics', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-runtime-apply-'))
    tempDirs.push(dataDir)
    const runtime = await createKunServeRuntime({
      host: '127.0.0.1',
      port: 0,
      dataDir,
      runtimeToken: 'tok',
      apiKey: 'sk-default',
      baseUrl: 'https://api.example.test/v1',
      model: 'model-before',
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access',
      tokenEconomyMode: false,
      insecure: false,
      storage: { backend: 'file' },
      capabilities: KunCapabilitiesConfig.parse({})
    })

    try {
      expect(runtime.llmDebug).toBeUndefined()
      expect(runtime.extensionPlatform).toBeDefined()
      expect(runtime.info().extensions).toMatchObject({
        enabled: true,
        apiVersions: ['1.2.0', '1.1.0', '1.0.0'],
        manifestVersions: [1]
      })
      expect(runtime.info().capabilities.instructions.enabled).toBe(true)
      const applied = await runtime.applyConfig({
        serve: { model: 'model-after' },
        capabilities: KunCapabilitiesConfig.parse({
          web: { enabled: true, fetchEnabled: true },
          instructions: { enabled: false }
        })
      })

      expect(applied).toEqual({ ok: true })
      expect(runtime.info().model).toBe('model-after')
      expect(runtime.info().capabilities.web.fetch.available).toBe(true)
      expect(runtime.info().capabilities.instructions).toMatchObject({ enabled: false, status: 'disabled' })
      const diagnostics = await runtime.toolDiagnostics?.()
      expect(diagnostics?.providers.some((provider) => provider.id === 'web')).toBe(true)
      expect(diagnostics?.instructions?.enabled).toBe(false)
      expect(diagnostics?.extensions).toMatchObject({ tools: [], providers: [], hosts: [] })
    } finally {
      await runtime.shutdown?.()
    }
  })

  it('requires restart instead of acknowledging an unapplied observability change', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-runtime-observability-apply-'))
    tempDirs.push(dataDir)
    const runtime = await createKunServeRuntime({
      host: '127.0.0.1',
      port: 0,
      dataDir,
      runtimeToken: 'tok',
      apiKey: 'sk-default',
      baseUrl: 'https://api.example.test/v1',
      model: 'model-before',
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access',
      tokenEconomyMode: false,
      insecure: false,
      storage: { backend: 'file' },
      capabilities: KunCapabilitiesConfig.parse({})
    })

    try {
      await expect(runtime.applyConfig({
        serve: {
          observability: { enabled: true, exporter: 'otlp-http-json' }
        }
      })).resolves.toEqual({
        ok: false,
        code: 'restart_required',
        message: 'observability exporter changes require a runtime restart'
      })
    } finally {
      await runtime.shutdown?.()
    }
  })

  it('clears per-thread runtime memory when a thread is deleted', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-runtime-delete-'))
    tempDirs.push(dataDir)
    const runtime = await createKunServeRuntime({
      host: '127.0.0.1',
      port: 0,
      dataDir,
      runtimeToken: 'tok',
      apiKey: 'sk-default',
      baseUrl: 'https://api.example.test/v1',
      model: 'model-before',
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access',
      tokenEconomyMode: false,
      insecure: false,
      storage: { backend: 'file' },
      capabilities: KunCapabilitiesConfig.parse({})
    })

    try {
      const threadId = 'thr_deleted'
      await runtime.threadService.create(
        { workspace: '/tmp/workspace', model: 'model-before', mode: 'agent' },
        { id: threadId }
      )
      const eventStreamRegistry = runtime.eventStreamRegistry
      if (!eventStreamRegistry) throw new Error('expected event stream registry')
      const backgroundShellRuntime = runtime.backgroundShellRuntime
      if (!backgroundShellRuntime) throw new Error('expected background shell runtime')
      const closeStream = vi.fn()
      eventStreamRegistry.register(threadId, closeStream)
      const stopThread = vi.spyOn(backgroundShellRuntime, 'stopThread').mockResolvedValue(0)
      runtime.usageService.record(threadId, usage({ promptTokens: 10, completionTokens: 5 }))

      expect(await runtime.threadService.delete(threadId)).toBe(true)
      expect(stopThread).toHaveBeenCalledWith(threadId)
      expect(closeStream).toHaveBeenCalledTimes(1)
      expect(runtime.eventBus.snapshotSince(threadId, 0)).toEqual([])
      expect(runtime.usageService.forThread(threadId).totalTokens).toBe(0)

      await runtime.threadService.create(
        { workspace: '/tmp/workspace', model: 'model-before', mode: 'agent' },
        { id: threadId }
      )
      expect(runtime.eventBus.snapshotSince(threadId, 0).map((event) => event.seq)).toEqual([1])
    } finally {
      await runtime.shutdown?.()
    }
  })

  it('invalidates lazy extension preparation after install, reload, and host crash', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-runtime-extension-preparation-'))
    const sourceDir = await mkdtemp(join(tmpdir(), 'kun-runtime-extension-source-'))
    tempDirs.push(dataDir, sourceDir)
    await writeLazyToolExtension(sourceDir)
    const runnerPath = await writeLazyFixtureRunner(sourceDir)
    const runtime = await createKunServeRuntime({
      host: '127.0.0.1',
      port: 0,
      dataDir,
      runtimeToken: 'tok',
      apiKey: 'sk-default',
      baseUrl: 'https://api.example.test/v1',
      model: 'model-before',
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access',
      tokenEconomyMode: false,
      insecure: false,
      storage: { backend: 'file' },
      capabilities: KunCapabilitiesConfig.parse({}),
      extensionHostRunnerPath: runnerPath
    })

    try {
      const platform = runtime.extensionPlatform!
      const toolHost = runtime.toolHost
      expect(toolHost).toBeDefined()
      if (!toolHost) {
        throw new Error('Expected the Kun runtime tool host to be available')
      }
      await toolHost.listTools()
      expect(platform.tools.list('acme.lazy')).toEqual([])

      await platform.packageManager.registerDevelopment(sourceDir, {
        grantedPermissions: ['tools.register'],
        enable: true,
        select: true
      })
      await toolHost.listTools()
      await expect(platform.manager.diagnostic('acme.lazy')).resolves.toMatchObject({ active: true })
      expect(platform.tools.list('acme.lazy')).toHaveLength(1)

      await writeFile(join(sourceDir, 'reload-marker.txt'), 'generation 2\n')
      await platform.packageManager.reloadDevelopment('acme.lazy')
      await toolHost.listTools()
      expect(platform.tools.list('acme.lazy')).toHaveLength(1)

      await expect(platform.manager.invoke('acme.lazy', 'onTool:echo', 'crash', null))
        .rejects.toBeDefined()
      await vi.waitFor(() => expect(platform.tools.list('acme.lazy')).toEqual([]))
      // First preparation observes bounded restart backoff and remains
      // deliberately uncached; the next attempt can recover cleanly.
      await toolHost.listTools()
      await new Promise((resolve) => setTimeout(resolve, 300))
      await toolHost.listTools()
      expect(platform.tools.list('acme.lazy')).toHaveLength(1)
    } finally {
      await runtime.shutdown?.()
    }
  })

  it('passes an explicitly trusted workspace context to headless extension tools', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-runtime-extension-workspace-'))
    const sourceDir = await mkdtemp(join(tmpdir(), 'kun-runtime-extension-workspace-source-'))
    const workspace = join(sourceDir, 'workspace')
    tempDirs.push(dataDir, sourceDir)
    await mkdir(workspace, { recursive: true })
    await writeLazyToolExtension(sourceDir)
    const runnerPath = await writeLazyFixtureRunner(sourceDir)
    const runtime = await createKunServeRuntime({
      host: '127.0.0.1',
      port: 0,
      dataDir,
      runtimeToken: 'tok',
      apiKey: 'sk-default',
      baseUrl: 'https://api.example.test/v1',
      model: 'model-before',
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access',
      tokenEconomyMode: false,
      insecure: false,
      storage: { backend: 'file' },
      capabilities: KunCapabilitiesConfig.parse({}),
      extensionHostRunnerPath: runnerPath
    })

    try {
      const platform = runtime.extensionPlatform!
      await platform.packageManager.registerDevelopment(sourceDir, {
        grantedPermissions: ['tools.register'],
        enable: true,
        select: true
      })
      await platform.packageManager.setWorkspacePermissionGrant(
        'acme.lazy',
        platform.paths.workspaceKey(workspace),
        ['tools.register'],
        '1.0.0'
      )
      const tools = await runtime.toolHost!.listTools({
        threadId: 'thread_workspace',
        turnId: 'turn_workspace',
        workspace,
        approvalPolicy: 'auto',
        abortSignal: new AbortController().signal,
        awaitApproval: async () => 'allow'
      })

      expect(tools.some((tool) => tool.providerId === 'extension:acme.lazy')).toBe(true)
      await expect(platform.manager.diagnostic('acme.lazy')).resolves.toMatchObject({ active: true })
    } finally {
      await runtime.shutdown?.()
    }
  })

  it('routes workspace configuration changes to only the owning Host and View while global changes fan out', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-runtime-extension-config-scope-'))
    const sourceDir = await mkdtemp(join(tmpdir(), 'kun-runtime-extension-config-source-'))
    const workspaceA = join(sourceDir, 'workspace-a')
    const workspaceB = join(sourceDir, 'workspace-b')
    tempDirs.push(dataDir, sourceDir)
    await Promise.all([
      mkdir(workspaceA, { recursive: true }),
      mkdir(workspaceB, { recursive: true })
    ])
    await writeConfigurationExtension(sourceDir)
    const runnerPath = await writeConfigurationFixtureRunner(sourceDir)
    const runtime = await createKunServeRuntime({
      host: '127.0.0.1',
      port: 0,
      dataDir,
      runtimeToken: 'tok',
      apiKey: 'sk-default',
      baseUrl: 'https://api.example.test/v1',
      model: 'model-before',
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access',
      tokenEconomyMode: false,
      insecure: false,
      storage: { backend: 'file' },
      capabilities: KunCapabilitiesConfig.parse({}),
      extensionHostRunnerPath: runnerPath
    })

    try {
      const extensionId = 'acme.configuration-scope'
      const extensionVersion = '1.0.0'
      const platform = runtime.extensionPlatform!
      await platform.packageManager.registerDevelopment(sourceDir, {
        grantedPermissions: ['ui.actions', 'ui.views', 'webview'],
        enable: true,
        select: true
      })
      const workspaceKeyA = platform.paths.workspaceKey(workspaceA)
      const workspaceKeyB = platform.paths.workspaceKey(workspaceB)
      await Promise.all([
        platform.packageManager.setWorkspacePermissionGrant(
          extensionId,
          workspaceKeyA,
          ['ui.actions', 'ui.views', 'webview'],
          extensionVersion
        ),
        platform.packageManager.setWorkspacePermissionGrant(
          extensionId,
          workspaceKeyB,
          ['ui.actions', 'ui.views', 'webview'],
          extensionVersion
        )
      ])
      const entry = await platform.registry.get(extensionId)
      const manifest = entry?.development?.manifest
      if (!manifest) throw new Error('Expected the configuration fixture manifest')
      const viewTarget = {
        extensionId,
        extensionVersion,
        contributionId: `extension:${extensionId}/panel`,
        localContributionId: 'panel',
        entry: 'view.html',
        activationEvent: 'onView:panel',
        workspaceTrusted: true,
        grantedPermissions: ['ui.actions', 'ui.views', 'webview']
      }
      const viewA = platform.viewSessions.create({ ...viewTarget, workspaceRoot: workspaceA })
      const viewB = platform.viewSessions.create({ ...viewTarget, workspaceRoot: workspaceB })
      await Promise.all([
        platform.manager.activate(extensionId, 'onView:panel', { workspaceRoot: workspaceA }),
        platform.manager.activate(extensionId, 'onView:panel', { workspaceRoot: workspaceB })
      ])

      await platform.configuration.update({
        principal: platform.viewSessions.principal(viewA.sessionId),
        manifest,
        sectionId: 'workspace',
        key: 'mode',
        value: 'workspace-a',
        expectedRevision: 0
      })
      await platform.configuration.update({
        principal: platform.viewSessions.principal(viewB.sessionId),
        manifest,
        sectionId: 'workspace',
        key: 'mode',
        value: 'workspace-b',
        expectedRevision: 1
      })
      await platform.configuration.update({
        principal: platform.viewSessions.principal(viewA.sessionId),
        manifest,
        sectionId: 'global',
        key: 'enabled',
        value: true,
        expectedRevision: 2
      })

      const hostNotifications = async (workspaceRoot: string) => platform.manager.invoke(
        extensionId,
        'onView:panel',
        'notifications',
        null,
        { workspaceRoot }
      )
      const workspaceEvent = (value: string) => ({
        method: 'configuration.changed',
        params: { sectionId: 'workspace', key: 'mode', scope: 'workspace', value }
      })
      const globalEvent = {
        method: 'configuration.changed',
        params: { sectionId: 'global', key: 'enabled', scope: 'global', value: true }
      }
      await expect(hostNotifications(workspaceA)).resolves.toEqual([
        workspaceEvent('workspace-a'),
        globalEvent
      ])
      await expect(hostNotifications(workspaceB)).resolves.toEqual([
        workspaceEvent('workspace-b'),
        globalEvent
      ])

      const viewNotifications = (sessionId: string) => platform.viewSessions
        .replay(sessionId, 0, 20)
        .events
        .filter((event) => event.type === 'bridge')
        .map((event) => event.payload)
      expect(viewNotifications(viewA.sessionId)).toEqual([
        workspaceEvent('workspace-a'),
        globalEvent
      ])
      expect(viewNotifications(viewB.sessionId)).toEqual([
        workspaceEvent('workspace-b'),
        globalEvent
      ])
    } finally {
      await runtime.shutdown?.()
    }
  })
})

async function writeLazyToolExtension(root: string): Promise<void> {
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'kun-extension.json'), `${JSON.stringify({
    manifestVersion: 1,
    apiVersion: '1.0.0',
    publisher: 'acme',
    name: 'lazy',
    version: '1.0.0',
    engines: { kun: '*' },
    main: 'main.mjs',
    activationEvents: ['onTool:echo'],
    contributes: {
      tools: [{
        id: 'echo',
        description: 'Echo a bounded string.',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false
        }
      }]
    },
    permissions: ['tools.register'],
    stateSchemaVersion: 0
  }, null, 2)}\n`)
  await writeFile(join(root, 'README.md'), '# Lazy extension\n')
  await writeFile(join(root, 'LICENSE'), 'MIT\n')
  await writeFile(join(root, 'main.mjs'), `
export async function activate(context) {
  const declaration = {
    id: 'echo',
    description: 'Echo a bounded string.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false
    }
  };
  context.subscriptions.add(await context.tools.registerTool(
    declaration,
    async (input) => ({ content: { echo: input.text } })
  ));
}
export function crash() { process.exit(17); }
`)
}

async function writeConfigurationExtension(root: string): Promise<void> {
  await writeFile(join(root, 'kun-extension.json'), `${JSON.stringify({
    manifestVersion: 1,
    apiVersion: '1.0.0',
    publisher: 'acme',
    name: 'configuration-scope',
    version: '1.0.0',
    engines: { kun: '*' },
    main: 'main.mjs',
    activationEvents: ['onView:panel'],
    contributes: {
      'views.rightSidebar': [{ id: 'panel', title: 'Panel', entry: 'view.html' }],
      settings: [{
        id: 'workspace',
        title: 'Workspace',
        scope: 'workspace',
        properties: {
          mode: { type: 'string', default: 'default' }
        }
      }, {
        id: 'global',
        title: 'Global',
        scope: 'global',
        properties: {
          enabled: { type: 'boolean', default: false }
        }
      }]
    },
    permissions: ['ui.actions', 'ui.views', 'webview'],
    stateSchemaVersion: 0
  }, null, 2)}\n`)
  await writeFile(join(root, 'README.md'), '# Configuration scope fixture\n')
  await writeFile(join(root, 'LICENSE'), 'MIT\n')
  await writeFile(join(root, 'main.mjs'), 'export async function activate() {}\n')
  await writeFile(join(root, 'view.html'), '<!doctype html><title>Panel</title>\n')
}

async function writeConfigurationFixtureRunner(root: string): Promise<string> {
  const path = join(root, 'configuration-fixture-runner.mjs')
  await writeFile(path, `
const notifications = [];
function send(message) { if (process.connected) process.send(message); }
function result(id, value) {
  send({ rpcVersion: 1, kind: 'response', id, result: value });
}
process.on('message', (message) => {
  if (message.kind === 'notification') {
    notifications.push({ method: message.method, params: message.params });
    return;
  }
  if (message.kind !== 'request') return;
  if (message.method === 'host.initialize') {
    result(message.id, {
      initialized: true,
      rpcVersion: 1,
      apiVersion: message.params.identity.apiVersion
    });
    return;
  }
  if (message.method === 'host.load') {
    result(message.id, { loaded: true });
    return;
  }
  if (message.method === 'extension.activate') {
    result(message.id, { activated: true });
    return;
  }
  if (message.method === 'extension.invoke') {
    result(message.id, message.params.method === 'notifications' ? notifications : null);
    return;
  }
  if (message.method === 'extension.deactivate') {
    result(message.id, { deactivated: true });
  }
});
process.on('disconnect', () => process.exit(0));
send({ rpcVersion: 1, kind: 'notification', method: 'host.ready', params: { pid: process.pid } });
`)
  return path
}

async function writeLazyFixtureRunner(root: string): Promise<string> {
  const path = join(root, 'fixture-runner.mjs')
  await writeFile(path, `
const pending = new Map();
let initialization;
function send(message) { if (process.connected) process.send(message); }
function result(id, value) { send({ rpcVersion: 1, kind: 'response', id, result: value }); }
process.on('message', (message) => {
  if (message.kind === 'response') {
    const activationId = pending.get(message.id);
    if (!activationId) return;
    pending.delete(message.id);
    if (message.error) send({ rpcVersion: 1, kind: 'response', id: activationId, error: message.error });
    else result(activationId, { activated: true });
    return;
  }
  if (message.kind !== 'request') return;
  if (message.method === 'host.initialize') {
    initialization = message.params;
    result(message.id, {
      initialized: true,
      rpcVersion: 1,
      apiVersion: initialization.identity.apiVersion
    });
    return;
  }
  if (message.method === 'host.load') { result(message.id, { loaded: true }); return; }
  if (message.method === 'extension.activate') {
    if (initialization.workspaceRoots.length > 0) {
      const workspace = initialization.workspaceContext;
      if (
        !workspace ||
        workspace.root !== initialization.workspaceRoots[0] ||
        workspace.trusted !== true ||
        workspace.active !== true
      ) {
        send({
          rpcVersion: 1,
          kind: 'response',
          id: message.id,
          error: {
            code: 'EXTENSION_WORKSPACE_CONTEXT_MISSING',
            message: 'trusted active workspace context is required'
          }
        });
        return;
      }
    }
    const brokerId = 'broker_' + Math.random().toString(16).slice(2);
    pending.set(brokerId, message.id);
    send({
      rpcVersion: 1,
      kind: 'request',
      id: brokerId,
      method: 'tools.register',
      params: {
        id: 'echo',
        description: 'Echo a bounded string.',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false
        }
      }
    });
    return;
  }
  if (message.method === 'extension.deactivate') {
    result(message.id, { deactivated: true });
    return;
  }
  if (message.method === 'extension.invoke') {
    if (message.params.method === 'crash') { process.exit(17); return; }
    if (message.params.method.startsWith('tools.invoke:')) {
      result(message.id, { content: { echo: message.params.params.input.text } });
      return;
    }
    result(message.id, null);
  }
});
process.on('disconnect', () => process.exit(0));
send({ rpcVersion: 1, kind: 'notification', method: 'host.ready', params: { pid: process.pid } });
`)
  return path
}
