import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryEventBus } from '../../src/adapters/in-memory-event-bus.js'
import { LocalToolHost, buildDefaultLocalTools } from '../../src/adapters/tool/local-tool-host.js'
import { CapabilityRegistry } from '../../src/adapters/tool/capability-registry.js'
import { buildBrowserUseToolProviders } from '../../src/adapters/tool/browser-use-tool-provider.js'
import { CREATE_PLAN_TOOL_NAME } from '../../src/adapters/tool/create-plan-tool.js'
import { GET_GOAL_TOOL_NAME, UPDATE_GOAL_TOOL_NAME } from '../../src/adapters/tool/goal-tools.js'
import { FileThreadStore, FileSessionStore } from '../../src/adapters/file/index.js'
import { RuntimeEventRecorder } from '../../src/services/runtime-event-recorder.js'
import { ContextCompactor } from '../../src/loop/context-compactor.js'
import { COMPACTION_SYSTEM_PROMPT } from '../../src/loop/compaction-summary.js'
import { effectiveHistoryAfterLatestCompaction } from '../../src/loop/compaction-history.js'
import { resolveModelContextProfile } from '../../src/loop/model-context-profile.js'
import { modelRequestContextText } from '../../src/loop/model-request-context.js'
import { isPlanClarifyingQuestion } from '../../src/loop/agent-loop.js'
import { LoopTelemetry } from '../../src/loop/loop-telemetry.js'
import {
  makeApprovalItem,
  makeAssistantReasoningItem,
  makeAssistantTextItem,
  makeGoalContextItem,
  makeToolCallItem,
  makeToolResultItem,
  makeUserInputItem,
  makeUserItem
} from '../../src/domain/item.js'
import { createThreadRecord } from '../../src/domain/thread.js'
import { createImmutablePrefix, setSystemPrompt } from '../../src/cache/immutable-prefix.js'
import { InflightTracker } from '../../src/loop/inflight-tracker.js'
import { SteeringQueue } from '../../src/loop/steering-queue.js'
import { SequentialIdGenerator } from '../../src/ports/id-generator.js'
import type { SessionStore } from '../../src/ports/session-store.js'
import { TurnService } from '../../src/services/turn-service.js'
import type { TurnItem } from '../../src/contracts/items.js'
import type { ModelRequest, ModelStreamChunk } from '../../src/ports/model-client.js'
import type { BrowserController } from '../../src/ports/browser-controller.js'
import {
  bootstrapThread,
  makeFakeModel,
  makeHarness,
  makeSilentModel,
  resolveNextUserInput
} from '../loop-test-harness.js'

describe('AgentLoop', () => {
  it('keeps a large output capability bounded when generated-image input is rehydrated', async () => {
    const requests: ModelRequest[] = []
    const h = makeHarness({
      provider: 'image-fallback',
      model: 'image-fallback',
      async *stream(request): AsyncIterable<ModelStreamChunk> {
        requests.push(request)
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }, {
      tools: [],
      compactor: new ContextCompactor({ softThreshold: 750_000, hardThreshold: 850_000 }),
      modelCapabilities: (model) => ({
        id: model,
        inputModalities: ['text'],
        outputModalities: ['text'],
        supportsToolCalling: true,
        contextWindowTokens: 1_000_000,
        maxOutputTokens: 131_072,
        messageParts: ['text']
      })
    })
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-image-fallback-'))
    try {
      await h.threadStore.upsert(
        createThreadRecord({ id: h.threadId, title: 'demo', workspace: '/tmp', model: 'image-fallback' })
      )
      // Preflight lands just below the soft threshold and image rehydration
      // adds a fixed vision allowance, so history stays intact.
      for (let index = 0; index < 119; index += 1) {
        await h.sessionStore.appendItem(h.threadId, makeUserItem({
          id: `image_old_${index}`,
          turnId: `image_old_turn_${index}`,
          threadId: h.threadId,
          text: '工'.repeat(6_033)
        }))
      }
      const pngPath = join(dataDir, 'generated.png')
      await writeFile(pngPath, Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      ))
      await h.sessionStore.appendItem(h.threadId, makeToolCallItem({
        id: 'image_forward_call',
        threadId: h.threadId,
        turnId: 'image_old_turn_118',
        callId: 'call_image_forward',
        toolName: 'generate_image',
        arguments: { prompt: 'tiny probe image' },
        status: 'completed'
      }))
      await h.sessionStore.appendItem(h.threadId, makeToolResultItem({
        id: 'image_forward_result',
        threadId: h.threadId,
        turnId: 'image_old_turn_118',
        callId: 'call_image_forward',
        toolName: 'generate_image',
        output: { markdown: '![generated image](.kun/images/generated.png)', files: [{ absolutePath: pngPath }] }
      }))
      const started = await h.turns.startTurn({
        threadId: h.threadId,
        request: { prompt: 'keep this current request' }
      })
      h.turnId = started.turnId

      await expect(h.loop.runTurn(h.threadId, h.turnId)).resolves.toBe('completed')

      expect(requests).toHaveLength(1)
      const request = requests[0]!
      expect(request.history[0]).toMatchObject({ kind: 'user_message' })
      // Forwarded max_tokens honors the declared capability, not the 32,768 reserve.
      expect(request.maxTokens).toBeGreaterThan(32_768)
      expect(request.maxTokens).toBeLessThanOrEqual(131_072)
      const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
      expect(events.some((event) =>
        event.kind === 'error' && event.code === 'context_window_exceeded'
      )).toBe(false)
      expect(events.some((event) => event.kind === 'compaction_completed')).toBe(false)
      const compressed = events.find((event) =>
        event.kind === 'pipeline_stage' && event.stage === 'input_compressed'
      )
      expect(compressed).toMatchObject({
        kind: 'pipeline_stage',
        stage: 'input_compressed',
        details: expect.objectContaining({
          outputBudgetTokens: request.maxTokens,
          requestHardCapTokens: 850_000,
          fallbackCompactionAttempted: false
        })
      })
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('records provider endpoint diagnostics for model send stages', async () => {
    const model = {
      provider: 'compat',
      model: 'MiniMax-M2',
      config: {
        baseUrl: 'https://user:secret@api.minimaxi.com/anthropic?token=hidden#debug',
        endpointFormat: 'messages',
        model: 'MiniMax-M2'
      },
      async *stream(): AsyncIterable<ModelStreamChunk> {
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const h = makeHarness(model)
    await bootstrapThread(h, {
      request: { prompt: 'hello', model: 'mimo-v2.5-pro-ultraspeed' }
    })

    await h.loop.runTurn(h.threadId, h.turnId)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    const preSend = events.find((event) =>
      event.kind === 'pipeline_stage' && event.stage === 'pre_send'
    )
    const postSend = events.find((event) =>
      event.kind === 'pipeline_stage' && event.stage === 'post_send'
    )

    expect(preSend).toMatchObject({
      kind: 'pipeline_stage',
      stage: 'pre_send',
      details: {
        model: 'mimo-v2.5-pro-ultraspeed',
        provider: 'compat',
        providerBaseUrl: 'https://api.minimaxi.com/anthropic',
        endpointFormat: 'messages',
        configuredModel: 'MiniMax-M2'
      }
    })
    expect(postSend).toMatchObject({
      kind: 'pipeline_stage',
      stage: 'post_send',
      details: {
        model: 'mimo-v2.5-pro-ultraspeed',
        providerBaseUrl: 'https://api.minimaxi.com/anthropic'
      }
    })
  })

  it('redacts credentials from malformed provider URLs in pipeline diagnostics', async () => {
    const model = {
      provider: 'compat',
      model: 'test-model',
      config: { baseUrl: 'https://user:secret@%', endpointFormat: 'messages', model: 'test-model' },
      async *stream(): AsyncIterable<ModelStreamChunk> {
        yield { kind: 'completed', stopReason: 'stop' }
      }
    } satisfies import('../../src/ports/model-client.js').ModelClient & {
      config: { baseUrl: string; endpointFormat: string; model: string }
    }
    const h = makeHarness(model)
    await bootstrapThread(h)

    await h.loop.runTurn(h.threadId, h.turnId)

    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    const preSend = events.find((event) => event.kind === 'pipeline_stage' && event.stage === 'pre_send')
    const diagnostics = JSON.stringify(preSend)
    expect(diagnostics).not.toContain('user:secret')
    expect(diagnostics).not.toContain('secret')
  })

  it('aborts the turn when the abort signal fires', async () => {
    const h = makeHarness({
      provider: 'blocker',
      model: 'blocker',
      async *stream({ abortSignal }): AsyncIterable<ModelStreamChunk> {
        await new Promise<void>((resolve) => {
          if (abortSignal.aborted) return resolve()
          abortSignal.addEventListener('abort', () => resolve(), { once: true })
        })
        yield { kind: 'error', message: 'aborted' }
      }
    })
    await bootstrapThread(h)
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 5)
    h.turns['inflightTurns'].set(h.turnId, controller)
    const status = await h.loop.runTurn(h.threadId, h.turnId)
    expect(status === 'aborted' || status === 'failed').toBe(true)
    expect(h.inflight.size()).toBe(0)
  })

  it('can discard generated items when interrupting a foreground turn', async () => {
    const h = makeHarness(makeSilentModel())
    await bootstrapThread(h)
    await h.turns.applyItem(
      h.threadId,
      makeAssistantTextItem({
        id: 'partial_answer',
        turnId: h.turnId,
        threadId: h.threadId,
        text: 'partial',
        status: 'running'
      })
    )

    await h.turns.interruptTurn({ threadId: h.threadId, turnId: h.turnId, discard: true })
    const sessionItems = await h.sessionStore.loadItems(h.threadId)
    const thread = await h.threadStore.get(h.threadId)
    const turnItems = thread?.turns.find((turn) => turn.id === h.turnId)?.items ?? []

    expect(sessionItems.filter((item) => item.turnId === h.turnId).map((item) => item.kind))
      .toEqual(['user_message'])
    expect(turnItems.map((item) => item.kind)).toEqual(['user_message'])
  })

  it('keeps partial assistant text when interrupting a foreground turn', async () => {
    let resolveDelta: (() => void) | undefined
    const sawDelta = new Promise<void>((resolve) => {
      resolveDelta = resolve
    })
    const h = makeHarness({
      provider: 'partial-abort',
      model: 'partial-abort',
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        yield { kind: 'assistant_text_delta', text: 'partial answer' }
        resolveDelta?.()
        await new Promise<void>((resolve) => {
          if (request.abortSignal.aborted) {
            resolve()
            return
          }
          request.abortSignal.addEventListener('abort', () => resolve(), { once: true })
        })
        yield { kind: 'completed', stopReason: 'stop' }
      }
    })
    await bootstrapThread(h)

    const run = h.loop.runTurn(h.threadId, h.turnId)
    await sawDelta
    await h.turns.interruptTurn({ threadId: h.threadId, turnId: h.turnId })
    const status = await run
    const sessionItems = await h.sessionStore.loadItems(h.threadId)
    const thread = await h.threadStore.get(h.threadId)
    const turnItems = thread?.turns.find((turn) => turn.id === h.turnId)?.items ?? []

    expect(status).toBe('aborted')
    expect(sessionItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'assistant_text',
          text: 'partial answer',
          status: 'completed'
        })
      ])
    )
    expect(turnItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'assistant_text',
          text: 'partial answer',
          status: 'completed'
        })
      ])
    )
  })

  it('runs a tool call and surfaces its result item', async () => {
    let calls = 0
    const h = makeHarness({
      provider: 'fake',
      model: 'fake',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        calls += 1
        if (calls === 1) {
          yield {
            kind: 'tool_call_complete',
            callId: 'call_echo',
            toolName: 'echo',
            arguments: { text: 'hi' }
          }
          yield { kind: 'completed', stopReason: 'tool_calls' }
          return
        }
        yield { kind: 'assistant_text_delta', text: 'done' }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    })
    await bootstrapThread(h)
    const status = await h.loop.runTurn(h.threadId, h.turnId)
    expect(status).toBe('completed')
    const items = await h.sessionStore.loadItems(h.threadId)
    const result = items.find((item) => item.kind === 'tool_result')
    expect(result).toBeDefined()
    if (result?.kind === 'tool_result') {
      expect(result.toolName).toBe('echo')
    }
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    expect(events.some((event) => event.kind === 'tool_call_ready' && event.readyCount === 1)).toBe(true)
    expect(events.some((event) =>
      event.kind === 'tool_result_upload_wait' && event.toolResultCount === 1
    )).toBe(true)
    const contextSnapshots = events.filter((event) => event.kind === 'context_snapshot')
    expect(contextSnapshots).toHaveLength(2)
    expect(contextSnapshots.map((event) => event.stepIndex)).toEqual([0, 1])
    for (const snapshot of contextSnapshots) {
      expect(snapshot.estimatedInputTokens).toBe(
        snapshot.breakdown.tools +
        snapshot.breakdown.system +
        snapshot.breakdown.skills +
        snapshot.breakdown.messages +
        snapshot.breakdown.other
      )
      expect(snapshot.toolCount).toBeGreaterThan(0)
    }
    expect(contextSnapshots[1]?.breakdown.messages)
      .toBeGreaterThan(contextSnapshots[0]?.breakdown.messages ?? 0)
    const thread = await h.threadStore.get(h.threadId)
    const toolCall = thread?.turns
      .flatMap((turn) => turn.items)
      .find((item) => item.kind === 'tool_call' && item.callId === 'call_echo')
    expect(toolCall).toMatchObject({ kind: 'tool_call', status: 'completed' })
  })

  it('retries an empty model continuation after a file change', async () => {
    let calls = 0
    const requests: ModelRequest[] = []
    const writeHelper = LocalToolHost.defineTool({
      name: 'write_helper',
      description: 'Write a helper script.',
      inputSchema: { type: 'object', properties: {} },
      policy: 'auto',
      toolKind: 'file_change',
      execute: async () => ({ output: { ok: true } })
    })
    const h = makeHarness(
      {
        provider: 'empty-after-tool',
        model: 'empty-after-tool',
        async *stream(request): AsyncIterable<ModelStreamChunk> {
          requests.push(request)
          calls += 1
          if (calls === 1) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_write_helper',
              toolName: 'write_helper',
              arguments: {}
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          if (calls === 2) {
            yield { kind: 'completed', stopReason: 'stop' }
            return
          }
          yield { kind: 'assistant_text_delta', text: 'analysis complete' }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [writeHelper] }
    )
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const items = await h.sessionStore.loadItems(h.threadId)

    expect(status).toBe('completed')
    expect(calls).toBe(3)
    expect(modelRequestContextText(requests[2]!)).toContain('Tool continuation recovery')
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'assistant_text',
        text: 'analysis complete'
      })
    ]))
  })

  it('fails visibly when the model repeats an empty post-tool continuation', async () => {
    let calls = 0
    const requests: ModelRequest[] = []
    const writeHelper = LocalToolHost.defineTool({
      name: 'write_helper',
      description: 'Write a helper script.',
      inputSchema: { type: 'object', properties: {} },
      policy: 'auto',
      toolKind: 'file_change',
      execute: async () => ({ output: { ok: true } })
    })
    const h = makeHarness(
      {
        provider: 'repeated-empty-after-tool',
        model: 'repeated-empty-after-tool',
        async *stream(request): AsyncIterable<ModelStreamChunk> {
          requests.push(request)
          calls += 1
          if (calls === 1) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_write_helper',
              toolName: 'write_helper',
              arguments: {}
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [writeHelper] }
    )
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const items = await h.sessionStore.loadItems(h.threadId)

    expect(status).toBe('failed')
    expect(calls).toBe(4)
    expect(requests[3]?.tools).toEqual([])
    expect(modelRequestContextText(requests[3]!)).toContain('Tool final-answer recovery')
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'error',
        code: 'empty_post_tool_continuation'
      })
    ]))
  })

  it('forces a tool-free final answer after two empty post-tool continuations', async () => {
    let calls = 0
    const requests: ModelRequest[] = []
    const writeHelper = LocalToolHost.defineTool({
      name: 'write_helper',
      description: 'Write a helper script.',
      inputSchema: { type: 'object', properties: {} },
      policy: 'auto',
      toolKind: 'file_change',
      execute: async () => ({ output: { ok: true } })
    })
    const h = makeHarness(
      {
        provider: 'final-answer-after-repeated-empty',
        model: 'final-answer-after-repeated-empty',
        async *stream(request): AsyncIterable<ModelStreamChunk> {
          requests.push(request)
          calls += 1
          if (calls === 1) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_write_helper',
              toolName: 'write_helper',
              arguments: {}
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          if (calls < 4) {
            yield { kind: 'completed', stopReason: 'stop' }
            return
          }
          yield { kind: 'assistant_text_delta', text: 'The helper was written successfully.' }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [writeHelper] }
    )
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const items = await h.sessionStore.loadItems(h.threadId)

    expect(status).toBe('completed')
    expect(calls).toBe(4)
    expect(requests[2]?.tools.map((tool) => tool.name)).toContain('write_helper')
    expect(requests[3]?.tools).toEqual([])
    expect(modelRequestContextText(requests[3]!)).toContain('Tool final-answer recovery')
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'assistant_text',
        text: 'The helper was written successfully.'
      })
    ]))
    expect(items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'empty_post_tool_continuation' })
    ]))
  })

  it('continues after three failed searches and an investigation status', async () => {
    let calls = 0
    let executions = 0
    const requests: ModelRequest[] = []
    const search = LocalToolHost.defineTool({
      name: 'search',
      description: 'Fails until a later retry',
      inputSchema: {
        type: 'object',
        properties: { attempt: { type: 'number' } },
        required: ['attempt']
      },
      policy: 'auto',
      execute: async (args) => {
        executions += 1
        return args.attempt === 4
          ? { output: { ok: true } }
          : { output: { error: 'simulated failure' }, isError: true }
      }
    })
    const h = makeHarness(
      {
        provider: 'progress-after-failure',
        model: 'progress-after-failure',
        async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
          requests.push(request)
          calls += 1
          if (calls <= 3) {
            yield {
              kind: 'tool_call_complete',
              callId: `call_search_${calls}`,
              toolName: 'search',
              arguments: { attempt: calls }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          if (calls === 4) {
            yield { kind: 'assistant_text_delta', text: '我来调查失败原因。先定位关键参数。' }
            yield { kind: 'completed', stopReason: 'stop' }
            return
          }
          if (calls === 5) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_search_4',
              toolName: 'search',
              arguments: { attempt: 4 }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'assistant_text_delta', text: '成功完成。' }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      {
        tools: [search],
        toolStorm: { enabled: false },
        compactor: new ContextCompactor({ softThreshold: 1_000_000, hardThreshold: 1_100_000 })
      }
    )
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const items = await h.sessionStore.loadItems(h.threadId)

    expect(status).toBe('completed')
    expect(calls).toBe(6)
    expect(executions).toBe(4)
    expect(modelRequestContextText(requests[4]!)).toContain('Tool failure recovery')
    const failedResult = requests[4]?.history.find(
      (item) => item.kind === 'tool_result' && item.toolName === 'search'
    )
    expect(failedResult?.kind === 'tool_result' ? failedResult.isError : false).toBe(true)
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'tool_result', toolName: 'search', isError: false })
    ]))
  })

  it('fails visibly when the model keeps announcing progress after a tool failure', async () => {
    let calls = 0
    const requests: ModelRequest[] = []
    const fragile = LocalToolHost.defineTool({
      name: 'fragile',
      description: 'Always fails',
      inputSchema: { type: 'object', properties: {} },
      policy: 'auto',
      execute: async () => ({ output: { error: 'simulated failure' }, isError: true })
    })
    const h = makeHarness(
      {
        provider: 'repeated-progress-after-failure',
        model: 'repeated-progress-after-failure',
        async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
          requests.push(request)
          calls += 1
          if (calls === 1) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_fragile',
              toolName: 'fragile',
              arguments: {}
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'assistant_text_delta', text: '我来调查失败原因。先定位关键参数。' }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [fragile], toolStorm: { enabled: false } }
    )
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const items = await h.sessionStore.loadItems(h.threadId)

    expect(status).toBe('failed')
    expect(calls).toBe(4)
    expect(requests[3]?.tools).toEqual([])
    expect(modelRequestContextText(requests[3]!))
      .toContain('Tool failure final-answer recovery')
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'post_tool_failure_recovery_exhausted' })
    ]))
  })

  it('accepts a final answer directly after a tool failure without forcing recovery', async () => {
    let calls = 0
    const fragile = LocalToolHost.defineTool({
      name: 'fragile',
      description: 'Always fails',
      inputSchema: { type: 'object', properties: {} },
      policy: 'auto',
      execute: async () => ({ output: { error: 'simulated failure' }, isError: true })
    })
    const h = makeHarness(
      {
        provider: 'final-after-failure',
        model: 'final-after-failure',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          calls += 1
          if (calls === 1) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_fragile',
              toolName: 'fragile',
              arguments: {}
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield {
            kind: 'assistant_text_delta',
            text: 'The fragile tool failed; the task cannot continue until you provide the missing credential.'
          }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [fragile], toolStorm: { enabled: false } }
    )
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    expect(status).toBe('completed')
    expect(calls).toBe(2)
  })
})
