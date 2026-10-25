import { describe, expect, test, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentOptions,
  Run,
  RunResult,
  SDKAgent,
  SDKMessage
} from '@cursor/sdk'
import type { RuntimeEvent } from '../../contracts/events.js'
import type { TurnItem } from '../../contracts/items.js'
import {
  applyRuntimeEvent,
  createRuntimeEventProjection
} from '../../domain/runtime-event-reducer.js'
import { LlmDebugRecorder } from '../../services/llm-debug-recorder.js'
import {
  CursorSdkRuntime,
  cursorSdkCapabilities,
  cursorAgentExecutionOptions,
  sanitizeCursorSdkError,
  type CursorSdkApi,
  type CursorKunTurnContext,
  type CursorSdkRuntimeDeps
} from './cursor-sdk-runtime.js'
import {
  DelegatedSessionCoordinator,
  FileDelegatedSessionBindingStore,
  delegatedCapabilityFingerprint,
  delegatedCredentialIdentity,
  delegatedHistoryDigest
} from '../delegated-session-binding.js'
import { goalContextKey } from '../../loop/continuation-instructions.js'

function messages(values: SDKMessage[]): AsyncGenerator<SDKMessage, void> {
  return (async function* () {
    for (const value of values) yield value
  })()
}

function fakeRun(input: {
  stream?: SDKMessage[]
  result?: Partial<RunResult>
  cancel?: () => Promise<void>
} = {}): Run {
  const result: RunResult = {
    id: 'run_1',
    status: 'finished',
    result: 'hello',
    ...input.result
  }
  return {
    id: 'run_1',
    agentId: 'agent_1',
    supports: (operation) => operation === 'stream' || operation === 'wait' || operation === 'cancel',
    unsupportedReason: () => undefined,
    stream: () => messages(input.stream ?? [{
      type: 'assistant',
      agent_id: 'agent_1',
      run_id: 'run_1',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }
    }]),
    conversation: async () => [],
    wait: async () => result,
    cancel: input.cancel ?? (async () => undefined),
    status: result.status,
    onDidChangeStatus: () => () => undefined,
    result: result.result,
    error: result.error,
    model: result.model,
    durationMs: result.durationMs,
    usage: result.usage,
    git: result.git,
    createdAt: 1
  }
}

function harness(input: {
  apiKey?: string
  credentialSourceId?: string
  resolveCredentialSource?: CursorSdkRuntimeDeps['resolveCredentialSource']
  run?: Run
  sendResults?: Array<Run | Error>
  thread?: Record<string, unknown>
  items?: Array<Record<string, unknown>>
  attachmentStore?: CursorSdkRuntimeDeps['attachmentStore']
  debugSink?: LlmDebugRecorder
  turnLimits?: { maxWallTimeMs?: number }
  loadError?: Error
  sessionCoordinator?: CursorSdkRuntimeDeps['sessionCoordinator']
  omitLocalStore?: boolean
  kunContext?: CursorKunTurnContext
  onLoadKunTurnContext?: () => void | Promise<void>
  contextProfile?: CursorSdkRuntimeDeps['contextProfile']
  streamLimits?: CursorSdkRuntimeDeps['streamLimits']
  todoSyncError?: Error
  suspendGraphLeadTurn?: (
    input: Record<string, unknown>
  ) => Promise<
    | 'not_graph'
    | 'suspended'
    | 'supervision_pending'
    | 'suspended_pending_supervision'
  >
}) {
  const applied: unknown[] = []
  const updated: unknown[] = []
  const materialized = new Map<string, TurnItem>()
  const recorded: unknown[] = []
  const recordedDeltaSnapshots: Array<{
    event: unknown
    item: TurnItem
  }> = []
  const finished: unknown[] = []
  const createOptions: AgentOptions[] = []
  const sentMessages: unknown[] = []
  const sentOptions: unknown[] = []
  const resumedAgentIds: string[] = []
  const resumedOptions: Array<Partial<AgentOptions> | undefined> = []
  const kunContextSignals: AbortSignal[] = []
  const syncedTodos: unknown[] = []
  const loadItems = vi.fn(async () => input.items ?? [{
    id: 'user_1',
    threadId: 'thread_1',
    turnId: 'turn_1',
    role: 'user',
    status: 'completed',
    createdAt: new Date().toISOString(),
    kind: 'user_message',
    text: 'hi'
  }])
  const sendResults = input.sendResults ?? [input.run ?? fakeRun()]
  let sendIndex = 0
  const reload = vi.fn(async () => undefined)
  const dispose = vi.fn(async () => undefined)
  const agent = {
    agentId: 'agent_1',
    model: { id: 'auto' },
    send: async (message: unknown, options: unknown) => {
      sentMessages.push(message)
      sentOptions.push(options)
      const result = sendResults[Math.min(sendIndex, sendResults.length - 1)]
      sendIndex += 1
      if (result instanceof Error) throw result
      return result
    },
    close: vi.fn(),
    reload,
    getUsage: async () => ({
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 },
      runs: []
    }),
    listArtifacts: async () => [],
    downloadArtifact: async () => Buffer.alloc(0),
    [Symbol.asyncDispose]: dispose
  } as SDKAgent
  const sdk: CursorSdkApi = {
    Agent: {
      create: async (options) => {
        createOptions.push(options)
        return agent
      },
      resume: async (agentId, options) => {
        resumedAgentIds.push(agentId)
        resumedOptions.push(options)
        return agent
      }
    },
    ...(input.sessionCoordinator && !input.omitLocalStore
      ? {
          JsonlLocalAgentStore: class {
            constructor(readonly rootDir: string) {}
          } as never
        }
      : {})
  }
  const thread = {
    id: 'thread_1',
    title: 'Cursor test',
    workspace: '/tmp/cursor-workspace',
    model: 'auto',
    mode: 'agent',
    approvalPolicy: 'auto',
    sandboxMode: 'danger-full-access',
    systemPrompt: '',
    turns: [{ id: 'turn_1', model: 'auto', mode: 'agent' }],
    ...input.thread
  }
  const deps = {
    providerConfigs: {
      'cursor-subscription': {
        kind: 'cursor-sdk',
        apiKey: input.apiKey ?? 'cursor-secret',
        ...(input.credentialSourceId ? { credentialSourceId: input.credentialSourceId } : {})
      }
    },
    providerIds: new Set(['cursor-subscription']),
    defaultIsCursor: false,
    defaultModel: 'auto',
    systemPrompt: 'Kun system prompt',
    threadStore: { get: async () => thread },
    sessionStore: {
      loadItems
    },
    turns: {
      applyItem: async (_threadId: string, item: TurnItem) => {
        applied.push(item)
        materialized.set(item.id, item)
      },
      updateItem: async (_threadId: string, itemId: string, patch: Partial<TurnItem>) => {
        const existing = materialized.get(itemId)
        if (!existing) return null
        const item = { ...existing, ...patch } as TurnItem
        updated.push(item)
        materialized.set(itemId, item)
        return item
      },
      updateTurnMetadata: async (_threadId: string, turnId: string, patch: Record<string, unknown>) => {
        const turn = thread.turns.find((candidate) => candidate.id === turnId)
        if (turn) Object.assign(turn, patch)
      },
      ...(input.suspendGraphLeadTurn
        ? { suspendGraphLeadTurn: input.suspendGraphLeadTurn }
        : {}),
      finishTurn: async (value: unknown) => { finished.push(value) }
    },
    events: {
      record: async (value: unknown) => {
        recorded.push(value)
        const event = value as { kind?: unknown; itemId?: unknown }
        if (
          (event.kind === 'assistant_text_delta' ||
            event.kind === 'assistant_reasoning_delta') &&
          typeof event.itemId === 'string'
        ) {
          const item = materialized.get(event.itemId)
          if (item) recordedDeltaSnapshots.push({ event: value, item: structuredClone(item) })
        }
      }
    },
    ids: { next: (prefix: string) => `${prefix}_1` },
    setThreadTodos: async (threadId: string, request: unknown) => {
      if (input.todoSyncError) throw input.todoSyncError
      syncedTodos.push({ threadId, request })
    },
    loadSdk: async () => {
      if (input.loadError) throw input.loadError
      return sdk
    },
    ...(input.resolveCredentialSource
      ? { resolveCredentialSource: input.resolveCredentialSource }
      : {}),
    debugSink: input.debugSink,
    attachmentStore: input.attachmentStore,
    turnLimits: input.turnLimits,
    sessionCoordinator: input.sessionCoordinator,
    contextProfile: input.contextProfile,
    streamLimits: input.streamLimits,
    ...(input.kunContext
      ? {
          loadKunTurnContext: async ({ signal }: { signal: AbortSignal }) => {
            kunContextSignals.push(signal)
            await input.onLoadKunTurnContext?.()
            return input.kunContext!
          }
        }
      : {})
  } as unknown as CursorSdkRuntimeDeps
  return {
    runtime: new CursorSdkRuntime(deps),
    createOptions,
    applied,
    updated,
    materialized,
    recorded,
    recordedDeltaSnapshots,
    finished,
    sentMessages,
    sentOptions,
    loadItems,
    kunContextSignals,
    resumedAgentIds,
    resumedOptions,
    syncedTodos,
    agent,
    reload,
    dispose
  }
}

describe('CursorSdkRuntime', () => {
  test('fails closed when an SDK downgrade removes the isolated local store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-cursor-store-missing-'))
    const coordinator = new DelegatedSessionCoordinator(
      new FileDelegatedSessionBindingStore(root)
    )
    const h = harness({
      sessionCoordinator: coordinator,
      omitLocalStore: true
    })
    await expect(h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal,
      'cursor-subscription'
    )).resolves.toBe('failed')
    expect(h.createOptions).toEqual([])
    expect(h.recorded).toContainEqual(expect.objectContaining({
      kind: 'delegated_runtime',
      phase: 'portable',
      reason: 'capabilities_changed',
      capabilities: expect.objectContaining({ nativeResume: false })
    }))
  })

  test('uses plan+sandbox with Cursor classifier disabled when Kun owns review', () => {
    const approveForMe = cursorAgentExecutionOptions({
      workspace: '/tmp/work',
      apiKey: 'key',
      model: 'auto',
      name: 'test',
      planMode: false,
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write'
    })
    expect(approveForMe).toMatchObject({
      mode: 'plan',
      local: {
        autoReview: false,
        settingSources: [],
        sandboxOptions: { enabled: true }
      }
    })
    expect(approveForMe.local?.autoReview).toBe(false)
    expect(cursorAgentExecutionOptions({
      workspace: '/tmp/work',
      apiKey: 'key',
      model: 'auto',
      name: 'test',
      planMode: false,
      approvalPolicy: 'auto',
      sandboxMode: 'read-only'
    }).mode).toBe('plan')
  })

  test('uses the restricted turn snapshot after the thread is patched to full access', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-cursor-authority-snapshot-'))
    const coordinator = new DelegatedSessionCoordinator(
      new FileDelegatedSessionBindingStore(root)
    )
    const h = harness({
      sessionCoordinator: coordinator,
      thread: {
        model: 'thread-full-model',
        approvalPolicy: 'auto',
        sandboxMode: 'danger-full-access',
        turns: [{
          id: 'turn_1',
          model: 'turn-restricted-model',
          mode: 'agent',
          approvalPolicy: 'on-request',
          sandboxMode: 'workspace-write',
          actingModelRoute: {
            model: 'turn-restricted-model',
            providerId: 'cursor-subscription',
            accountId: 'turn-account'
          }
        }]
      }
    })

    await expect(h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal,
      'cursor-subscription'
    )).resolves.toBe('completed')

    expect(h.createOptions[0]).toMatchObject({
      model: { id: 'turn-restricted-model' },
      mode: 'plan',
      local: { sandboxOptions: { enabled: true } }
    })
    expect((await coordinator.store.load('thread_1'))?.capabilityFingerprint).toBe(
      delegatedCapabilityFingerprint({
        systemPrompt: 'Kun system prompt',
        threadPersona: '',
        mode: 'plan',
        sandbox: true,
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        settingSources: [],
        capabilities: cursorSdkCapabilities()
      })
    )
  })

  test('keeps a full-access turn full after the thread is patched to restricted', async () => {
    const h = harness({
      thread: {
        model: 'thread-restricted-model',
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        turns: [{
          id: 'turn_1',
          model: 'turn-full-model',
          mode: 'agent',
          approvalPolicy: 'auto',
          sandboxMode: 'danger-full-access',
          actingModelRoute: {
            model: 'turn-full-model',
            providerId: 'cursor-subscription',
            accountId: 'turn-account'
          }
        }]
      }
    })

    await expect(h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal,
      'cursor-subscription'
    )).resolves.toBe('completed')

    expect(h.createOptions[0]).toMatchObject({
      model: { id: 'turn-full-model' },
      mode: 'agent',
      local: { sandboxOptions: { enabled: false } }
    })
  })

  test('forwards authorized image attachments as a structured SDK message without tracing bytes', async () => {
    const debugSink = new LlmDebugRecorder()
    const imageBytes = Buffer.from('sensitive-image-bytes')
    const resolveContent = vi.fn(async () => ({
      id: 'att_0123456789abcdef01234567',
      name: 'diagram.png',
      kind: 'image',
      mimeType: 'image/png',
      byteSize: imageBytes.byteLength,
      hash: 'hash',
      width: 640,
      height: 480,
      threadIds: ['thread_1'],
      workspaces: ['/tmp/cursor-workspace'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      data: imageBytes
    }))
    const h = harness({
      debugSink,
      attachmentStore: { resolveContent } as unknown as CursorSdkRuntimeDeps['attachmentStore'],
      items: [{
        id: 'user_1',
        threadId: 'thread_1',
        turnId: 'turn_1',
        role: 'user',
        status: 'completed',
        createdAt: new Date().toISOString(),
        kind: 'user_message',
        text: 'describe this image',
        attachmentIds: ['att_0123456789abcdef01234567']
      }]
    })

    await expect(h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal,
      'cursor-subscription'
    )).resolves.toBe('completed')

    expect(resolveContent).toHaveBeenCalledWith(
      'att_0123456789abcdef01234567',
      { threadId: 'thread_1', workspace: '/tmp/cursor-workspace' }
    )
    expect(h.sentMessages[0]).toMatchObject({
      text: expect.stringContaining('describe this image'),
      images: [{
        data: imageBytes.toString('base64'),
        mimeType: 'image/png',
        dimension: { width: 640, height: 480 }
      }]
    })
    const traceJson = JSON.stringify(debugSink.snapshot())
    expect(traceJson).not.toContain(imageBytes.toString('base64'))
    expect(traceJson).toContain('"count":1')
    expect(traceJson).toContain('"mimeType":"image/png"')
  })

  test('fails closed without borrowing the default provider credential', async () => {
    const h = harness({ apiKey: '' })
    await expect(h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal,
      'cursor-subscription'
    )).resolves.toBe('failed')
    expect(h.createOptions).toEqual([])
    expect(h.finished).toContainEqual(expect.objectContaining({
      status: 'failed',
      code: 'cursor_sdk_missing_credential'
    }))
  })

  test('re-resolves a managed credential for every turn on the same Runtime', async () => {
    let authoritativeKey = ''
    const resolveCredentialSource = vi.fn(async () =>
      authoritativeKey ? { apiKey: authoritativeKey } : null)
    const h = harness({
      apiKey: 'stale-constructor-key',
      credentialSourceId: 'model-connection:cursor-subscription',
      resolveCredentialSource
    })

    await expect(h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal,
      'cursor-subscription'
    )).resolves.toBe('failed')
    expect(h.createOptions).toEqual([])

    authoritativeKey = 'authoritative-cursor-key'
    await expect(h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal,
      'cursor-subscription'
    )).resolves.toBe('completed')
    expect(h.createOptions).toContainEqual(expect.objectContaining({
      apiKey: 'authoritative-cursor-key'
    }))
    expect(resolveCredentialSource).toHaveBeenCalledTimes(2)
  })

  test('cancels an active SDK run when the Kun turn aborts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-cursor-abort-'))
    const coordinator = new DelegatedSessionCoordinator(
      new FileDelegatedSessionBindingStore(root)
    )
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const cancel = vi.fn(async () => { release() })
    const run = fakeRun({ cancel })
    run.stream = () => (async function* () {
      await blocked
      yield* []
    })()
    const h = harness({ run, sessionCoordinator: coordinator })
    const controller = new AbortController()
    const outcome = h.runtime.runTurn('thread_1', 'turn_1', controller.signal, 'cursor-subscription')
    await vi.waitFor(() => expect(h.createOptions).toHaveLength(1))
    controller.abort()
    await expect(outcome).resolves.toBe('aborted')
    expect(cancel).toHaveBeenCalled()
    expect(h.finished).toContainEqual(expect.objectContaining({ status: 'aborted' }))
    expect(await coordinator.store.load('thread_1')).toBeNull()
  })

  test('cancels and reports a stable failure when wall time expires', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const cancel = vi.fn(async () => { release() })
    const run = fakeRun({ cancel })
    run.stream = () => (async function* () {
      await blocked
      yield* []
    })()
    const h = harness({ run, turnLimits: { maxWallTimeMs: 5 } })

    await expect(h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal,
      'cursor-subscription'
    )).resolves.toBe('failed')
    expect(cancel).toHaveBeenCalled()
    expect(h.finished).toContainEqual(expect.objectContaining({
      status: 'failed',
      code: 'turn_wall_time_limit'
    }))
  })

  test('redacts the configured key from SDK failures', () => {
    expect(sanitizeCursorSdkError(
      new Error('request using cursor-secret failed'),
      'cursor-secret'
    )).toBe('request using [REDACTED] failed')
  })

  test('keeps SDK errors and traces free of the configured key', async () => {
    const debugSink = new LlmDebugRecorder()
    const h = harness({
      debugSink,
      loadError: new Error('Cursor rejected cursor-secret')
    })

    await expect(h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal,
      'cursor-subscription'
    )).resolves.toBe('failed')
    expect(JSON.stringify(h.recorded)).not.toContain('cursor-secret')
    expect(JSON.stringify(h.finished)).not.toContain('cursor-secret')
    expect(JSON.stringify(debugSink.snapshot())).not.toContain('cursor-secret')
    expect(JSON.stringify(h.finished)).toContain('[REDACTED]')
  })
})
