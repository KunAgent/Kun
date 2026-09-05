import type { ChildProcess, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { InMemoryEventBus } from '../../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../../adapters/in-memory-thread-store.js'
import type { RuntimeEvent } from '../../contracts/events.js'
import { TurnSchema } from '../../contracts/turns.js'
import { createRuntimeEventProjection, replayRuntimeEvents } from '../../domain/runtime-event-reducer.js'
import { makeUserItem } from '../../domain/item.js'
import { makeInternalTurnRuntimeContextSource } from '../../domain/internal-turn-runtime-context.js'
import { createThreadRecord } from '../../domain/thread.js'
import { ContextCompactor } from '../../loop/context-compactor.js'
import { InflightTracker } from '../../loop/inflight-tracker.js'
import { SteeringQueue } from '../../loop/steering-queue.js'
import { SequentialIdGenerator } from '../../ports/id-generator.js'
import { LlmDebugRecorder } from '../../services/llm-debug-recorder.js'
import { RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import { TurnService } from '../../services/turn-service.js'
import {
  AntigravityCliRuntime,
  antigravityCapabilities,
  buildAntigravityArgs,
  normalizeAntigravityEffort,
  normalizeAntigravityModel
} from './antigravity-cli-runtime.js'
import {
  DelegatedSessionCoordinator,
  FileDelegatedSessionBindingStore,
  delegatedCapabilityFingerprint
} from '../delegated-session-binding.js'

class BlockingAntigravityDeltaSessionStore extends InMemorySessionStore {
  readonly order: string[] = []
  readonly deltaEventAppendStarted: Promise<void>
  private releaseDeltaEventAppend!: () => void
  private markDeltaEventAppendStarted!: () => void
  private readonly deltaEventAppendRelease: Promise<void>

  constructor() {
    super()
    this.deltaEventAppendStarted = new Promise<void>((resolve) => {
      this.markDeltaEventAppendStarted = resolve
    })
    this.deltaEventAppendRelease = new Promise<void>((resolve) => {
      this.releaseDeltaEventAppend = resolve
    })
  }

  releaseDeltaEvent(): void {
    this.releaseDeltaEventAppend()
  }

  override async checkpointLiveItem(threadId: string, item: Parameters<InMemorySessionStore['checkpointLiveItem']>[1], representedSeq: number): Promise<void> {
    if (item.kind === 'assistant_text') this.order.push(`item:${item.status}`)
    await super.checkpointLiveItem(threadId, item, representedSeq)
  }

  override async appendEvent(threadId: string, event: RuntimeEvent): Promise<void> {
    if (event.kind !== 'assistant_text_delta') {
      await super.appendEvent(threadId, event)
      return
    }
    this.order.push(`event-start:${event.deltaOffset ?? 'legacy'}`)
    this.markDeltaEventAppendStarted()
    await this.deltaEventAppendRelease
    await super.appendEvent(threadId, event)
    this.order.push('event-commit')
  }
}

describe('AntigravityCliRuntime', () => {
  it('passes safe mixed-family base model ids and supported effort values to agy', () => {
    expect(normalizeAntigravityModel('gemini-3.6-flash-high')).toBe('gemini-3.6-flash')
    expect(normalizeAntigravityModel('models/gemini-3.5-flash')).toBe('gemini-3.5-flash')
    expect(normalizeAntigravityModel('claude-sonnet-4-6')).toBe('claude-sonnet-4-6')
    expect(normalizeAntigravityModel('gpt-oss-120b-medium')).toBe('gpt-oss-120b')
    expect(() => normalizeAntigravityModel('../unsafe')).toThrow('Invalid Antigravity model id')
    expect(normalizeAntigravityEffort('max')).toBe('high')
    expect(normalizeAntigravityEffort('off')).toBe('medium')

    expect(buildAntigravityArgs({
      prompt: 'inspect',
      model: 'claude-opus-4-6-thinking',
      effort: 'high',
      timeoutMs: 60_000,
      planMode: true,
      approvalPolicy: 'auto',
      sandboxMode: 'workspace-write'
    })).toEqual(expect.arrayContaining([
      '--model',
      'claude-opus-4-6-thinking',
      '--effort',
      'high'
    ]))
  })

  it('fails an invalid persisted model before launching the CLI', async () => {
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const turn = TurnSchema.parse({
      id: 'turn-invalid-model',
      threadId: 'thread-invalid-model',
      status: 'running',
      prompt: 'hello',
      model: '../unsafe',
      createdAt: '2026-07-23T00:00:00.000Z'
    })
    await threadStore.upsert({
      ...createThreadRecord({
        id: turn.threadId,
        title: 'Invalid model',
        workspace: '/tmp',
        model: '../unsafe',
        providerId: 'gemini-subscription',
        status: 'running'
      }),
      turns: [turn]
    })
    await sessionStore.appendItem(
      turn.threadId,
      makeUserItem({
        id: 'item-user',
        threadId: turn.threadId,
        turnId: turn.id,
        text: 'hello'
      })
    )
    const finishTurn = vi.fn(async () => undefined)
    const spawnFn = vi.fn()
    const runtime = new AntigravityCliRuntime({
      providerConfigs: {},
      providerIds: new Set(['gemini-subscription']),
      defaultIsAntigravity: false,
      threadStore,
      sessionStore,
      turns: {
        applyItem: vi.fn(async () => undefined),
        applyAssistantDelta: vi.fn(async () => undefined),
        updateTurnMetadata: vi.fn(async () => undefined),
        finishTurn
      } as unknown as TurnService,
      events: { record: vi.fn(async () => undefined) } as unknown as RuntimeEventRecorder,
      ids: { next: () => 'item-assistant' },
      spawnFn: spawnFn as unknown as typeof spawn
    })

    await expect(runtime.runTurn(
      turn.threadId,
      turn.id,
      new AbortController().signal,
      'gemini-subscription'
    )).resolves.toBe('failed')
    expect(spawnFn).not.toHaveBeenCalled()
    expect(finishTurn).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      error: expect.stringContaining('Invalid Antigravity model id')
    }))
  })

  it('materializes active goal context before building the Antigravity prompt', async () => {
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-08-06T00:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const ids = new SequentialIdGenerator()
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight: new InflightTracker(),
      steering: new SteeringQueue(),
      compactor: new ContextCompactor(),
      ids,
      nowIso
    })
    const turn = TurnSchema.parse({
      id: 'turn-antigravity-goal',
      threadId: 'thread-antigravity-goal',
      status: 'running',
      prompt: 'continue the migration',
      model: 'gemini-3.6-flash',
      createdAt: nowIso()
    })
    await threadStore.upsert({
      ...createThreadRecord({
        id: turn.threadId,
        title: 'Antigravity goal context',
        workspace: '/tmp',
        model: turn.model!,
        providerId: 'gemini-subscription',
        status: 'running',
        goal: {
          threadId: turn.threadId,
          objective: 'Finish the migration safely before reporting success.',
          status: 'active',
          tokenBudget: 500,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: nowIso(),
          updatedAt: nowIso()
        }
      }),
      turns: [turn]
    })
    await sessionStore.appendItem(
      turn.threadId,
      makeUserItem({
        id: 'item-antigravity-goal-user',
        threadId: turn.threadId,
        turnId: turn.id,
        text: turn.prompt
      })
    )
    let spawnedArgs: readonly string[] = []
    const debugSink = new LlmDebugRecorder()
    const runtime = new AntigravityCliRuntime({
      providerConfigs: {},
      providerIds: new Set(['gemini-subscription']),
      defaultIsAntigravity: false,
      threadStore,
      sessionStore,
      turns,
      events,
      ids,
      debugSink,
      spawnFn: successfulSpawn('goal-aware answer\n', (args) => {
        spawnedArgs = args
      })
    })

    await expect(runtime.runTurn(
      turn.threadId,
      turn.id,
      new AbortController().signal,
      'gemini-subscription'
    )).resolves.toBe('completed')

    expect((await sessionStore.loadItems(turn.threadId)).some((item) =>
      item.kind === 'goal_context' && item.goalKey
    )).toBe(true)
    expect(spawnedArgs[1]).toContain('<prior_conversation>')
    expect(spawnedArgs[1]).toContain('Finish the migration safely before reporting success.')
    const trace = (await debugSink.listThread(turn.threadId)).records[0]
    if (!trace?.request) throw new Error('expected a request payload in the captured trace')
    expect(trace.request.body.text).not.toContain(
      'Finish the migration safely before reporting success.'
    )
    expect(trace.request.body.text).toContain('[REDACTED]')
  })

  it('persists the Antigravity canonical text before its offset-addressed replay event', async () => {
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new BlockingAntigravityDeltaSessionStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-08-05T00:00:01.000Z'
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const ids = new SequentialIdGenerator()
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight: new InflightTracker(),
      steering: new SteeringQueue(),
      compactor: new ContextCompactor(),
      ids,
      nowIso
    })
    const turn = TurnSchema.parse({
      id: 'turn-delta-order',
      threadId: 'thread-delta-order',
      status: 'running',
      prompt: 'return unicode',
      model: 'gemini-3.6-flash',
      createdAt: '2026-08-05T00:00:00.000Z'
    })
    await threadStore.upsert({
      ...createThreadRecord({
        id: turn.threadId,
        title: 'Antigravity delta ordering',
        workspace: '/tmp',
        model: turn.model!,
        providerId: 'gemini-subscription',
        status: 'running'
      }),
      turns: [turn]
    })
    await sessionStore.appendItem(
      turn.threadId,
      makeUserItem({
        id: 'item-user-delta-order',
        threadId: turn.threadId,
        turnId: turn.id,
        text: turn.prompt
      })
    )
    const text = 'A😀B from Antigravity'
    const runtime = new AntigravityCliRuntime({
      providerConfigs: {},
      providerIds: new Set(['gemini-subscription']),
      defaultIsAntigravity: false,
      threadStore,
      sessionStore,
      turns,
      events,
      ids,
      spawnFn: successfulSpawn(`${text}\n`)
    })

    const running = runtime.runTurn(
      turn.threadId,
      turn.id,
      new AbortController().signal,
      'gemini-subscription'
    )
    await sessionStore.deltaEventAppendStarted

    expect(sessionStore.order).toEqual(['item:running', 'event-start:0'])
    const hydratedItems = await sessionStore.loadItems(turn.threadId)
    expect(hydratedItems).toContainEqual(expect.objectContaining({
      kind: 'assistant_text',
      status: 'running',
      text
    }))
    const hydratedSeq = await sessionStore.highestSeq(turn.threadId)
    expect(await sessionStore.loadEventsSince(turn.threadId, hydratedSeq)).toEqual([])
    const hydratedProjection = {
      ...createRuntimeEventProjection(turn.threadId),
      lastSeq: hydratedSeq,
      items: hydratedItems
    }

    sessionStore.releaseDeltaEvent()
    await expect(running).resolves.toBe('completed')

    expect(sessionStore.order).toEqual([
      'item:running',
      'event-start:0',
      'event-commit'
    ])
    const replayEvents = (await sessionStore.loadEventsSince(turn.threadId, hydratedSeq))
      .filter((event) => event.kind === 'assistant_text_delta')
    expect(replayEvents).toEqual([
      expect.objectContaining({
        kind: 'assistant_text_delta',
        deltaOffset: 0,
        item: expect.objectContaining({ status: 'running', text })
      })
    ])
    const replayed = replayRuntimeEvents(replayEvents, hydratedProjection)
    expect(replayed.items.find((item) => item.kind === 'assistant_text')).toMatchObject({
      status: 'running',
      text
    })
    expect((await sessionStore.loadItems(turn.threadId)).find(
      (item) => item.kind === 'assistant_text'
    )).toMatchObject({
      status: 'completed',
      text
    })
  })

  it('preserves Chinese output when an UTF-8 character spans stdout chunks', async () => {
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const turn = TurnSchema.parse({
      id: 'turn-split-utf8',
      threadId: 'thread-split-utf8',
      status: 'running',
      prompt: '请用中文回答',
      model: 'gemini-3.6-flash',
      createdAt: '2026-08-09T00:00:00.000Z'
    })
    await threadStore.upsert({
      ...createThreadRecord({
        id: turn.threadId,
        title: 'Split UTF-8 output',
        workspace: '/tmp',
        model: turn.model!,
        providerId: 'gemini-subscription',
        status: 'running'
      }),
      turns: [turn]
    })
    await sessionStore.appendItem(
      turn.threadId,
      makeUserItem({
        id: 'item-user-split-utf8',
        threadId: turn.threadId,
        turnId: turn.id,
        text: turn.prompt
      })
    )
    const text = '这是来自 Antigravity 的中文回复。'
    const bytes = Buffer.from(`${text}\n`)
    const applyItem = vi.fn(async () => undefined)
    const runtime = new AntigravityCliRuntime({
      providerConfigs: {},
      providerIds: new Set(['gemini-subscription']),
      defaultIsAntigravity: false,
      threadStore,
      sessionStore,
      turns: {
        applyItem,
        applyAssistantDelta: vi.fn(async () => undefined),
        updateTurnMetadata: vi.fn(async () => undefined),
        finishTurn: vi.fn(async () => undefined)
      } as unknown as TurnService,
      events: { record: vi.fn(async () => undefined) } as unknown as RuntimeEventRecorder,
      ids: { next: () => 'item-assistant-split-utf8' },
      // Split inside the first Chinese character (three UTF-8 bytes).
      spawnFn: successfulSpawn([
        bytes.subarray(0, 1),
        bytes.subarray(1, 5),
        bytes.subarray(5)
      ])
    })

    await expect(runtime.runTurn(
      turn.threadId,
      turn.id,
      new AbortController().signal,
      'gemini-subscription'
    )).resolves.toBe('completed')

    expect(applyItem).toHaveBeenCalledWith(
      turn.threadId,
      expect.objectContaining({ kind: 'assistant_text', status: 'completed', text })
    )
  })

  it('appends a turn persona to the prompt without changing the stable system identity', async () => {
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const turn = TurnSchema.parse({
      id: 'turn-persona', threadId: 'thread-persona', status: 'running',
      prompt: 'Review this draft', persona: 'Write with a precise editorial voice.',
      model: 'gemini-3.6-flash', createdAt: '2026-08-13T00:00:00.000Z'
    })
    await threadStore.upsert({
      ...createThreadRecord({
        id: turn.threadId, title: 'Persona', workspace: '/tmp', model: turn.model!,
        providerId: 'gemini-subscription', systemPrompt: 'Stable thread profile', status: 'running'
      }),
      turns: [turn]
    })
    await sessionStore.appendItem(turn.threadId, makeUserItem({
      id: 'item-user-persona', threadId: turn.threadId, turnId: turn.id, text: turn.prompt
    }))
    const oldHostControl = 'Old private Antigravity host control.'
    await sessionStore.appendItem(turn.threadId, makeInternalTurnRuntimeContextSource({
      threadId: turn.threadId, turnId: 'turn-old',
      context: { kind: 'host-control', content: oldHostControl },
      createdAt: '2026-08-12T00:00:00.000Z'
    }))
    const currentHostControl = 'Current private Antigravity host control.'
    await sessionStore.appendItem(turn.threadId, makeInternalTurnRuntimeContextSource({
      threadId: turn.threadId,
      turnId: turn.id,
      context: { kind: 'host-control', content: currentHostControl },
      createdAt: '2026-08-13T00:00:00.000Z'
    }))
    let prompt = ''
    const debugSink = new LlmDebugRecorder()
    const runtime = new AntigravityCliRuntime({
      providerConfigs: {}, providerIds: new Set(['gemini-subscription']),
      defaultIsAntigravity: false, systemPrompt: 'Stable Kun system prompt',
      threadStore, sessionStore,
      turns: {
        applyItem: vi.fn(async () => undefined),
        applyAssistantDelta: vi.fn(async () => undefined),
        updateTurnMetadata: vi.fn(async () => undefined),
        finishTurn: vi.fn(async () => undefined)
      } as unknown as TurnService,
      events: { record: vi.fn(async () => undefined) } as unknown as RuntimeEventRecorder,
      ids: { next: () => 'item-assistant-persona' },
      debugSink,
      spawnFn: successfulSpawn('done\n', (args) => { prompt = args[1] ?? '' })
    })

    await expect(runtime.runTurn(
      turn.threadId, turn.id, new AbortController().signal, 'gemini-subscription'
    )).resolves.toBe('completed')
    expect(prompt).toContain('<kun_context_block kind="persona" authority="user">')
    expect(prompt).toContain('Write with a precise editorial voice.')
    expect(prompt).toContain('<kun_context_block kind="host-control" authority="runtime">')
    expect(prompt).toContain(currentHostControl)
    expect(prompt).not.toContain(oldHostControl)
    expect(prompt).toContain('Stable Kun system prompt')
    expect(prompt).toContain('Stable thread profile')
    const trace = (await debugSink.listThread(turn.threadId)).records[0]
    expect(trace?.request?.body.text).not.toContain(currentHostControl)
    expect(trace?.request?.body.text).toContain('[REDACTED]')
  })

  it('preserves pending Graph supervision without launching the unsupported CLI', async () => {
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const turn = TurnSchema.parse({
      id: 'turn-graph',
      threadId: 'thread-graph',
      status: 'running',
      prompt: 'build a Graph plan',
      model: 'gemini-3.6-flash',
      orchestration: 'graph',
      graphPlanningLifecycle: {
        version: 1,
        draftId: 'draft-graph',
        reservedRunId: 'run-graph',
        state: 'planning',
        draftRevision: 1
      },
      createdAt: '2026-07-30T00:00:00.000Z'
    })
    await threadStore.upsert({
      ...createThreadRecord({
        id: turn.threadId,
        title: 'Unsupported Graph provider',
        workspace: '/tmp',
        model: 'gemini-3.6-flash',
        providerId: 'gemini-subscription',
        status: 'running'
      }),
      turns: [turn]
    })
    await sessionStore.appendItem(
      turn.threadId,
      makeUserItem({
        id: 'item-user-graph',
        threadId: turn.threadId,
        turnId: turn.id,
        text: turn.prompt
      })
    )
    const applyItem = vi.fn(async () => undefined)
    const applyAssistantDelta = vi.fn(async () => undefined)
    const suspendGraphLeadTurn = vi.fn()
      .mockResolvedValueOnce('supervision_pending')
      .mockResolvedValueOnce('suspended_pending_supervision')
    const finishTurn = vi.fn(async () => undefined)
    const spawnFn = vi.fn()
    const runtime = new AntigravityCliRuntime({
      providerConfigs: {},
      providerIds: new Set(['gemini-subscription']),
      defaultIsAntigravity: false,
      threadStore,
      sessionStore,
      turns: {
        applyItem,
        applyAssistantDelta,
        updateTurnMetadata: vi.fn(async () => undefined),
        suspendGraphLeadTurn,
        finishTurn
      } as unknown as TurnService,
      events: { record: vi.fn(async () => undefined) } as unknown as RuntimeEventRecorder,
      ids: { next: () => 'item-assistant-graph' },
      spawnFn: spawnFn as unknown as typeof spawn
    })

    await expect(runtime.runTurn(
      turn.threadId,
      turn.id,
      new AbortController().signal,
      'gemini-subscription'
    )).resolves.toBe('suspended_pending_supervision')

    expect(spawnFn).not.toHaveBeenCalled()
    expect(finishTurn).not.toHaveBeenCalled()
    expect(suspendGraphLeadTurn).toHaveBeenCalledWith({
      threadId: turn.threadId,
      turnId: turn.id
    })
    expect(suspendGraphLeadTurn).toHaveBeenLastCalledWith({
      threadId: turn.threadId,
      turnId: turn.id,
      force: true,
      preserveDeliveryCursor: true,
      allowPendingSupervision: true
    })
    expect(applyAssistantDelta).toHaveBeenCalledWith(
      turn.threadId,
      expect.objectContaining({
        kind: 'assistant_text',
        status: 'running',
        text: expect.stringContaining('Graph mode is unavailable')
      }),
      expect.stringContaining('Graph mode is unavailable'),
      0
    )
    expect(applyAssistantDelta.mock.invocationCallOrder[0]).toBeLessThan(
      applyItem.mock.invocationCallOrder[0]!
    )
    expect(applyItem).toHaveBeenCalledWith(
      turn.threadId,
      expect.objectContaining({
        kind: 'assistant_text',
        status: 'completed',
        text: expect.stringContaining('Graph mode is unavailable')
      })
    )
  })

  it('keeps read-only turns in plan+sandbox mode', () => {
    const args = buildAntigravityArgs({
      prompt: 'inspect only',
      model: 'gemini-3.6-flash',
      effort: 'low',
      timeoutMs: 60_000,
      planMode: false,
      approvalPolicy: 'on-request',
      sandboxMode: 'read-only'
    })
    expect(args.slice(0, 2)).toEqual(['--print', 'inspect only'])
    expect(args).toEqual(expect.arrayContaining(['--mode', 'plan', '--sandbox']))
    expect(args).not.toContain('--dangerously-skip-permissions')
  })

  it('fails closed to plan mode when GUI approval cannot be surfaced', () => {
    const args = buildAntigravityArgs({
      prompt: 'change files after approval',
      model: 'gemini-3.6-flash',
      effort: 'medium',
      timeoutMs: 60_000,
      planMode: false,
      approvalPolicy: 'on-request',
      sandboxMode: 'danger-full-access'
    })
    expect(args).toEqual(expect.arrayContaining(['--mode', 'plan', '--sandbox']))
    expect(args).not.toContain('--dangerously-skip-permissions')
  })

  it('fails closed for Approve for me when the provider has no approval callback', () => {
    // Approve for me maps to on-request + workspace-write. Antigravity's
    // non-interactive CLI exposes no per-action callback that Kun can route to
    // ApprovalReviewService, so native mutation stays disabled instead of
    // silently switching to a provider classifier.
    const args = buildAntigravityArgs({
      prompt: 'change files after agent review',
      model: 'gemini-3.6-flash',
      effort: 'medium',
      timeoutMs: 60_000,
      planMode: false,
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write'
    })
    expect(args).toEqual(expect.arrayContaining(['--mode', 'plan', '--sandbox']))
    expect(args).not.toContain('--dangerously-skip-permissions')
  })
})

function successfulSpawn(
  output: string | readonly Buffer[],
  onSpawn?: (
    args: readonly string[],
    options?: { env?: NodeJS.ProcessEnv }
  ) => void
): typeof spawn {
  return ((
    _command: string,
    args: readonly string[],
    options?: { env?: NodeJS.ProcessEnv }
  ) => {
    onSpawn?.(args, options)
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough
      stderr: PassThrough
      kill: () => boolean
    }
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => true
    queueMicrotask(() => {
      if (typeof output === 'string') {
        child.stdout.end(output)
      } else {
        for (const chunk of output) child.stdout.write(chunk)
        child.stdout.end()
      }
      child.stderr.end()
      child.emit('exit', 0, null)
    })
    return child as unknown as ChildProcess
  }) as typeof spawn
}
