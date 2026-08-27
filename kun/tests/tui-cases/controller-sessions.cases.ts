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
    revision: 9,
    providers: [{
      id: 'legacy-provider',
      accountId: 'account:legacy-provider',
      name: 'Legacy Provider',
      kind: 'http',
      authType: 'api-key',
      endpointFormat: 'chat_completions',
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

describe("TuiController reasoning and session lifecycle", () => {
  it('cycles supported reasoning efforts and sends the selected effort with the turn', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-tui-effort-'))
    const source = detail({ providerId: 'provider-a', accountId: 'account-a', model: 'reasoning-model' })
    const startTurn = vi.fn(async () => ({ turnId: 'turn_reasoning' }))
    const client = {
      listThreads: vi.fn(async () => [source]),
      getThread: vi.fn(async () => source),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      startTurn
    } as unknown as KunTuiClient
    const controller = new TuiController(client, { ...options(), dataDir }, runtime)
    try {
      await controller.start()
      controller.applyModelSelection({
        schemaVersion: 1,
        revision: 1,
        defaultProviderId: 'provider-a',
        defaultAccountId: 'account-a',
        defaultModel: 'reasoning-model',
        proxy: { enabled: false, url: '' },
        routePools: [],
        localModelGateway: { enabled: false },
        providers: [{
          id: 'provider-a', accountId: 'account-a', name: 'Provider A', kind: 'http',
          authType: 'api-key', endpointFormat: 'chat_completions', configured: true,
          models: ['reasoning-model'], selectedModel: 'reasoning-model',
          modelCapabilities: {
            'reasoning-model': {
              id: 'reasoning-model', inputModalities: ['text'], outputModalities: ['text'],
              supportsToolCalling: true, messageParts: ['text'],
              reasoning: {
                supportedEfforts: ['off', 'low', 'high'], defaultEffort: 'low',
                requestProtocol: 'deepseek-chat-completions'
              }
            }
          }
        }]
      }, false)

      expect(controller.state.reasoningEffort).toBe('low')
      expect(controller.cycleReasoningEffort()).toBe(true)
      expect(controller.state.reasoningEffort).toBe('high')
      await controller.submit('stream this answer')
      expect(startTurn).toHaveBeenCalledWith(source.id, expect.objectContaining({
        model: 'reasoning-model', providerId: 'provider-a', accountId: 'account-a',
        reasoningEffort: 'high', prompt: 'stream this answer'
      }))
    } finally {
      await controller.stop()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('cycles audited GLM variants from a legacy catalog without capability metadata', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-tui-legacy-glm-effort-'))
    const source = detail({
      providerId: 'opencode-go',
      accountId: 'account:opencode-go',
      model: 'glm-5.2'
    })
    const startTurn = vi.fn(async () => ({ turnId: 'turn_glm_reasoning' }))
    const client = {
      listThreads: vi.fn(async () => [source]),
      getThread: vi.fn(async () => source),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      startTurn
    } as unknown as KunTuiClient
    const controller = new TuiController(client, {
      ...options(),
      dataDir,
      providerId: 'opencode-go',
      accountId: 'account:opencode-go',
      model: 'glm-5.2'
    }, { ...runtime, legacyGui: true })
    try {
      await controller.start()
      controller.applyModelSelection({
        schemaVersion: 1,
        revision: 0,
        defaultProviderId: 'opencode-go',
        defaultAccountId: 'account:opencode-go',
        defaultModel: 'glm-5.2',
        proxy: { enabled: false, url: '' },
        routePools: [],
        localModelGateway: { enabled: false },
        providers: [{
          id: 'opencode-go',
          accountId: 'account:opencode-go',
          name: 'OpenCode Go',
          kind: 'http',
          authType: 'subscription',
          endpointFormat: 'chat_completions',
          configured: true,
          models: ['glm-5.2'],
          selectedModel: 'glm-5.2',
          modelCapabilities: {
            'glm-5.2': {
              id: 'glm-5.2',
              inputModalities: ['text'],
              outputModalities: ['text'],
              supportsToolCalling: true,
              messageParts: ['text'],
              reasoning: {
                supportedEfforts: ['auto'],
                defaultEffort: 'auto',
                requestProtocol: 'none'
              }
            }
          }
        }]
      }, false)

      expect(controller.reasoningOptions()).toEqual(['off', 'high', 'max'])
      expect(controller.state.reasoningEffort).toBe('max')
      expect(controller.cycleReasoningEffort()).toBe(true)
      expect(controller.state.reasoningEffort).toBe('off')
      await controller.submit('use the selected effort')
      expect(startTurn).toHaveBeenCalledWith(source.id, expect.objectContaining({
        providerId: 'opencode-go',
        accountId: 'account:opencode-go',
        model: 'glm-5.2',
        reasoningEffort: 'off'
      }))
    } finally {
      await controller.stop()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('cycles audited Codex variants from a legacy catalog without capability metadata', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-tui-legacy-codex-effort-'))
    const source = detail({
      providerId: 'codex',
      accountId: 'account:codex',
      model: 'gpt-5.6-luna'
    })
    const startTurn = vi.fn(async () => ({ turnId: 'turn_codex_reasoning' }))
    const client = {
      listThreads: vi.fn(async () => [source]),
      getThread: vi.fn(async () => source),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      startTurn
    } as unknown as KunTuiClient
    const controller = new TuiController(client, {
      ...options(),
      dataDir,
      providerId: 'codex',
      accountId: 'account:codex',
      model: 'gpt-5.6-luna'
    }, { ...runtime, legacyGui: true })
    try {
      await controller.start()
      controller.applyModelSelection({
        schemaVersion: 1,
        revision: 0,
        defaultProviderId: 'codex',
        defaultAccountId: 'account:codex',
        defaultModel: 'gpt-5.6-luna',
        proxy: { enabled: false, url: '' },
        routePools: [],
        localModelGateway: { enabled: false },
        providers: [{
          id: 'codex',
          accountId: 'account:codex',
          name: 'ChatGPT subscription',
          kind: 'http',
          authType: 'subscription',
          endpointFormat: 'custom_endpoint',
          configured: true,
          models: ['gpt-5.6-luna'],
          selectedModel: 'gpt-5.6-luna'
        }]
      }, false)

      expect(controller.reasoningOptions()).toEqual(['low', 'medium', 'high', 'max'])
      expect(controller.state.reasoningEffort).toBe('high')
      expect(controller.cycleReasoningEffort()).toBe(true)
      expect(controller.state.reasoningEffort).toBe('max')
      await controller.submit('use the selected Codex effort')
      expect(startTurn).toHaveBeenCalledWith(source.id, expect.objectContaining({
        providerId: 'codex',
        accountId: 'account:codex',
        model: 'gpt-5.6-luna',
        reasoningEffort: 'max'
      }))
    } finally {
      await controller.stop()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('opens the latest thread, projects external events, and steers a GUI-started turn', async () => {
    let onEvent: ((event: RuntimeEvent) => void) | undefined
    const steerTurn = vi.fn(async () => ({ ok: true }))
    const client = {
      listThreads: vi.fn(async () => [detail()]),
      getThread: vi.fn(async () => detail()),
      subscribeThreadEvents: vi.fn(async (input: {
        signal: AbortSignal
        onEvent: (event: RuntimeEvent) => void
      }) => {
        onEvent = input.onEvent
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      steerTurn,
      startTurn: vi.fn()
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options(), runtime)
    await controller.start()
    expect(controller.state).toMatchObject({ view: 'chat', projection: { thread: { id: 'thr_1' } } })

    onEvent?.({
      kind: 'turn_started',
      seq: 1,
      timestamp: '2026-07-22T00:00:00.000Z',
      threadId: 'thr_1',
      turnId: 'turn_gui',
      status: 'running'
    })
    await controller.submit('focus on tests')
    expect(steerTurn).toHaveBeenCalledWith('thr_1', 'turn_gui', 'focus on tests')
    await controller.stop()
  })

  it('returns to the welcome screen when another client deletes the active session', async () => {
    let onError: ((error: Error) => void) | undefined
    let threads = [detail()]
    const client = {
      listThreads: vi.fn(async () => threads),
      getThread: vi.fn(async () => detail()),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal; onError?: (error: Error) => void }) => {
        onError = input.onError
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      })
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options(), runtime)
    await controller.start()
    threads = []
    onError?.(new TuiClientError('gone', 410, 'gone'))
    await vi.waitFor(() => expect(controller.state.threads).toEqual([]))
    expect(controller.state.projection).toBeUndefined()
    expect(controller.state.notification?.message).toMatch(/removed by another client/i)
    await controller.stop()
  })

  it('refreshes authoritative state when another client wins an approval race', async () => {
    let onEvent: ((event: RuntimeEvent) => void) | undefined
    let detailCalls = 0
    const decideApproval = vi.fn(async () => {
      throw new TuiClientError('already resolved', 409, 'conflict')
    })
    const client = {
      listThreads: vi.fn(async () => [detail()]),
      getThread: vi.fn(async () => {
        detailCalls += 1
        return detail()
      }),
      subscribeThreadEvents: vi.fn(async (input: {
        signal: AbortSignal
        onEvent: (event: RuntimeEvent) => void
      }) => {
        onEvent = input.onEvent
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      decideApproval
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options(), runtime)
    await controller.start()
    onEvent?.({
      kind: 'approval_requested',
      seq: 1,
      timestamp: '2026-07-22T00:00:00.000Z',
      threadId: 'thr_1',
      turnId: 'turn_1',
      approvalId: 'appr_1',
      toolName: 'bash',
      status: 'pending',
      summary: 'Run tests'
    })
    expect(controller.state.projection?.pendingApproval?.approvalId).toBe('appr_1')

    await controller.decideApproval('allow')
    expect(detailCalls).toBeGreaterThanOrEqual(2)
    expect(controller.state.projection?.pendingApproval).toBeUndefined()
    await controller.stop()
  })

  it('creates a source-preserving undo fork before the latest user turn', async () => {
    const source = detail()
    source.turns = [{
      id: 'turn_first', threadId: source.id, status: 'completed', orchestration: 'direct', prompt: 'first', steering: [],
      createdAt: source.createdAt, attachmentIds: [], activeSkillIds: [],
      injectedMemoryIds: [], injectedMemorySummaries: [], injectedInstructionSources: [],
      items: [{
        id: 'item_user', turnId: 'turn_first', threadId: source.id, role: 'user',
        createdAt: source.createdAt, kind: 'user_message', status: 'completed', text: 'first'
      }]
    }]
    const branch = detail({ id: 'thr_undo', title: 'Shared undo', turns: [] })
    const forkThread = vi.fn(async () => branch)
    const client = {
      listThreads: vi.fn(async () => [source, branch]),
      getThread: vi.fn(async (id: string) => id === branch.id ? branch : source),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      forkThread
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options(), runtime)
    await controller.start()
    await controller.undoLastTurn()

    expect(forkThread).toHaveBeenCalledWith('thr_1', {
      relation: 'fork', turnId: 'turn_first', beforeTurn: true, title: 'Shared undo'
    })
    expect(controller.state.projection?.thread.id).toBe('thr_undo')
    await controller.stop()
  })

  it('marks generated TUI titles as provisional but locks explicit titles', async () => {
    let threads: ThreadDetail[] = []
    const createThread = vi.fn(async (input: Parameters<KunTuiClient['createThread']>[0]) => {
      const created = detail({
        id: `thr_${threads.length + 1}`,
        title: input.title ?? 'Terminal chat',
        titleAuto: input.titleAuto
      })
      threads = [...threads, created]
      return created
    })
    const startTurn = vi.fn(async () => ({ turnId: 'turn_1' }))
    const client = {
      listThreads: vi.fn(async () => threads),
      getThread: vi.fn(async (id: string) => threads.find((thread) => thread.id === id)!),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      createThread,
      startTurn
    } as unknown as KunTuiClient
    const controller = new TuiController(client, { ...options(), continueLatest: false }, runtime)
    await controller.start()

    await controller.createThread()
    expect(createThread).toHaveBeenLastCalledWith(expect.objectContaining({
      title: 'Terminal chat', titleAuto: true
    }))

    await controller.createThread('Fixed TUI title')
    expect(createThread).toHaveBeenLastCalledWith(expect.objectContaining({
      title: 'Fixed TUI title', titleAuto: false
    }))

    const newController = new TuiController(client, { ...options(), continueLatest: false }, runtime)
    await newController.submit('Summarize this new conversation')
    expect(createThread).toHaveBeenLastCalledWith(expect.objectContaining({
      title: 'Summarize this new conversation', titleAuto: true
    }))

    await Promise.all([controller.stop(), newController.stop()])
  })

  it('opens a newly created session before refreshing the session list', async () => {
    const created = detail({ id: 'thr_new', title: 'New session' })
    const calls: string[] = []
    const client = {
      listThreads: vi.fn(async () => {
        calls.push('list')
        return [created]
      }),
      createThread: vi.fn(async () => {
        calls.push('create')
        return created
      }),
      getThread: vi.fn(async () => {
        calls.push('get')
        return created
      }),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        calls.push('subscribe')
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      })
    } as unknown as KunTuiClient
    const controller = new TuiController(client, { ...options(), continueLatest: false }, runtime)
    await controller.start()
    calls.length = 0

    await controller.createThread('New session')

    expect(calls).toEqual(['create', 'get', 'subscribe', 'list'])
    expect(controller.state.projection?.thread.id).toBe(created.id)
    await controller.stop()
  })

  it('executes session lifecycle mutations through authoritative runtime routes', async () => {
    let threads = [detail()]
    const compactThread = vi.fn(async () => ({ ok: true }))
    const updateThread = vi.fn(async (id: string, patch: Partial<ThreadDetail>) => {
      const index = threads.findIndex((thread) => thread.id === id)
      const updated = { ...threads[index]!, ...patch, updatedAt: '2026-07-22T00:01:00.000Z' }
      threads[index] = updated
      return updated
    })
    const forkThread = vi.fn(async (id: string, input: { title?: string; relation: 'fork'; turnId?: string }) => {
      const source = threads.find((thread) => thread.id === id)!
      const branch = detail({
        id: 'thr_branch',
        title: input.title ?? `${source.title} fork`,
        parentThreadId: source.id,
        relation: 'fork',
        createdAt: '2026-07-22T00:02:00.000Z',
        updatedAt: '2026-07-22T00:02:00.000Z'
      })
      threads.push(branch)
      return branch
    })
    const deleteThread = vi.fn(async (id: string) => {
      threads = threads.filter((thread) => thread.id !== id)
      return { deleted: true }
    })
    const client = {
      listThreads: vi.fn(async () => threads.filter((thread) => thread.status !== 'archived')),
      getThread: vi.fn(async (id: string) => threads.find((thread) => thread.id === id)!),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      compactThread,
      updateThread,
      forkThread,
      deleteThread
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options(), runtime)
    await controller.start()

    await controller.toggleSelectedThreadPin()
    expect(updateThread).toHaveBeenCalledWith('thr_1', { pinned: true })

    await controller.compact()
    expect(compactThread).toHaveBeenCalledWith('thr_1')
    expect(controller.state.projection?.thread.id).toBe('thr_1')

    await controller.rename('Renamed session')
    expect(updateThread).toHaveBeenCalledWith('thr_1', { title: 'Renamed session', titleAuto: false })
    expect(controller.state.projection?.thread.title).toBe('Renamed session')

    await controller.forkAtTurn('turn_anchor', 'Review branch')
    expect(forkThread).toHaveBeenCalledWith('thr_1', {
      relation: 'fork', turnId: 'turn_anchor', title: 'Review branch'
    })
    expect(controller.state.projection?.thread.id).toBe('thr_branch')

    await controller.openThread('thr_1')
    await controller.redoBranch()
    expect(controller.state.projection?.thread.id).toBe('thr_branch')

    await controller.archive()
    expect(updateThread).toHaveBeenCalledWith('thr_branch', { status: 'archived' })
    expect(controller.state).toMatchObject({ view: 'threads', projection: undefined })
    expect(controller.state.threads.map((thread) => thread.id)).toEqual(['thr_1'])

    await controller.deleteSelectedThread()
    expect(deleteThread).toHaveBeenCalledWith('thr_1')
    expect(controller.state.threads).toEqual([])
    await controller.stop()
  })
})
