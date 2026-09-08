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
import { estimateModelRequestInputTokens } from '../../src/loop/model-request-estimator.js'
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
  it('finishes a silent model run as completed', async () => {
    const h = makeHarness(makeSilentModel())
    await bootstrapThread(h)
    const status = await h.loop.runTurn(h.threadId, h.turnId)
    expect(status).toBe('completed')
    expect(h.inflight.size()).toBe(0)
  })

  it('clears turn-scoped manual skill activation after terminal settlement', async () => {
    const clearTurnActivation = vi.fn()
    const skillRuntime = {
      resolveTurn: async () => ({
        activeSkillIds: [],
        activations: [],
        instructions: [],
        injectedBytes: 0
      }),
      clearTurnActivation
    }
    const h = makeHarness(makeSilentModel(), { skillRuntime: skillRuntime as never })
    await bootstrapThread(h)

    await expect(h.loop.runTurn(h.threadId, h.turnId)).resolves.toBe('completed')
    expect(clearTurnActivation).toHaveBeenCalledWith(h.threadId, h.turnId)
  })

  it('runs delegated SDK turns through the shared steering lifecycle', async () => {
    let h!: ReturnType<typeof makeHarness>
    let observedSteering = false
    const sdkRuntime = {
      handlesProvider: () => true,
      runTurn: async (threadId: string, turnId: string) => {
        observedSteering = (await h.sessionStore.loadItems(threadId)).some(
          (item) => item.turnId === turnId && item.kind === 'user_message' && item.text === 'Also do this'
        )
        await h.turns.finishTurn({ threadId, turnId, status: 'completed' })
        return 'completed' as const
      }
    }
    h = makeHarness(makeSilentModel(), { sdkRuntime: sdkRuntime as never })
    await bootstrapThread(h)
    h.steering.enqueue(h.turnId, { text: 'Also do this' })

    await expect(h.loop.runTurn(h.threadId, h.turnId)).resolves.toBe('completed')

    expect(observedSteering).toBe(true)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    expect(events).toContainEqual(expect.objectContaining({ kind: 'pipeline_stage', stage: 'post_start' }))
  })

  it('uses the durable terminal winner when an SDK turn is interrupted first', async () => {
    let h!: ReturnType<typeof makeHarness>
    const sdkRuntime = {
      handlesProvider: () => true,
      runTurn: async (threadId: string, turnId: string) => {
        await h.turns.interruptTurn({ threadId, turnId })
        // Simulate a stale SDK completion reported after the interrupt won.
        return 'completed' as const
      }
    }
    h = makeHarness(makeSilentModel(), { sdkRuntime: sdkRuntime as never })
    await bootstrapThread(h)

    await expect(h.loop.runTurn(h.threadId, h.turnId)).resolves.toBe('aborted')
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    expect(events.filter((event) =>
      event.kind === 'turn_completed' || event.kind === 'turn_failed' || event.kind === 'turn_aborted'
    )).toEqual([expect.objectContaining({ kind: 'turn_aborted' })])
  })

  it('injects the current shell runtime under the full-access sandbox', async () => {
    let observedRequest: ModelRequest | null = null
    const h = makeHarness({
      provider: 'shell-context',
      model: 'shell-context',
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        observedRequest = request
        yield { kind: 'completed', stopReason: 'stop' }
      }
    })
    await bootstrapThread(h, { request: { prompt: 'hello', sandboxMode: 'danger-full-access' } })

    await h.loop.runTurn(h.threadId, h.turnId)

    const request = observedRequest as ModelRequest | null
    if (!request) throw new Error('expected model request')
    expect(request.tools.map((tool) => tool.name)).toContain('bash')
    expect(modelRequestContextText(request)).toContain('<shell_environment>')
    expect(modelRequestContextText(request)).toContain('<syntax>')
    expect(modelRequestContextText(request)).not.toContain('Specialized MCP tools are available')
  })

  it('prefers specialized MCP tools only when they are advertised', async () => {
    let observedRequest: ModelRequest | null = null
    const sourceExplorer = LocalToolHost.defineTool({
      name: 'mcp_semantic_find_symbol',
      description: 'Find source-code symbols and their references.',
      inputSchema: { type: 'object' },
      policy: 'auto',
      execute: async () => ({ output: {} })
    })
    const registry = new CapabilityRegistry([
      {
        id: 'builtin',
        kind: 'built-in',
        enabled: true,
        available: true,
        tools: buildDefaultLocalTools()
      },
      {
        id: 'mcp:semantic',
        kind: 'mcp',
        enabled: true,
        available: true,
        tools: [sourceExplorer]
      }
    ])
    const h = makeHarness({
      provider: 'tool-preference',
      model: 'tool-preference',
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        observedRequest = request
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }, { toolHost: new LocalToolHost({ registry }) })
    await bootstrapThread(h)

    await h.loop.runTurn(h.threadId, h.turnId)

    const request = observedRequest as ModelRequest | null
    if (!request) throw new Error('expected model request')
    const instructions = modelRequestContextText(request)
    expect(instructions).toContain('Specialized source-code MCP tools are available')
    expect(instructions).toContain('`mcp_semantic_find_symbol`')
    expect(instructions).toContain('before broad scans')
    expect(instructions).toContain(
      'Use `read`, `grep`, `glob`, `ls`, `repo_map` for unsupported files'
    )
  })

  it('records elapsed seconds for active goals after a turn finishes', async () => {
    let nowMs = 1_000
    const h = makeHarness(
      {
        provider: 'goal-timer',
        model: 'goal-timer',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          nowMs = 4_700
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { nowMs: () => nowMs }
    )
    await bootstrapThread(h)
    await h.threads.setGoal(h.threadId, { objective: 'ship the feature' })

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const goal = await h.threads.getGoal(h.threadId)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)

    expect(status).toBe('completed')
    expect(goal?.timeUsedSeconds).toBe(3)
    expect(events.some((event) =>
      event.kind === 'goal_updated' && event.goal?.timeUsedSeconds === 3
    )).toBe(true)
  })

  it('includes the failure reason on turn_failed events', async () => {
    const model = {
      provider: 'throwing',
      model: 'throwing',
      config: { baseUrl: 'https://user:secret@example.invalid/v1', model: 'throwing' },
      async *stream(): AsyncIterable<ModelStreamChunk> {
        const chunks: ModelStreamChunk[] = []
        for (const chunk of chunks) yield chunk
        throw new Error('model stream exploded')
      }
    } satisfies import('../../src/ports/model-client.js').ModelClient & {
      config: { baseUrl: string; model: string }
    }
    const h = makeHarness(model)
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    const failed = events.find((event) => event.kind === 'turn_failed')

    expect(status).toBe('failed')
    expect(failed).toMatchObject({
      kind: 'turn_failed',
      message: expect.stringContaining('model stream exploded')
    })
    expect(failed?.kind === 'turn_failed' ? failed.message : '').toContain('[Kun turn failed]')
    expect(failed?.kind === 'turn_failed' ? failed.message : '').not.toContain('user:secret')
    expect(failed?.kind === 'turn_failed' ? failed.message : '').not.toContain('secret')
  })

  it('fails the turn when the model stream yields an error chunk', async () => {
    const h = makeHarness({
      provider: 'error-chunk',
      model: 'error-chunk',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        yield { kind: 'error', message: 'model request failed with status 400', code: 'http_400' }
      }
    })
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)

    expect(status).toBe('failed')
    expect(events.some((event) =>
      event.kind === 'error' &&
      event.message === 'model request failed with status 400' &&
      event.code === 'http_400'
    )).toBe(true)
    const failed = events.find((event) => event.kind === 'turn_failed')
    expect(failed).toMatchObject({
      kind: 'turn_failed',
      message: 'model request failed with status 400',
      code: 'http_400',
      severity: 'error'
    })
  })

  it('emits named pipeline lifecycle stages for a model request', async () => {
    const h = makeHarness(makeSilentModel())
    await bootstrapThread(h)

    await h.loop.runTurn(h.threadId, h.turnId)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    const stages = events
      .filter((event) => event.kind === 'pipeline_stage')
      .map((event) => event.kind === 'pipeline_stage' ? event.stage : '')

    expect(stages).toEqual([
      'setup',
      'pre_start',
      'post_start',
      'input_received',
      'input_cached',
      'input_routed',
      'input_remembered',
      'input_compressed',
      'pre_send',
      'post_send',
      'response_received'
    ])
  })

  it('emits the selected model window and runtime compaction thresholds', async () => {
    const h = makeHarness(makeSilentModel(), {
      tools: [],
      compactor: new ContextCompactor({
        softThreshold: 750,
        hardThreshold: 850
      }),
      modelCapabilities: (model) => ({
        id: model,
        inputModalities: ['text'],
        outputModalities: ['text'],
        supportsToolCalling: true,
        contextWindowTokens: 1_000,
        messageParts: ['text']
      })
    })
    await bootstrapThread(h)

    await h.loop.runTurn(h.threadId, h.turnId)

    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    const snapshot = events.find((event) => event.kind === 'context_snapshot')
    expect(snapshot).toMatchObject({
      kind: 'context_snapshot',
      model: 'fake',
      contextWindowTokens: 1_000,
      softThresholdTokens: 750,
      hardThresholdTokens: 850
    })
  })

  it('compacts from complete request overhead before dispatching the rebuilt request', async () => {
    const requests: ModelRequest[] = []
    const h = makeHarness({
      provider: 'preflight',
      model: 'preflight',
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        requests.push(request)
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }, {
      tools: [],
      compactor: new ContextCompactor({ softThreshold: 220, hardThreshold: 320 }),
      instructionRuntime: {
        resolveTurn: async () => ({
          instruction: `Large dynamic instruction ${'z'.repeat(1_200)}`,
          sources: [],
          injectedBytes: 1_226
        })
      } as never,
      modelCapabilities: (model) => ({
        id: model,
        inputModalities: ['text'],
        outputModalities: ['text'],
        supportsToolCalling: true,
        contextWindowTokens: 2_000,
        messageParts: ['text']
      })
    })
    await h.threadStore.upsert(
      createThreadRecord({ id: h.threadId, title: 'demo', workspace: '/tmp', model: 'preflight' })
    )
    for (let index = 0; index < 4; index += 1) {
      await h.sessionStore.appendItem(h.threadId, makeUserItem({
        id: `old_preflight_${index}`,
        turnId: `old_turn_${index}`,
        threadId: h.threadId,
        text: `old context ${index} ${'x'.repeat(80)}`
      }))
    }
    const started = await h.turns.startTurn({
      threadId: h.threadId,
      request: { prompt: 'keep this current request' }
    })
    h.turnId = started.turnId

    await expect(h.loop.runTurn(h.threadId, h.turnId)).resolves.toBe('completed')

    expect(requests).toHaveLength(1)
    expect(requests[0]?.history[0]).toMatchObject({ kind: 'compaction' })
    expect(requests[0]?.history).toContainEqual(expect.objectContaining({
      kind: 'user_message',
      text: 'keep this current request'
    }))
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'compaction_completed',
      replacedTokens: expect.any(Number)
    }))
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'pipeline_stage',
      stage: 'input_compressed',
      details: expect.objectContaining({
        requestOverheadTokens: expect.any(Number)
      })
    }))
  })

  it('blocks an uncompactable oversized request before model transport dispatch', async () => {
    let dispatches = 0
    const h = makeHarness({
      provider: 'preflight-block',
      model: 'preflight-block',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        dispatches += 1
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }, {
      tools: [],
      compactor: new ContextCompactor({ softThreshold: 100, hardThreshold: 200 }),
      modelCapabilities: (model) => ({
        id: model,
        inputModalities: ['text'],
        outputModalities: ['text'],
        supportsToolCalling: true,
        contextWindowTokens: 500,
        messageParts: ['text']
      })
    })
    await bootstrapThread(h, {
      request: { prompt: `uncompactable current input ${'x'.repeat(4_000)}` }
    })

    await expect(h.loop.runTurn(h.threadId, h.turnId)).resolves.toBe('failed')

    expect(dispatches).toBe(0)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'error',
      code: 'context_window_exceeded',
      message: expect.stringContaining('request exceeds the 425-token context cap')
    }))
    expect(events.some((event) => event.kind === 'context_snapshot')).toBe(false)
  })

  it('does not compact below the soft threshold solely for a large output capability', async () => {
    const requests: ModelRequest[] = []
    const h = makeHarness({
      provider: 'deadzone',
      model: 'deadzone',
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
    await h.threadStore.upsert(
      createThreadRecord({ id: h.threadId, title: 'demo', workspace: '/tmp', model: 'deadzone' })
    )
    // ~725k estimated input tokens stays below the 750k soft threshold. The
    // advertised 131072 capability must not be reserved in full for
    // compaction, but it is still forwarded as the request's `max_tokens`,
    // clamped only to the remaining room under the 850k hard cap.
    const chunk = '工'.repeat(6_050)
    for (let index = 0; index < 120; index += 1) {
      await h.sessionStore.appendItem(h.threadId, makeUserItem({
        id: `deadzone_old_${index}`,
        turnId: `deadzone_old_turn_${index}`,
        threadId: h.threadId,
        text: chunk
      }))
    }
    const started = await h.turns.startTurn({
      threadId: h.threadId,
      request: { prompt: 'keep this current request' }
    })
    h.turnId = started.turnId

    await expect(h.loop.runTurn(h.threadId, h.turnId)).resolves.toBe('completed')

    expect(requests).toHaveLength(1)
    expect(requests[0]?.history[0]).toMatchObject({ kind: 'user_message' })
    const sentInputTokens = estimateModelRequestInputTokens(requests[0]!)
    const expectedMaxTokens = Math.min(131_072, 850_000 - sentInputTokens)
    expect(requests[0]?.maxTokens).toBe(expectedMaxTokens)
    expect(expectedMaxTokens).toBeGreaterThan(32_768)
    expect(sentInputTokens + expectedMaxTokens).toBeLessThanOrEqual(850_000)
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
        outputBudgetTokens: expectedMaxTokens,
        outputReserveTokens: 32_768,
        requestHardCapTokens: 850_000,
        fallbackCompactionAttempted: false
      })
    })
  })

  it('does not repeatedly compact retained history for a 256k / 500k capability profile', async () => {
    const requests: ModelRequest[] = []
    const h = makeHarness({
      provider: 'pathological-output-profile',
      model: 'grok-4.5',
      async *stream(request): AsyncIterable<ModelStreamChunk> {
        requests.push(request)
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }, {
      tools: [],
      compactor: new ContextCompactor({ softThreshold: 192_000, hardThreshold: 217_600 }),
      modelCapabilities: (model) => ({
        id: model,
        inputModalities: ['text'],
        outputModalities: ['text'],
        supportsToolCalling: true,
        contextWindowTokens: 256_000,
        maxOutputTokens: 500_000,
        messageParts: ['text']
      })
    })
    await h.threadStore.upsert(
      createThreadRecord({ id: h.threadId, title: 'demo', workspace: '/tmp', model: 'grok-4.5' })
    )
    for (let index = 0; index < 40; index += 1) {
      await h.sessionStore.appendItem(h.threadId, makeUserItem({
        id: `pathological_old_${index}`,
        turnId: `pathological_old_turn_${index}`,
        threadId: h.threadId,
        text: '工'.repeat(5_000)
      }))
    }
    const first = await h.turns.startTurn({
      threadId: h.threadId,
      request: { prompt: 'first retained request' }
    })
    h.turnId = first.turnId

    await expect(h.loop.runTurn(h.threadId, h.turnId)).resolves.toBe('completed')
    const afterFirst = await h.sessionStore.loadEventsSince(h.threadId, 0)
    expect(afterFirst.filter((event) => event.kind === 'compaction_completed')).toHaveLength(1)

    const second = await h.turns.startTurn({
      threadId: h.threadId,
      request: { prompt: 'small follow-up after compaction' }
    })
    h.turnId = second.turnId
    await expect(h.loop.runTurn(h.threadId, h.turnId)).resolves.toBe('completed')

    const afterSecond = await h.sessionStore.loadEventsSince(h.threadId, 0)
    expect(afterSecond.filter((event) => event.kind === 'compaction_completed')).toHaveLength(1)
    const mainRequests = requests.filter((request) => request.systemPrompt !== COMPACTION_SYSTEM_PROMPT)
    const lastMainRequest = mainRequests.at(-1)!
    const sentInputTokens = estimateModelRequestInputTokens(lastMainRequest)
    const expectedMaxTokens = Math.min(500_000, 217_600 - sentInputTokens)
    expect(lastMainRequest.maxTokens).toBe(expectedMaxTokens)
    expect(sentInputTokens + expectedMaxTokens).toBeLessThanOrEqual(217_600)
    expect(mainRequests.at(-1)?.history.some((item) =>
      item.kind === 'user_message' && item.text === 'small follow-up after compaction'
    )).toBe(true)
  })

  it('fails once with a detailed reason when the current message itself cannot be compacted', async () => {
    let dispatches = 0
    const h = makeHarness({
      provider: 'huge-prompt',
      model: 'huge-prompt',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        dispatches += 1
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }, {
      tools: [],
      compactor: new ContextCompactor({ softThreshold: 40_000, hardThreshold: 85_000 }),
      modelCapabilities: (model) => ({
        id: model,
        inputModalities: ['text'],
        outputModalities: ['text'],
        supportsToolCalling: true,
        contextWindowTokens: 100_000,
        maxOutputTokens: 10_000,
        messageParts: ['text']
      })
    })
    // The input alone exceeds the 85k send cap, so the output budget clamp
    // cannot rescue the request: compaction is the only remedy, and the
    // current message itself is not compactable.
    await bootstrapThread(h, {
      request: { prompt: `unfoldable current input ${'工'.repeat(90_000)}` }
    })

    await expect(h.loop.runTurn(h.threadId, h.turnId)).resolves.toBe('failed')

    expect(dispatches).toBe(0)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    const error = events.find((event) => event.kind === 'error' && event.code === 'context_window_exceeded')
    expect(error).toMatchObject({
      kind: 'error',
      code: 'context_window_exceeded',
      details: expect.objectContaining({
        fallbackCompactionAttempted: true,
        fallbackCompactionApplied: false,
        reason: 'no_compactable_history'
      })
    })
    // The single-attempt rule: nothing was compactable, no compaction was
    // committed, and the turn failed without ever dispatching a model request.
    expect(events.some((event) => event.kind === 'compaction_completed')).toBe(false)
  })
})
