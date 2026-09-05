import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ThreadSchema } from '../../src/contracts/threads.js'
import type { RuntimeEvent } from '../../src/contracts/events.js'
import type { ModelConnectionSnapshot } from '../../src/contracts/model-connections.js'
import type { KunTuiClient, ThreadDetail, TuiConnection } from '../../src/tui/client.js'
import { TuiClientError } from '../../src/tui/client.js'
import { TuiController } from '../../src/tui/controller.js'
import type { TuiOptions } from '../../src/tui/options.js'
import { buildRuntimeCapabilityManifest } from '../../src/contracts/capabilities.js'
import { modelCapabilitiesForModel } from '../../src/loop/model-context-profile.js'
import { testGraphEnvelope, testGraphPlan } from '../../src/graph/graph-test-fixtures.test-support.js'
import { testTuiGraphRun } from '../../src/tui/graph-mode.test-support.js'

function detail(overrides: Partial<ThreadDetail> = {}): ThreadDetail {
  return {
    ...ThreadSchema.parse({
      id: 'thr_1',
      title: 'Shared',
      workspace: '/tmp/project',
      model: 'model-a',
      mode: 'agent',
      status: 'idle',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      relation: 'primary',
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
      turns: []
    }),
    latestSeq: 0,
    pendingUserInputIds: [],
    ...overrides
  }
}

function options(): TuiOptions {
  return {
    runtimeToken: 'secret',
    dataDir: '/tmp/data',
    workspace: '/tmp/project',
    continueLatest: true,
    noStart: false,
    help: false
  }
}

const runtime = {
  baseUrl: 'http://127.0.0.1:18899',
  runtimeToken: 'secret',
  discovered: true,
  runtimeInfo: {
    model: 'model-a',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write'
  }
} as unknown as TuiConnection

function credentialSnapshot(
  credentialStatus: 'ready' | 'missing' | 'unreadable' | undefined
): ModelConnectionSnapshot {
  return {
    schemaVersion: 1,
    proxyRoutingVersion: 1,
    revision: 9,
    providers: [{
      id: 'legacy-provider',
      accountId: 'account:legacy-provider',
      name: 'Legacy Provider',
      kind: 'http',
      authType: 'api-key',
      endpointFormat: 'chat_completions',
      useProxy: false,
      configured: true,
      ...(credentialStatus ? { credentialStatus } : {}),
      models: ['model-a'],
      selectedModel: 'model-a'
    }],
    defaultProviderId: 'legacy-provider',
    defaultAccountId: 'account:legacy-provider',
    defaultModel: 'model-a',
    proxy: { enabled: false, url: '' },
    routePools: [],
    localModelGateway: { enabled: false }
  }
}

describe("TuiController Graph, attachment hydration, and legacy runtime behavior", () => {
  it('enters Graph mode before the prompt and submits the shared orchestration contract', async () => {
    const source = detail()
    const startTurn = vi.fn(async () => ({ turnId: 'turn_graph' }))
    const client = {
      graphAvailability: vi.fn(async () => ({ enabled: true })),
      listGraphRuns: vi.fn(async () => []),
      listThreads: vi.fn(async () => [source]),
      getThread: vi.fn(async () => source),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) =>
          input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      startTurn
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options(), runtime)

    await controller.start()
    await controller.manageGraphMode()
    expect(controller.state.composerOrchestration).toBe('graph')
    expect(controller.state.notification?.message).toContain('type a requirement')

    await controller.submit('Implement the release workflow.')
    expect(startTurn).toHaveBeenCalledWith(source.id, expect.objectContaining({
      prompt: 'Implement the release workflow.',
      clientSurface: 'tui',
      orchestration: 'graph'
    }))
    expect(controller.state.projection?.thread.turns.at(-1)?.orchestration).toBe('graph')

    await controller.manageGraphMode('off')
    expect(controller.state.composerOrchestration).toBe('direct')
    await controller.stop()
  })

  it('enables and submits a one-step Graph requirement', async () => {
    const source = detail()
    const startTurn = vi.fn(async () => ({ turnId: 'turn_graph_one_step' }))
    const client = {
      graphAvailability: vi.fn(async () => ({ enabled: true })),
      listGraphRuns: vi.fn(async () => []),
      listThreads: vi.fn(async () => [source]),
      getThread: vi.fn(async () => source),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) =>
          input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      startTurn
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options(), runtime)

    await controller.start()
    await expect(controller.submitGraphRequirement('构建实时看板')).resolves.toBe(true)
    expect(startTurn).toHaveBeenCalledWith(source.id, expect.objectContaining({
      prompt: '构建实时看板',
      orchestration: 'graph'
    }))
    await controller.stop()
  })

  it('refuses disabled Graph entry without changing Direct mode', async () => {
    const client = {
      graphAvailability: vi.fn(async () => ({ enabled: false })),
      listThreads: vi.fn(async () => [])
    } as unknown as KunTuiClient
    const controller = new TuiController(
      client,
      { ...options(), continueLatest: false },
      runtime
    )

    await controller.start()
    await controller.manageGraphMode()
    await expect(controller.submitGraphRequirement('Keep this draft')).resolves.toBe(false)

    expect(controller.state.composerOrchestration).toBe('direct')
    expect(controller.state.graphAvailable).toBe(false)
    expect(controller.state.notification).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('disabled')
    })
    await controller.stop()
  })

  it('explains an older runtime without Graph diagnostics and keeps Direct mode', async () => {
    const client = {
      graphAvailability: vi.fn(async () => {
        throw new TuiClientError('not found', 404, 'not_found')
      }),
      listThreads: vi.fn(async () => [])
    } as unknown as KunTuiClient
    const controller = new TuiController(
      client,
      { ...options(), continueLatest: false },
      runtime
    )

    await controller.start()
    await expect(controller.manageGraphMode()).resolves.toBe(false)
    expect(controller.state).toMatchObject({
      composerOrchestration: 'direct',
      graphAvailable: false,
      graphUnavailableReason: expect.stringContaining('does not support')
    })
    await controller.stop()
  })

  it('does not open a stale Graph board when the requested refresh fails', async () => {
    const source = detail()
    const run = testTuiGraphRun()
    const listGraphRuns = vi.fn()
      .mockResolvedValueOnce([run])
      .mockRejectedValueOnce(new Error('refresh failed'))
    const client = {
      graphAvailability: vi.fn(async () => ({ enabled: true })),
      listGraphRuns,
      listThreads: vi.fn(async () => [source]),
      getThread: vi.fn(async () => source),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) =>
          input.signal.addEventListener('abort', () => resolve(), { once: true }))
      })
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options(), runtime)

    await controller.start()
    await controller.showGraphStatus()
    expect(controller.state.graphBoard).toBeUndefined()
    expect(controller.state.notification).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('Could not load Graph status')
    })
    await controller.stop()
  })

  it('starts a new TUI process in Direct mode after another process selected Graph', async () => {
    const client = {
      graphAvailability: vi.fn(async () => ({ enabled: true })),
      listThreads: vi.fn(async () => [])
    } as unknown as KunTuiClient
    const first = new TuiController(
      client,
      { ...options(), continueLatest: false },
      runtime
    )
    await first.start()
    await first.manageGraphMode()
    expect(first.state.composerOrchestration).toBe('graph')
    await first.stop()

    const restarted = new TuiController(
      client,
      { ...options(), continueLatest: false },
      runtime
    )
    expect(restarted.state.composerOrchestration).toBe('direct')
    await restarted.start()
    expect(restarted.state.composerOrchestration).toBe('direct')
    await restarted.stop()
  })

  it('steers a durable active GraphRun instead of starting a second graph', async () => {
    const source = detail()
    const run = testTuiGraphRun()
    const startTurn = vi.fn()
    const steerGraphRun = vi.fn(async () => run)
    const client = {
      graphAvailability: vi.fn(async () => ({ enabled: true })),
      listGraphRuns: vi.fn(async () => [run]),
      listThreads: vi.fn(async () => [source]),
      getThread: vi.fn(async () => source),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) =>
          input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      startTurn,
      steerGraphRun
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options(), runtime)

    await controller.start()
    await controller.submitGraphRequirement('Prioritize the Windows validation node.')

    expect(steerGraphRun).toHaveBeenCalledWith(
      run.id,
      'Prioritize the Windows validation node.'
    )
    expect(startTurn).not.toHaveBeenCalled()
    expect(controller.state.notification?.message).toContain('Guidance persisted')

    await controller.showGraphStatus()
    expect(controller.state.graphBoard).toEqual({ runId: run.id })
    controller.dismissGraphBoard()
    expect(controller.state.graphBoard).toBeUndefined()
    await controller.stop()
  })

  it('reconciles Graph events through server-confirmed run truth', async () => {
    const source = detail()
    const run = testTuiGraphRun()
    const latestRun = testTuiGraphRun({
      lastEventSeq: 5,
      updatedAt: '2026-07-26T00:00:05.000Z'
    })
    let onEvent!: (event: RuntimeEvent) => void
    let resolveFirst!: (value: typeof run) => void
    const getGraphRun = vi.fn()
      .mockImplementationOnce(() => new Promise<typeof run>((resolve) => {
        resolveFirst = resolve
      }))
      .mockResolvedValueOnce(latestRun)
    const client = {
      graphAvailability: vi.fn(async () => ({ enabled: true })),
      listGraphRuns: vi.fn(async () => []),
      listThreads: vi.fn(async () => [source]),
      getThread: vi.fn(async () => source),
      getGraphRun,
      subscribeThreadEvents: vi.fn(async (input: {
        signal: AbortSignal
        onEvent: (event: RuntimeEvent) => void
      }) => {
        onEvent = input.onEvent
        await new Promise<void>((resolve) =>
          input.signal.addEventListener('abort', () => resolve(), { once: true }))
      })
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options(), runtime)

    await controller.start()
    onEvent({
      kind: 'graph_event',
      threadId: source.id,
      seq: 1,
      timestamp: '2026-07-26T00:00:01.000Z',
      graph: testGraphEnvelope(1, {
        type: 'run_created',
        payload: {
          plan: testGraphPlan(),
          projectId: 'project_1',
          sourceTurnId: 'turn_source'
        }
      }, {
        threadId: source.id
      })
    })
    await vi.waitFor(() => expect(getGraphRun).toHaveBeenCalledTimes(1))
    onEvent({
      kind: 'graph_event',
      threadId: source.id,
      seq: 2,
      timestamp: '2026-07-26T00:00:02.000Z',
      graph: testGraphEnvelope(2, {
        type: 'run_created',
        payload: {
          plan: testGraphPlan(),
          projectId: 'project_1',
          sourceTurnId: 'turn_source'
        }
      }, {
        threadId: source.id
      })
    })
    resolveFirst(run)

    await vi.waitFor(() => expect(controller.state.graphRuns).toEqual([latestRun]))
    expect(getGraphRun).toHaveBeenCalledTimes(2)
    expect(getGraphRun).toHaveBeenNthCalledWith(1, run.id)
    expect(getGraphRun).toHaveBeenNthCalledWith(2, run.id)
    await controller.stop()
  })

  it('hydrates attachment metadata for persisted user messages', async () => {
    const createdAt = '2026-07-22T00:00:00.000Z'
    const source = detail({
      turns: [{
        id: 'turn_attachment',
        threadId: 'thr_1',
        status: 'completed',
        orchestration: 'direct',
        prompt: 'What is in this image?',
        steering: [],
        createdAt,
        startedAt: createdAt,
        finishedAt: createdAt,
        items: [{
          id: 'item_attachment',
          turnId: 'turn_attachment',
          threadId: 'thr_1',
          role: 'user',
          status: 'completed',
          createdAt,
          finishedAt: createdAt,
          kind: 'user_message',
          text: 'What is in this image?',
          attachmentIds: ['att_image']
        }],
        attachmentIds: ['att_image'],
        activeSkillIds: [],
        injectedMemoryIds: [],
        injectedMemorySummaries: [],
        injectedInstructionSources: []
      }]
    })
    const getAttachment = vi.fn(async () => ({
      attachment: {
        id: 'att_image',
        name: 'clipboard.png',
        kind: 'image' as const,
        mimeType: 'image/png',
        byteSize: 2048,
        hash: 'hash-image',
        width: 640,
        height: 480,
        threadIds: ['thr_1'],
        workspaces: ['/tmp/project'],
        createdAt,
        updatedAt: createdAt
      }
    }))
    const client = {
      listThreads: vi.fn(async () => [source]),
      getThread: vi.fn(async () => source),
      getAttachment,
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      })
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options(), runtime)

    await controller.start()
    await vi.waitFor(() => expect(controller.state.attachmentMetadata.att_image).toMatchObject({
      name: 'clipboard.png',
      width: 640,
      height: 480
    }))
    expect(getAttachment).toHaveBeenCalledWith('att_image')
    await controller.stop()
  })

  it('selects from a legacy GUI model catalog locally without calling unavailable runtime routes', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-tui-legacy-model-'))
    const selectModel = vi.fn()
    const client = { selectModel } as unknown as KunTuiClient
    const legacyRuntime = { ...runtime, legacyGui: true }
    const controller = new TuiController(client, { ...options(), dataDir }, legacyRuntime)
    try {
      controller.applyModelSelection({
        schemaVersion: 1,
        proxyRoutingVersion: 1,
        revision: 0,
        providers: [{
          id: 'codex', accountId: 'account:codex', name: 'Codex', kind: 'http',
          authType: 'subscription', baseUrl: 'https://chatgpt.com/backend-api',
          endpointFormat: 'responses', useProxy: false, configured: true,
          models: ['gpt-5.6-luna', 'gpt-5.6-sol'], selectedModel: 'gpt-5.6-luna'
        }],
        defaultProviderId: 'codex', defaultAccountId: 'account:codex', defaultModel: 'gpt-5.6-luna',
        proxy: { enabled: false, url: '' }, routePools: [], localModelGateway: { enabled: false }
      }, false)

      const selected = await controller.selectModel({
        providerId: 'codex', accountId: 'account:codex', model: 'gpt-5.6-sol'
      })
      expect(selected).toMatchObject({ revision: 1, defaultModel: 'gpt-5.6-sol' })
      expect(controller.options).toMatchObject({
        providerId: 'codex', accountId: 'account:codex', model: 'gpt-5.6-sol'
      })
      expect(selectModel).not.toHaveBeenCalled()
    } finally {
      await controller.stop()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('shows a verified legacy GUI session as connected while its idle SSE long poll is pending', async () => {
    const source = detail()
    const client = {
      listThreads: vi.fn(async () => [source]),
      getThread: vi.fn(async () => source),
      subscribeThreadEvents: vi.fn(async (input: {
        signal: AbortSignal
        onConnection?: (state: 'connecting' | 'connected' | 'reconnecting') => void
      }) => {
        input.onConnection?.('connecting')
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      })
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options(), { ...runtime, legacyGui: true })
    await controller.start()
    expect(controller.state.projection?.thread.id).toBe(source.id)
    expect(controller.state.connection).toBe('connected')
    await controller.stop()
  })

  it('refreshes a stale model catalog after another client wins the revision race', async () => {
    const initial = {
      schemaVersion: 1 as const,
      proxyRoutingVersion: 1 as const,
      revision: 2,
      providers: [{
        id: 'deepseek', accountId: 'account:deepseek', name: 'DeepSeek', kind: 'http' as const,
        authType: 'api-key' as const, endpointFormat: 'chat_completions' as const,
        useProxy: false, configured: true, models: ['deepseek-chat'], selectedModel: 'deepseek-chat'
      }],
      defaultProviderId: 'deepseek', defaultAccountId: 'account:deepseek', defaultModel: 'deepseek-chat',
      proxy: { enabled: false, url: '' }, routePools: [], localModelGateway: { enabled: false }
    }
    const refreshed = {
      ...initial,
      revision: 3,
      providers: [...initial.providers, {
        id: 'kimi-code', accountId: 'account:kimi-code', name: 'Kimi Code', kind: 'http' as const,
        authType: 'subscription' as const, endpointFormat: 'chat_completions' as const,
        useProxy: false, configured: true, models: ['kimi-k2.5'], selectedModel: 'kimi-k2.5'
      }]
    }
    const client = {
      selectModel: vi.fn(async () => { throw new TuiClientError('revision conflict', 409, 'revision_conflict') }),
      modelConnections: vi.fn(async () => refreshed)
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options(), runtime)
    controller.applyModelSelection(initial, false)

    await expect(controller.selectModel({
      providerId: 'deepseek', accountId: 'account:deepseek', model: 'deepseek-chat'
    })).rejects.toThrow(/selector was refreshed/i)
    expect(controller.state.modelConnections).toEqual(refreshed)
    expect(client.modelConnections).toHaveBeenCalledOnce()
    await controller.stop()
  })
})
