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

describe("TuiController model selection and turn startup", () => {
  it('hydrates the shared default before first render and publishes it through the compatibility callback', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-tui-default-model-'))
    const snapshot: ModelConnectionSnapshot = {
      schemaVersion: 1,
      proxyRoutingVersion: 1,
      revision: 7,
      providers: [{
        id: 'codex',
        accountId: 'account:codex',
        name: 'Codex',
        kind: 'http',
        authType: 'subscription',
        baseUrl: 'https://example.test/codex',
        endpointFormat: 'responses',
        useProxy: false,
        configured: true,
        models: ['gpt-next'],
        selectedModel: 'gpt-next'
      }],
      defaultProviderId: 'codex',
      defaultAccountId: 'account:codex',
      defaultModel: 'gpt-next',
      proxy: { enabled: false, url: '' },
      routePools: [],
      localModelGateway: { enabled: false }
    }
    const client = {
      modelConnections: vi.fn(async () => snapshot),
      listThreads: vi.fn(async () => [])
    } as unknown as KunTuiClient
    const persistSelection = vi.fn(async () => undefined)
    const tuiOptions = { ...options(), dataDir, continueLatest: false }
    const tuiRuntime = {
      ...runtime,
      runtimeInfo: { ...runtime.runtimeInfo, model: 'stale-model' }
    } as TuiConnection
    const controller = new TuiController(client, tuiOptions, tuiRuntime, persistSelection)

    try {
      const initialized = await controller.initializeModelConnections()
      expect(initialized).toBe(snapshot)
      expect(controller.state.modelConnections).toBe(snapshot)
      expect(tuiOptions).toMatchObject({
        providerId: 'codex',
        accountId: 'account:codex',
        model: 'gpt-next'
      })
      expect(tuiRuntime.runtimeInfo.model).toBe('gpt-next')
      expect(persistSelection).toHaveBeenCalledWith(snapshot)
    } finally {
      await controller.stop()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it.each(['missing', 'unreadable'] as const)(
    'does not create a session with a configured provider whose credential is %s',
    async (credentialStatus) => {
      const dataDir = await mkdtemp(join(tmpdir(), 'kun-tui-broken-credential-create-'))
      const createThread = vi.fn()
      const controller = new TuiController(
        { createThread } as unknown as KunTuiClient,
        { ...options(), dataDir, continueLatest: false },
        runtime
      )
      try {
        controller.applyModelSelection(credentialSnapshot(credentialStatus), false)

        await controller.createThread('Blocked credential')

        expect(createThread).not.toHaveBeenCalled()
        expect(controller.state.notification).toMatchObject({
          kind: 'error',
          message: expect.stringMatching(/No connected default model/u)
        })
      } finally {
        await controller.stop()
        await rm(dataDir, { recursive: true, force: true })
      }
    }
  )

  it('rejects direct model selection when the credential is missing', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-tui-broken-credential-select-'))
    const selectModel = vi.fn()
    const controller = new TuiController(
      { selectModel } as unknown as KunTuiClient,
      { ...options(), dataDir },
      runtime
    )
    try {
      controller.applyModelSelection(credentialSnapshot('missing'), false)

      await expect(controller.selectModel({
        providerId: 'legacy-provider',
        accountId: 'account:legacy-provider',
        model: 'model-a'
      })).rejects.toThrow(/credential is missing/u)
      expect(selectModel).not.toHaveBeenCalled()
    } finally {
      await controller.stop()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('does not start a turn when an active session credential is unreadable', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-tui-broken-credential-turn-'))
    const current = detail({
      providerId: 'legacy-provider',
      accountId: 'account:legacy-provider',
      model: 'model-a'
    })
    const startTurn = vi.fn()
    const client = {
      listThreads: vi.fn(async () => [current]),
      getThread: vi.fn(async () => current),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) =>
          input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      startTurn
    } as unknown as KunTuiClient
    const controller = new TuiController(client, { ...options(), dataDir }, runtime)
    try {
      await controller.start()
      controller.applyModelSelection(credentialSnapshot('unreadable'), false)

      await controller.submit('Do not send this')

      expect(startTurn).not.toHaveBeenCalled()
      expect(controller.state.notification).toMatchObject({
        kind: 'error',
        message: expect.stringMatching(/credential cannot be read/u)
      })
      expect(controller.state.busy).toBe(false)
    } finally {
      await controller.stop()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('keeps an open session pinned while new sessions follow a changed shared default', async () => {
    const oldThread = detail({
      providerId: 'codex',
      accountId: 'account:codex',
      model: 'gpt-old'
    })
    const newThread = detail({
      id: 'thr_new',
      providerId: 'minimax',
      accountId: 'account:minimax',
      model: 'MiniMax-M3'
    })
    let threads = [oldThread]
    const createThread = vi.fn(async () => {
      threads = [oldThread, newThread]
      return newThread
    })
    const client = {
      listThreads: vi.fn(async () => threads),
      getThread: vi.fn(async (id: string) => threads.find((thread) => thread.id === id)!),
      createThread,
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) =>
          input.signal.addEventListener('abort', () => resolve(), { once: true }))
      })
    } as unknown as KunTuiClient
    const tuiOptions = options()
    const controller = new TuiController(client, tuiOptions, runtime)

    await controller.start()
    expect(tuiOptions).toMatchObject({
      providerId: 'codex',
      accountId: 'account:codex',
      model: 'gpt-old'
    })
    controller.applyModelSelection({
      schemaVersion: 1,
      proxyRoutingVersion: 1,
      revision: 8,
      providers: [{
        id: 'minimax',
        accountId: 'account:minimax',
        name: 'MiniMax',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://example.test/minimax',
        endpointFormat: 'chat_completions',
        useProxy: false,
        configured: true,
        models: ['MiniMax-M3'],
        selectedModel: 'MiniMax-M3'
      }],
      defaultProviderId: 'minimax',
      defaultAccountId: 'account:minimax',
      defaultModel: 'MiniMax-M3',
      proxy: { enabled: false, url: '' },
      routePools: [],
      localModelGateway: { enabled: false }
    }, false)

    expect(tuiOptions).toMatchObject({
      providerId: 'codex',
      accountId: 'account:codex',
      model: 'gpt-old'
    })
    await controller.createThread()
    expect(createThread).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'minimax',
      accountId: 'account:minimax',
      model: 'MiniMax-M3'
    }))
    await controller.stop()
  })

  it('leaves implicit permissions to the active shared runtime defaults', async () => {
    const created = detail({
      id: 'thr_inherited',
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access'
    })
    const createThread = vi.fn(async (_request: Parameters<KunTuiClient['createThread']>[0]) => created)
    const client = {
      createThread,
      listThreads: vi.fn(async () => [created]),
      getThread: vi.fn(async () => created),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) =>
          input.signal.addEventListener('abort', () => resolve(), { once: true }))
      })
    } as unknown as KunTuiClient
    const staleRuntime = {
      ...runtime,
      runtimeInfo: {
        ...runtime.runtimeInfo,
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write'
      }
    } as TuiConnection
    const controller = new TuiController(client, { ...options(), continueLatest: false }, staleRuntime)

    await controller.createThread('Inherited permissions')

    const request = createThread.mock.calls[0]![0]
    expect(request).not.toHaveProperty('approvalPolicy')
    expect(request).not.toHaveProperty('sandboxMode')
    expect(request).not.toHaveProperty('approvalReviewer')
    await controller.stop()
  })

  it.each([
    {
      name: 'approval only',
      overrides: { approvalPolicy: 'never' as const },
      expected: { approvalPolicy: 'never' }
    },
    {
      name: 'sandbox only',
      overrides: { sandboxMode: 'danger-full-access' as const },
      expected: { sandboxMode: 'danger-full-access' }
    },
    {
      name: 'reviewer only',
      overrides: { approvalReviewer: 'agent' as const },
      expected: { approvalReviewer: 'agent' }
    },
    {
      name: 'approval and sandbox',
      overrides: {
        approvalPolicy: 'auto' as const,
        sandboxMode: 'danger-full-access' as const
      },
      expected: {
        approvalPolicy: 'auto',
        sandboxMode: 'danger-full-access'
      }
    }
  ])('sends explicit TUI permission overrides: $name', async ({ overrides, expected }) => {
    const created = detail({ id: `thr_${expected.approvalPolicy ?? 'default'}_${expected.sandboxMode ?? 'default'}` })
    const createThread = vi.fn(async (_request: Parameters<KunTuiClient['createThread']>[0]) => created)
    const client = {
      createThread,
      listThreads: vi.fn(async () => [created]),
      getThread: vi.fn(async () => created),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) =>
          input.signal.addEventListener('abort', () => resolve(), { once: true }))
      })
    } as unknown as KunTuiClient
    const controller = new TuiController(
      client,
      { ...options(), continueLatest: false, ...overrides },
      runtime
    )

    await controller.createThread('Explicit permissions')

    const request = createThread.mock.calls[0]![0]
    expect(request).toMatchObject(expected)
    if (!('approvalPolicy' in expected)) expect(request).not.toHaveProperty('approvalPolicy')
    if (!('sandboxMode' in expected)) expect(request).not.toHaveProperty('sandboxMode')
    if (!('approvalReviewer' in expected)) expect(request).not.toHaveProperty('approvalReviewer')
    await controller.stop()
  })

  it('does not create a fallback session after the last shared provider is disconnected', async () => {
    const createThread = vi.fn()
    const client = {
      createThread
    } as unknown as KunTuiClient
    const tuiRuntime = {
      ...runtime,
      runtimeInfo: { ...runtime.runtimeInfo, model: 'stale-model' }
    } as TuiConnection
    const controller = new TuiController(client, options(), tuiRuntime)
    controller.applyModelSelection({
      schemaVersion: 1,
      proxyRoutingVersion: 1,
      revision: 9,
      providers: [],
      proxy: { enabled: false, url: '' },
      routePools: [],
      localModelGateway: { enabled: false }
    }, false)

    await controller.createThread()

    expect(createThread).not.toHaveBeenCalled()
    expect(tuiRuntime.runtimeInfo.model).toBe('')
    expect(controller.state.busy).toBe(false)
    expect(controller.state.notification?.message).toContain('/connect')
  })

  it('starts on the guided composer and only opens the thread picker on request', async () => {
    const client = {
      listThreads: vi.fn(async () => [detail()])
    } as unknown as KunTuiClient
    const controller = new TuiController(client, { ...options(), continueLatest: false }, runtime)

    await controller.start()
    expect(controller.state.view).toBe('chat')
    expect(controller.state.projection).toBeUndefined()

    controller.showThreads()
    expect(controller.state.view).toBe('threads')
    controller.showChat()
    expect(controller.state.view).toBe('chat')
    expect(controller.state.projection).toBeUndefined()
    await controller.stop()
  })

  it('publishes an immediate sending phase before start-turn acknowledges the request', async () => {
    const source = detail()
    let resolveStart!: (value: { turnId: string }) => void
    const startTurn = vi.fn(() => new Promise<{ turnId: string }>((resolve) => {
      resolveStart = resolve
    }))
    const client = {
      listThreads: vi.fn(async () => [source]),
      getThread: vi.fn(async () => source),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      startTurn
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options(), runtime)

    await controller.start()
    const submission = controller.submit('slow request')

    expect(controller.state).toMatchObject({
      busy: true,
      busyLabel: 'Sending message'
    })
    expect(controller.state.busyStartedAt).toBeTruthy()
    expect(controller.state.projection?.runningTurnId).toBeUndefined()

    resolveStart({ turnId: 'turn_slow' })
    await submission
    expect(controller.state).toMatchObject({
      busy: false,
      projection: {
        runningTurnId: 'turn_slow',
        activity: {
          phase: 'starting',
          label: 'Sending message'
        }
      }
    })
    expect(controller.state.busyLabel).toBeUndefined()
    expect(controller.state.busyStartedAt).toBeUndefined()
    expect(startTurn).toHaveBeenCalledWith(source.id, expect.objectContaining({
      prompt: 'slow request',
      clientSurface: 'tui'
    }))
    await controller.stop()
  })
})
