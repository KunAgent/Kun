import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  AgentSdkCredentialUnavailableError,
  AgentSdkRuntime,
  decideSdkBuiltinSandbox,
  type SdkRuntimeDeps,
  type SdkTurnContext
} from './agent-sdk-runtime.js'
import type { SdkApi, SdkCanUseTool, SdkMessage, SdkQueryResult } from './sdk-protocol.js'
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'
import { LlmDebugRecorder } from '../../services/llm-debug-recorder.js'
import type { TurnItem } from '../../contracts/items.js'

function fakeSdk(messages: SdkMessage[], onQuery?: (opts: unknown) => void): SdkApi {
  const query = (input: { options?: unknown }): SdkQueryResult => {
    onQuery?.(input.options)
    async function* gen(): AsyncGenerator<SdkMessage> {
      for (const m of messages) yield m
    }
    const it = gen() as SdkQueryResult
    it.interrupt = async () => {}
    return it
  }
  return {
    query,
    createSdkMcpServer: (config) => ({ type: 'sdk', name: config.name, instance: {} }),
    tool: (name) => ({ name })
  }
}

function fakeSdkAttempts(
  attempts: readonly SdkMessage[][],
  onQuery?: (input: { prompt: unknown; options?: unknown }, attempt: number) => void
): SdkApi {
  let attempt = 0
  return {
    query: (input): SdkQueryResult => {
      const current = attempt
      attempt += 1
      onQuery?.(input as { prompt: unknown; options?: unknown }, current)
      async function* gen(): AsyncGenerator<SdkMessage> {
        for (const message of attempts[current] ?? attempts.at(-1) ?? []) yield message
      }
      const stream = gen() as SdkQueryResult
      stream.interrupt = async () => {}
      return stream
    },
    createSdkMcpServer: (config) => ({ type: 'sdk', name: config.name, instance: {} }),
    tool: (name) => ({ name })
  }
}

type GraphPlanSdkAttempt = {
  arguments?: Record<string, unknown>
  text: string
  sessionId?: string
}

function fakeGraphPlanSdkAttempts(
  attempts: readonly GraphPlanSdkAttempt[],
  onQuery?: (input: { prompt: unknown; options?: unknown }, attempt: number) => void
): SdkApi {
  let attempt = 0
  let graphDefinePlanHandler:
    | ((args: Record<string, unknown>, extra: unknown) => Promise<unknown>)
    | undefined
  return {
    tool: (name, _description, _schema, handler) => {
      if (name === 'graph_define_plan') graphDefinePlanHandler = handler
      return { name }
    },
    createSdkMcpServer: (config) => ({
      type: 'sdk',
      name: config.name,
      instance: {}
    }),
    query: (input): SdkQueryResult => {
      const current = attempt
      attempt += 1
      onQuery?.(input as { prompt: unknown; options?: unknown }, current)
      async function* gen(): AsyncGenerator<SdkMessage> {
        const currentAttempt = attempts[current] ?? attempts.at(-1)
        if (!currentAttempt) return
        if (currentAttempt.arguments) {
          if (!graphDefinePlanHandler) {
            throw new Error('graph_define_plan handler was not registered')
          }
          await graphDefinePlanHandler(currentAttempt.arguments, {})
        }
        if (currentAttempt.sessionId) {
          yield {
            type: 'system',
            subtype: 'init',
            session_id: currentAttempt.sessionId
          } as SdkMessage
        }
        yield* svgSdkTextAttempt(currentAttempt.text)
      }
      const stream = gen() as SdkQueryResult
      stream.interrupt = async () => {}
      return stream
    }
  }
}

function stalledSdk(onStarted: () => void, onInterrupt: () => void): SdkApi {
  return {
    query: (): SdkQueryResult => {
      onStarted()
      const stream = {
        next: () => new Promise<IteratorResult<SdkMessage>>(() => {}),
        [Symbol.asyncIterator]: () => stream,
        interrupt: async () => { onInterrupt() }
      } as SdkQueryResult
      return stream
    },
    createSdkMcpServer: (config) => ({ type: 'sdk', name: config.name, instance: {} }),
    tool: () => ({})
  }
}

type SvgSdkToolResult = {
  name: 'design_svg_edit' | 'design_svg_animate' | 'design_svg_validate'
  id: string
  output: unknown
  isError?: boolean
}

function svgSdkAttempt(results: readonly SvgSdkToolResult[], finalText = 'done'): SdkMessage[] {
  return [
    {
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: results.map((entry) => ({
          type: 'tool_use' as const,
          id: entry.id,
          name: `mcp__kun__${entry.name}`,
          input: {}
        }))
      }
    } as SdkMessage,
    {
      type: 'user',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: results.map((entry) => ({
          type: 'tool_result' as const,
          tool_use_id: entry.id,
          content: JSON.stringify(entry.output),
          ...(entry.isError ? { is_error: true } : {})
        }))
      }
    } as SdkMessage,
    {
      type: 'result', subtype: 'success', is_error: false, result: finalText,
      num_turns: 1, usage: { input_tokens: 1, output_tokens: 1 }
    } as SdkMessage
  ]
}

function svgSdkTextAttempt(text = 'done'): SdkMessage[] {
  return [
    {
      type: 'assistant', parent_tool_use_id: null,
      message: { role: 'assistant', content: [{ type: 'text', text }] }
    } as SdkMessage,
    {
      type: 'result', subtype: 'success', is_error: false, result: text,
      num_turns: 1, usage: { input_tokens: 1, output_tokens: 1 }
    } as SdkMessage
  ]
}

function svgSdkContext(): SdkTurnContext {
  return {
    workspace: '/ws',
    userText: 'make the reserved svg',
    approvalPolicy: 'auto',
    sandboxMode: 'workspace-write',
    allowSdkBuiltins: false,
    requireSvgCompletion: true,
    bridgeableTools: [
      { name: 'design_svg_edit', description: 'edit', inputSchema: {} },
      { name: 'design_svg_animate', description: 'animate', inputSchema: {} },
      { name: 'design_svg_validate', description: 'validate', inputSchema: {} }
    ]
  }
}

function makeDeps(overrides: Partial<SdkRuntimeDeps> = {}): {
  deps: SdkRuntimeDeps
  events: RuntimeEventDraft[]
  items: TurnItem[]
  finished: Array<{ status: string; error?: string; code?: string }>
  sessions: string[]
} {
  const events: RuntimeEventDraft[] = []
  const items: TurnItem[] = []
  const finished: Array<{ status: string; error?: string; code?: string }> = []
  const sessions: string[] = []
  let n = 0
  const ctx: SdkTurnContext = {
    workspace: '/ws',
    userText: 'hello',
    approvalPolicy: 'auto',
    bridgeableTools: [{ name: 'generate_image', description: 'gen', inputSchema: {} }]
  }
  const deps: SdkRuntimeDeps = {
    handlesProvider: (id) => id === 'claude-sub',
    loadTurnContext: async () => ctx,
    executeKunTool: async () => ({ output: 'tool-ok' }),
    decideToolApproval: async () => ({ allow: true }),
    recordEvent: async (d) => {
      events.push(d)
    },
    applyItem: async (_t, item) => {
      items.push(item)
    },
    applyAssistantDelta: async (threadId, item, deltaText, deltaOffset) => {
      if (item.kind === 'assistant_text') {
        events.push({
          kind: 'assistant_text_delta',
          threadId,
          turnId: item.turnId,
          itemId: item.id,
          deltaOffset,
          item: { ...item, text: deltaText }
        })
        return
      }
      if (item.kind === 'assistant_reasoning') {
        events.push({
          kind: 'assistant_reasoning_delta',
          threadId,
          turnId: item.turnId,
          itemId: item.id,
          deltaOffset,
          item: { ...item, text: deltaText }
        })
        return
      }
      throw new TypeError(`unexpected assistant delta item: ${item.kind}`)
    },
    finishTurn: async (_t, _u, status, error, code) => {
      finished.push({ status, error, code })
    },
    saveSessionId: async (_t, _turnId, id) => {
      sessions.push(id)
    },
    loadSdk: async () => fakeSdk([]),
    baseEnv: () => ({ PATH: '/bin', ANTHROPIC_API_KEY: 'leak' }),
    kunSystemPrompt: () => 'You are kun.',
    nextId: (p) => `${p}_${++n}`,
    ...overrides
  }
  return { deps, events, items, finished, sessions }
}

const STREAM: SdkMessage[] = [
  { type: 'system', subtype: 'init', session_id: 'sess_42' } as SdkMessage,
  {
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } }
  } as SdkMessage,
  {
    type: 'assistant',
    parent_tool_use_id: null,
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Hi there' },
        { type: 'tool_use', id: 'toolu_1', name: 'mcp__kun__generate_image', input: { prompt: 'cat' } }
      ]
    }
  } as SdkMessage,
  {
    type: 'user',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'done' }]
    }
  } as SdkMessage,
  {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'all done',
    num_turns: 1,
    usage: { input_tokens: 10, output_tokens: 5 }
  } as SdkMessage
]

describe('AgentSdkRuntime.runTurn', () => {
  const cleanup: string[] = []

  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
  })

  test('fails a fenced managed credential explicitly before loading the SDK', async () => {
    const loadSdk = vi.fn(async () => fakeSdk(STREAM))
    const { deps, events, finished } = makeDeps({
      loadTurnContext: async () => { throw new AgentSdkCredentialUnavailableError() },
      loadSdk
    })

    await expect(new AgentSdkRuntime(deps).runTurn(
      'th',
      'tn',
      new AbortController().signal
    )).resolves.toBe('failed')
    expect(loadSdk).not.toHaveBeenCalled()
    expect(finished).toContainEqual(expect.objectContaining({
      status: 'failed',
      code: 'agent_sdk_credential_unavailable',
      error: expect.stringContaining('credentials are unavailable')
    }))
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'error',
      code: 'agent_sdk_credential_unavailable'
    }))
  })

  test('an already-aborted signal yields an aborted turn', async () => {
    const ac = new AbortController()
    ac.abort()
    const loadSdk = vi.fn(async () => fakeSdk(STREAM))
    const { deps, finished } = makeDeps({ loadSdk })
    const status = await new AgentSdkRuntime(deps).runTurn('th', 'tn', ac.signal)
    expect(status).toBe('aborted')
    expect(finished[0].status).toBe('aborted')
    expect(loadSdk).not.toHaveBeenCalled()
  })

  test('fails an SDK turn that exceeds the runtime wall-time limit', async () => {
    let interrupted = false
    const { deps, events, finished } = makeDeps({
      getTurnLimits: () => ({ maxWallTimeMs: 1 }),
      loadSdk: async () => ({
        query: ({ options }) => {
          const abortController = (options as { abortController: AbortController }).abortController
          async function* gen(): AsyncGenerator<SdkMessage> {
            await new Promise<void>((resolve) => {
              abortController.signal.addEventListener('abort', () => resolve(), { once: true })
            })
            for (const message of [] as SdkMessage[]) yield message
          }
          const stream = gen() as SdkQueryResult
          stream.interrupt = async () => { interrupted = true }
          return stream
        },
        createSdkMcpServer: (config) => ({ type: 'sdk', name: config.name, instance: {} }),
        tool: () => ({})
      })
    })

    const status = await new AgentSdkRuntime(deps).runTurn('th', 'tn', new AbortController().signal)

    expect(status).toBe('failed')
    expect(interrupted).toBe(true)
    expect(finished).toContainEqual(expect.objectContaining({
      status: 'failed', error: expect.stringContaining('wall time')
    }))
    expect(events).toContainEqual(expect.objectContaining({ kind: 'error', code: 'turn_wall_time_limit' }))
  })

  test('wall-time interrupts a stalled iterator that ignores the abort controller', async () => {
    let interrupts = 0
    const { deps, events } = makeDeps({
      getTurnLimits: () => ({ maxWallTimeMs: 5 }),
      loadSdk: async () => stalledSdk(() => undefined, () => { interrupts += 1 })
    })

    await expect(new AgentSdkRuntime(deps).runTurn(
      'th', 'tn', new AbortController().signal
    )).resolves.toBe('failed')
    expect(interrupts).toBe(1)
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'error', code: 'turn_wall_time_limit'
    }))
  })

  test('user cancellation interrupts a stalled iterator and returns aborted', async () => {
    let started!: () => void
    const didStart = new Promise<void>((resolve) => { started = resolve })
    let interrupts = 0
    const controller = new AbortController()
    const { deps } = makeDeps({
      loadSdk: async () => stalledSdk(started, () => { interrupts += 1 })
    })
    const running = new AgentSdkRuntime(deps).runTurn('th', 'tn', controller.signal)
    await didStart

    controller.abort()

    await expect(running).resolves.toBe('aborted')
    expect(interrupts).toBe(1)
  })

  test('fails a non-SVG SDK stream that ends without a terminal result', async () => {
    const { deps, events, finished } = makeDeps({ loadSdk: async () => fakeSdk([]) })

    await expect(new AgentSdkRuntime(deps).runTurn(
      'th', 'tn', new AbortController().signal
    )).resolves.toBe('failed')
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'error', code: 'agent_sdk_protocol_error', severity: 'error'
    }))
    expect(finished.at(-1)?.error).toContain('without a terminal result')
  })

  test('interrupts the SDK stream and reports a stable resource code on output overflow', async () => {
    let interrupts = 0
    const sdk = fakeSdk([{
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'SECRET_MARKER' }
      }
    } as SdkMessage])
    const query = sdk.query
    sdk.query = (input) => {
      const stream = query(input)
      stream.interrupt = () => {
        interrupts += 1
        return new Promise<void>(() => {})
      }
      return stream
    }
    const { deps, events, items, finished } = makeDeps({
      loadSdk: async () => sdk,
      getSdkStreamLimits: () => ({ maxOutputBytes: 3 })
    })

    await expect(new AgentSdkRuntime(deps).runTurn(
      'th', 'tn', new AbortController().signal
    )).resolves.toBe('failed')
    expect(interrupts).toBe(1)
    expect(items).toEqual([])
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'error', code: 'stream_resource_limit', severity: 'warning'
    }))
    const error = finished.at(-1)?.error ?? ''
    expect(error).toContain('response text and reasoning bytes')
    expect(error).not.toContain('SECRET_MARKER')
  })

  test('rejects a per-step SDK tool storm before persisting partial calls', async () => {
    let interrupts = 0
    const sdk = fakeSdk([{
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'one', name: 'Read', input: {} },
          { type: 'tool_use', id: 'two', name: 'Read', input: {} }
        ]
      }
    } as SdkMessage])
    const query = sdk.query
    sdk.query = (input) => {
      const stream = query(input)
      stream.interrupt = async () => { interrupts += 1 }
      return stream
    }
    const { deps, events, items } = makeDeps({
      loadSdk: async () => sdk,
      getTurnLimits: () => ({ maxToolCallsPerStep: 1 })
    })

    await expect(new AgentSdkRuntime(deps).runTurn(
      'th', 'tn', new AbortController().signal
    )).resolves.toBe('failed')
    expect(interrupts).toBe(1)
    expect(items).toEqual([])
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'error', code: 'tool_call_limit_exceeded'
    }))
  })

  test('maps SDK error_max_turns onto the native turn_step_limit code', async () => {
    const debugSink = new LlmDebugRecorder()
    const { deps, events, finished } = makeDeps({
      debugSink,
      getTurnLimits: () => ({ maxSteps: 3 }),
      loadSdk: async () => fakeSdk([{
        type: 'result', subtype: 'error_max_turns', is_error: true, num_turns: 3
      } as SdkMessage])
    })

    await expect(new AgentSdkRuntime(deps).runTurn(
      'th', 'tn', new AbortController().signal
    )).resolves.toBe('failed')
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'error', code: 'turn_step_limit', severity: 'warning'
    }))
    expect(finished.at(-1)?.error).toBe('turn exceeded 3 model steps')
    expect(debugSink.snapshot()[0]?.exchanges[0]).toMatchObject({
      status: 'failed',
      decoded: {
        error: 'error_max_turns',
        stopReason: 'error'
      }
    })
  })

  test('fails closed when SDK usage reports more turns than the supplied maxTurns', async () => {
    const { deps, events } = makeDeps({
      getTurnLimits: () => ({ maxSteps: 2 }),
      loadSdk: async () => fakeSdk([{
        type: 'result', subtype: 'success', is_error: false, result: 'done', num_turns: 3
      } as SdkMessage])
    })

    await expect(new AgentSdkRuntime(deps).runTurn(
      'th', 'tn', new AbortController().signal
    )).resolves.toBe('failed')
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'error', code: 'turn_step_limit'
    }))
  })

  test('a query failure records an error event and fails the turn', async () => {
    const { deps, events, finished } = makeDeps({
      loadSdk: async () => ({
        query: () => {
          throw new Error('sdk boom')
        },
        createSdkMcpServer: () => ({ type: 'sdk', name: 'kun', instance: {} }),
        tool: () => ({})
      })
    })
    const status = await new AgentSdkRuntime(deps).runTurn('th', 'tn', new AbortController().signal)
    expect(status).toBe('failed')
    expect(events.some((e) => e.kind === 'error')).toBe(true)
    expect(finished[0]).toMatchObject({ status: 'failed' })
  })

  test('redacts a Claude credential from Agent Perspective and conversation failures', async () => {
    const token = 'sk-ant-oat01-private-auth-token'
    const debugSink = new LlmDebugRecorder()
    const { deps, events, finished } = makeDeps({
      debugSink,
      loadTurnContext: async () => ({
        workspace: '/ws',
        userText: 'authenticate',
        approvalPolicy: 'auto',
        oauthToken: token,
        bridgeableTools: []
      }),
      loadSdk: async () => ({
        query: () => {
          throw new Error(`Failed to authenticate: 401 Invalid Bearer ${token}`)
        },
        createSdkMcpServer: () => ({ type: 'sdk', name: 'kun', instance: {} }),
        tool: () => ({})
      })
    })

    await expect(new AgentSdkRuntime(deps).runTurn(
      'th',
      'tn',
      new AbortController().signal
    )).resolves.toBe('failed')

    const diagnostics = JSON.stringify({
      events,
      finished,
      perspective: debugSink.snapshot()
    })
    expect(diagnostics).toContain('401 Invalid Bearer [REDACTED]')
    expect(diagnostics).not.toContain(token)
  })

  test('redacts credentials from a terminal SDK error result', async () => {
    const token = 'sk-ant-oat01-terminal-result-secret'
    const debugSink = new LlmDebugRecorder()
    const { deps, finished } = makeDeps({
      debugSink,
      loadTurnContext: async () => ({
        workspace: '/ws',
        userText: 'authenticate',
        approvalPolicy: 'auto',
        oauthToken: token,
        bridgeableTools: []
      }),
      loadSdk: async () => fakeSdk([{
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        result: `Invalid Bearer ${token}`,
        num_turns: 1
      } as SdkMessage])
    })

    await expect(new AgentSdkRuntime(deps).runTurn(
      'th',
      'tn',
      new AbortController().signal
    )).resolves.toBe('failed')

    const diagnostics = JSON.stringify({
      finished,
      perspective: debugSink.snapshot()
    })
    expect(diagnostics).toContain('Invalid Bearer [REDACTED]')
    expect(diagnostics).not.toContain(token)
  })

  test('forwards image attachments as a structured user message (text + image block)', async () => {
    let prompt: unknown
    const sdk = fakeSdk(STREAM)
    const inner = sdk.query
    sdk.query = (input) => {
      prompt = (input as { prompt?: unknown }).prompt
      return inner(input)
    }
    const { deps } = makeDeps({
      loadSdk: async () => sdk,
      loadTurnContext: async () => ({
        workspace: '/ws',
        userText: '这是什么',
        approvalPolicy: 'auto',
        images: [{ mediaType: 'image/png', base64: 'AAAA' }],
        bridgeableTools: []
      })
    })
    await new AgentSdkRuntime(deps).runTurn('th', 'tn', new AbortController().signal)

    expect(typeof prompt).not.toBe('string')
    const messages: Array<{ message: { content: unknown } }> = []
    for await (const m of prompt as AsyncIterable<{ message: { content: unknown } }>) messages.push(m)
    expect(messages).toHaveLength(1)
    expect(messages[0].message.content).toEqual([
      { type: 'text', text: '这是什么' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }
    ])
  })

  test('uses a plain string prompt when there are no images', async () => {
    let prompt: unknown
    const sdk = fakeSdk(STREAM)
    const inner = sdk.query
    sdk.query = (input) => {
      prompt = (input as { prompt?: unknown }).prompt
      return inner(input)
    }
    const { deps } = makeDeps({ loadSdk: async () => sdk }) // default ctx: userText 'hello', no images
    await new AgentSdkRuntime(deps).runTurn('th', 'tn', new AbortController().signal)
    expect(prompt).toBe('hello')
  })

  test('handlesProvider delegates to deps', () => {
    const { deps } = makeDeps()
    const runtime = new AgentSdkRuntime(deps)
    expect(runtime.handlesProvider('claude-sub')).toBe(true)
    expect(runtime.handlesProvider('deepseek')).toBe(false)
  })
})
