import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemorySessionStore } from '../../src/adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../../src/adapters/in-memory-thread-store.js'
import { createThreadRecord } from '../../src/domain/thread.js'
import { UsageService } from '../../src/services/usage-service.js'
import { createKunServeRuntime, seedUsageCarryover } from '../../src/server/runtime-factory.js'
import type { UsageSnapshot } from '../../src/contracts/usage.js'
import type { SessionStore } from '../../src/ports/session-store.js'
import { KunCapabilitiesConfig } from '../../src/contracts/capabilities.js'
import { startLlmDebugRoundIfEnabled } from '../../src/services/llm-debug-recorder.js'
import { usage, writeConfigurationExtension, writeConfigurationFixtureRunner, writeLazyFixtureRunner, writeLazyToolExtension } from '../support/runtime-factory-fixtures.js'

describe('runtime factory usage carryover', () => {
  const tempDirs: string[] = []
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('requires restart when config apply changes Agent Perspective capture policy', async () => {
    for (const [name, runtimeOptions, appliedRuntime] of [
      ['disable', undefined, { llmDebug: { enabled: false } }],
      ['enable', { llmDebug: { enabled: false } }, { llmDebug: { enabled: true } }]
    ] as const) {
      const dataDir = await mkdtemp(join(tmpdir(), `kun-runtime-llm-debug-apply-${name}-`))
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
        ...(runtimeOptions ? { runtime: runtimeOptions } : {}),
        capabilities: KunCapabilitiesConfig.parse({})
      })

      try {
        await expect(runtime.applyConfig({
          runtime: appliedRuntime
        })).resolves.toEqual({
          ok: false,
          code: 'restart_required',
          message: 'Agent Perspective capture changes require a runtime restart'
        })
        expect(Boolean(runtime.llmDebug)).toBe(true)
      } finally {
        await runtime.shutdown?.()
      }
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

  it('hot-applies Cursor credentials and routing ownership through a new runtime generation', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-runtime-cursor-apply-'))
    tempDirs.push(dataDir)
    const baseOptions = {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      runtimeToken: 'tok',
      apiKey: 'cursor-default',
      baseUrl: '',
      model: 'auto',
      approvalPolicy: 'auto' as const,
      sandboxMode: 'workspace-write' as const,
      tokenEconomyMode: false,
      insecure: false,
      storage: { backend: 'file' as const },
      capabilities: KunCapabilitiesConfig.parse({}),
      providers: {
        'cursor-subscription': {
          kind: 'cursor-sdk' as const,
          apiKey: 'cursor-before'
        }
      }
    }
    const runtime = await createKunServeRuntime(baseOptions)

    try {
      await expect(runtime.applyConfig({
        serve: {
          providers: {
            'cursor-subscription': {
              kind: 'cursor-sdk',
              apiKey: 'cursor-after'
            }
          }
        }
      })).resolves.toEqual({ ok: true })

      await expect(runtime.applyConfig({
        serve: {
          providers: {
            'cursor-subscription': {
              kind: 'cursor-sdk',
              apiKey: 'cursor-after'
            },
            'cursor-second': {
              kind: 'cursor-sdk',
              apiKey: 'cursor-second'
            }
          }
        }
      })).resolves.toEqual({ ok: true })
    } finally {
      await runtime.shutdown?.()
    }
  }, 15_000)

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
