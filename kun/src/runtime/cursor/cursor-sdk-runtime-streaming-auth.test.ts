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
  test('materializes cumulative partial output before a stream failure', async () => {
    const h = harness({
      streamLimits: { maxToolCalls: 1 },
      kunContext: {
        instructionBlocks: [],
        activeSkillIds: [],
        tools: [],
        customTools: {}
      },
      run: fakeRun({
        stream: [{
          type: 'assistant',
          agent_id: 'agent_1',
          run_id: 'run_1',
          message: { role: 'assistant', content: [{ type: 'text', text: 'first part' }] }
        }, {
          type: 'assistant',
          agent_id: 'agent_1',
          run_id: 'run_1',
          message: { role: 'assistant', content: [{ type: 'text', text: ' and second part' }] }
        }, {
          type: 'tool_call',
          agent_id: 'agent_1',
          run_id: 'run_1',
          call_id: 'call_1',
          name: 'shell',
          status: 'running',
          args: { command: 'pwd' }
        }, {
          type: 'tool_call',
          agent_id: 'agent_1',
          run_id: 'run_1',
          call_id: 'call_2',
          name: 'shell',
          status: 'running',
          args: { command: 'ls' }
        }]
      })
    })

    await expect(h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal,
      'cursor-subscription'
    )).resolves.toBe('failed')

    expect(h.applied).toContainEqual(expect.objectContaining({
      kind: 'assistant_text',
      text: 'first part',
      status: 'running'
    }))
    expect(h.updated).toContainEqual(expect.objectContaining({
      kind: 'assistant_text',
      text: 'first part and second part',
      status: 'running'
    }))
    expect([...h.materialized.values()]).toContainEqual(expect.objectContaining({
      kind: 'assistant_text',
      text: 'first part and second part'
    }))
    expect(h.finished).toContainEqual(expect.objectContaining({
      status: 'failed',
      code: 'cursor_sdk_stream_resource_limit'
    }))
    expect(h.kunContextSignals[0]?.aborted).toBe(true)
  })

  test('replays Cursor text and reasoning fragments over cumulative snapshots without duplication', async () => {
    const h = harness({
      run: fakeRun({
        stream: [{
          type: 'thinking',
          agent_id: 'agent_1',
          run_id: 'run_1',
          text: '思😀'
        }, {
          type: 'assistant',
          agent_id: 'agent_1',
          run_id: 'run_1',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'A😀' },
              { type: 'text', text: 'B' }
            ]
          }
        }, {
          type: 'thinking',
          agent_id: 'agent_1',
          run_id: 'run_1',
          text: '考'
        }, {
          type: 'assistant',
          agent_id: 'agent_1',
          run_id: 'run_1',
          message: { role: 'assistant', content: [{ type: 'text', text: '猫' }] }
        }],
        result: { result: 'A😀B猫' }
      })
    })

    await expect(h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal,
      'cursor-subscription'
    )).resolves.toBe('completed')

    const deltas = h.recordedDeltaSnapshots.map(({ event, item }) => {
      const draft = event as {
        kind: string
        deltaOffset?: number
        item: { text?: string }
      }
      return {
        kind: draft.kind,
        offset: draft.deltaOffset,
        fragment: draft.item.text,
        persistedText: 'text' in item ? item.text : undefined
      }
    })
    expect(deltas).toEqual([
      {
        kind: 'assistant_reasoning_delta',
        offset: 0,
        fragment: '思😀',
        persistedText: '思😀'
      },
      {
        kind: 'assistant_text_delta',
        offset: 0,
        fragment: 'A😀',
        persistedText: 'A😀B'
      },
      {
        kind: 'assistant_text_delta',
        offset: 3,
        fragment: 'B',
        persistedText: 'A😀B'
      },
      {
        kind: 'assistant_reasoning_delta',
        offset: 3,
        fragment: '考',
        persistedText: '思😀考'
      },
      {
        kind: 'assistant_text_delta',
        offset: 4,
        fragment: '猫',
        persistedText: 'A😀B猫'
      }
    ])

    const latestSnapshots = new Map<string, TurnItem>()
    for (const snapshot of h.recordedDeltaSnapshots) {
      latestSnapshots.set(snapshot.item.id, snapshot.item)
    }
    let replayed = {
      ...createRuntimeEventProjection('thread_1'),
      items: [...latestSnapshots.values()]
    }
    for (const [index, snapshot] of h.recordedDeltaSnapshots.entries()) {
      replayed = applyRuntimeEvent(replayed, {
        ...(snapshot.event as RuntimeEvent),
        seq: index + 1,
        timestamp: `2026-08-05T00:00:0${index}.000Z`
      })
    }
    expect(replayed.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'assistant_text', text: 'A😀B猫' }),
      expect.objectContaining({ kind: 'assistant_reasoning', text: '思😀考' })
    ]))
  })

  test('collapses cumulative Cursor assistant snapshots to a single final reply', async () => {
    const answer = '可视化辅助选项'
    const h = harness({
      run: fakeRun({
        stream: [{
          type: 'assistant',
          agent_id: 'agent_1',
          run_id: 'run_1',
          message: { role: 'assistant', content: [{ type: 'text', text: answer }] }
        }, {
          type: 'assistant',
          agent_id: 'agent_1',
          run_id: 'run_1',
          message: { role: 'assistant', content: [{ type: 'text', text: answer }] }
        }, {
          type: 'assistant',
          agent_id: 'agent_1',
          run_id: 'run_1',
          message: { role: 'assistant', content: [{ type: 'text', text: `${answer}：完成` }] }
        }],
        result: { result: `${answer}：完成` }
      })
    })

    await expect(h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal,
      'cursor-subscription'
    )).resolves.toBe('completed')

    const textDeltas = h.recordedDeltaSnapshots
      .map(({ event }) => event as { kind?: string; item?: { text?: string }; deltaOffset?: number })
      .filter((event) => event.kind === 'assistant_text_delta')
    expect(textDeltas).toEqual([
      expect.objectContaining({ deltaOffset: 0, item: expect.objectContaining({ text: answer }) }),
      expect.objectContaining({
        deltaOffset: answer.length,
        item: expect.objectContaining({ text: '：完成' })
      })
    ])

    const latest = [...h.recordedDeltaSnapshots].reverse().find((snapshot) =>
      'text' in snapshot.item && snapshot.item.kind === 'assistant_text'
    )
    expect(latest?.item).toEqual(expect.objectContaining({ text: `${answer}：完成` }))
  })

  test('rebuilds the SDK session once and continues an accepted run after authentication expires', async () => {
    const h = harness({
      sendResults: [
        fakeRun({
          stream: [{
            type: 'tool_call',
            agent_id: 'agent_1',
            run_id: 'run_1',
            call_id: 'call_1',
            name: 'shell',
            status: 'running',
            args: { command: 'pwd' }
          }, {
            type: 'tool_call',
            agent_id: 'agent_1',
            run_id: 'run_1',
            call_id: 'call_1',
            name: 'shell',
            status: 'completed',
            result: { stdout: '/tmp' }
          }, {
            type: 'assistant',
            agent_id: 'agent_1',
            run_id: 'run_1',
            message: { role: 'assistant', content: [{ type: 'text', text: 'partial result' }] }
          }],
          result: {
            status: 'error',
            error: {
              code: 'unauthenticated',
              message: 'Authentication error If you are logged in, try logging out and back in.'
            }
          }
        }),
        fakeRun({
          stream: [{
            type: 'assistant',
            agent_id: 'agent_1',
            run_id: 'run_2',
            message: { role: 'assistant', content: [{ type: 'text', text: ' completed' }] }
          }],
          result: { id: 'run_2', result: ' completed' }
        })
      ]
    })

    await expect(h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal,
      'cursor-subscription'
    )).resolves.toBe('completed')

    expect(h.dispose).toHaveBeenCalledOnce()
    expect(h.resumedAgentIds).toEqual(['agent_1'])
    expect(h.createOptions[0]?.local?.enableAgentRetries).toBe(true)
    expect(h.sentMessages).toHaveLength(2)
    expect(String(h.sentMessages[1])).toContain('Continue the interrupted request')
    expect(String(h.sentMessages[1])).toContain('Do not repeat tool calls')
    expect(h.sentOptions[1]).toMatchObject({ local: { force: true } })
    expect(h.recorded).toContainEqual(expect.objectContaining({
      kind: 'pipeline_stage',
      stage: 'pre_send',
      details: expect.objectContaining({
        reason: 'cursor_sdk_authentication_failed',
        attempt: 2,
        maxAttempts: 2,
        requestAccepted: true
      })
    }))
    expect(h.recorded).not.toContainEqual(expect.objectContaining({
      kind: 'error',
      code: 'cursor_sdk_authentication_failed'
    }))
    expect(h.recorded.filter((event) => (
      event as { kind?: unknown }
    ).kind === 'assistant_text_delta')).toEqual([
      expect.objectContaining({ deltaOffset: 0 }),
      expect.objectContaining({ deltaOffset: 'partial result'.length })
    ])
    expect(h.finished).toContainEqual(expect.objectContaining({ status: 'completed' }))
  })

  test('resends the original request when authentication fails before the SDK accepts it', async () => {
    const authenticationError = new Error('authentication transport expired')
    authenticationError.name = 'unauthenticated'
    const h = harness({
      sendResults: [authenticationError, fakeRun()]
    })

    await expect(h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal,
      'cursor-subscription'
    )).resolves.toBe('completed')

    expect(h.dispose).toHaveBeenCalledOnce()
    expect(h.resumedAgentIds).toEqual(['agent_1'])
    expect(h.sentMessages).toHaveLength(2)
    expect(h.sentMessages[1]).toEqual(h.sentMessages[0])
    expect(h.sentOptions[1]).toMatchObject({ local: { force: true } })
    expect(h.recorded).toContainEqual(expect.objectContaining({
      kind: 'pipeline_stage',
      details: expect.objectContaining({ requestAccepted: false })
    }))
  })

  test('reports a service-side authentication failure only after the automatic retry also fails', async () => {
    const authenticationFailure = () => fakeRun({
      stream: [],
      result: {
        status: 'error',
        error: {
          code: 'unauthenticated',
          message: 'Authentication error If you are logged in, try logging out and back in.'
        }
      }
    })
    const h = harness({
      sendResults: [authenticationFailure(), authenticationFailure()]
    })

    await expect(h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal,
      'cursor-subscription'
    )).resolves.toBe('failed')

    expect(h.dispose).toHaveBeenCalledOnce()
    expect(h.resumedAgentIds).toEqual(['agent_1'])
    expect(h.sentMessages).toHaveLength(2)
    expect(h.finished).toContainEqual(expect.objectContaining({
      status: 'failed',
      code: 'cursor_sdk_authentication_failed',
      error: expect.stringContaining('automatically rebuilt the SDK session')
    }))
    expect(h.finished).toContainEqual(expect.objectContaining({
      error: expect.stringContaining('Cursor SDK/service authentication failure')
    }))
    expect(JSON.stringify(h.finished)).not.toContain('logging out')
  })


})
