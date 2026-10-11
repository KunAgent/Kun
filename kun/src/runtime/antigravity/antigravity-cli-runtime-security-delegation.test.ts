import { antigravityTestOutput } from './antigravity-test-output.js'
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

  override async appendItem(threadId: string, item: Parameters<InMemorySessionStore['appendItem']>[1]): Promise<void> {
    if (item.kind === 'assistant_text') this.order.push(`item:${item.status}`)
    await super.appendItem(threadId, item)
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
  it('does not expose browser bridge credentials to the model-controlled CLI', async () => {
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const turn = TurnSchema.parse({
      id: 'turn-env-boundary',
      threadId: 'thread-env-boundary',
      status: 'running',
      prompt: 'inspect',
      model: 'gemini-3.6-flash',
      createdAt: '2026-07-23T00:00:00.000Z'
    })
    await threadStore.upsert({
      ...createThreadRecord({
        id: turn.threadId,
        title: 'Environment boundary',
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
        id: 'item-user',
        threadId: turn.threadId,
        turnId: turn.id,
        text: turn.prompt
      })
    )
    let spawnedEnv: NodeJS.ProcessEnv | undefined
    vi.stubEnv('KUN_BROWSER_USE_BRIDGE_URL', 'http://127.0.0.1:12345')
    vi.stubEnv('KUN_BROWSER_USE_BRIDGE_TOKEN', 'bridge-token')
    vi.stubEnv('KUN_BROWSER_USE_APPROVAL_SIGNING_KEY', 'signing-key')
    try {
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
          finishTurn: vi.fn(async () => undefined)
        } as unknown as TurnService,
        events: { record: vi.fn(async () => undefined) } as unknown as RuntimeEventRecorder,
        ids: { next: () => 'item-assistant' },
        spawnFn: successfulSpawn('safe answer\n', (_args, options) => {
          spawnedEnv = options?.env
        })
      })

      await expect(runtime.runTurn(
        turn.threadId,
        turn.id,
        new AbortController().signal,
        'gemini-subscription'
      )).resolves.toBe('completed')

      expect(spawnedEnv).toBeDefined()
      expect(spawnedEnv?.KUN_BROWSER_USE_BRIDGE_URL).toBeUndefined()
      expect(spawnedEnv?.KUN_BROWSER_USE_BRIDGE_TOKEN).toBeUndefined()
      expect(spawnedEnv?.KUN_BROWSER_USE_APPROVAL_SIGNING_KEY).toBeUndefined()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('maps Kun auto approval into the CLI while retaining workspace sandboxing', () => {
    const args = buildAntigravityArgs({
      prompt: 'make the change',
      model: 'gemini-3.5-flash',
      effort: 'medium',
      timeoutMs: 90_000,
      planMode: false,
      approvalPolicy: 'auto',
      sandboxMode: 'workspace-write'
    })
    expect(args).toEqual(expect.arrayContaining([
      '--dangerously-skip-permissions',
      '--sandbox',
      '--model',
      'gemini-3.5-flash'
    ]))
    expect(args).not.toContain('--continue')
    expect(args.some((value) => value.startsWith('--conversation'))).toBe(false)
  })

  it('uses and fingerprints the restricted turn snapshot after the thread becomes full access', async () => {
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const turn = TurnSchema.parse({
      id: 'turn-restricted-snapshot',
      threadId: 'thread-restricted-snapshot',
      status: 'running',
      prompt: 'inspect safely',
      model: 'gemini-3.6-flash',
      providerId: 'gemini-subscription',
      accountId: 'turn-account',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      createdAt: '2026-07-23T00:00:00.000Z'
    })
    const thread = {
      ...createThreadRecord({
        id: turn.threadId,
        title: 'Patched full thread',
        workspace: '/tmp',
        model: 'gemini-9.9-full',
        providerId: 'gemini-subscription',
        accountId: 'thread-account',
        status: 'running',
        approvalPolicy: 'auto',
        sandboxMode: 'danger-full-access'
      }),
      turns: [turn]
    }
    await threadStore.upsert(thread)
    await sessionStore.appendItem(
      turn.threadId,
      makeUserItem({
        id: 'item-user',
        threadId: turn.threadId,
        turnId: turn.id,
        text: turn.prompt
      })
    )
    const root = await mkdtemp(join(tmpdir(), 'kun-antigravity-authority-'))
    const coordinator = new DelegatedSessionCoordinator(
      new FileDelegatedSessionBindingStore(root)
    )
    const updateTurnMetadata = vi.fn(async () => undefined)
    let spawnedArgs: readonly string[] = []
    const runtime = new AntigravityCliRuntime({
      providerConfigs: {},
      providerIds: new Set(['gemini-subscription']),
      defaultIsAntigravity: false,
      threadStore,
      sessionStore,
      turns: {
        applyItem: vi.fn(async () => undefined),
        applyAssistantDelta: vi.fn(async () => undefined),
        updateTurnMetadata,
        finishTurn: vi.fn(async () => undefined)
      } as unknown as TurnService,
      events: { record: vi.fn(async () => undefined) } as unknown as RuntimeEventRecorder,
      ids: { next: () => 'item-assistant' },
      sessionCoordinator: coordinator,
      spawnFn: successfulSpawn('safe answer\n', (args) => {
        spawnedArgs = args
      })
    })

    await expect(runtime.runTurn(
      turn.threadId,
      turn.id,
      new AbortController().signal,
      'gemini-subscription'
    )).resolves.toBe('completed')

    expect(spawnedArgs).toEqual(expect.arrayContaining([
      '--model',
      'gemini-3.6-flash',
      '--mode',
      'plan',
      '--sandbox'
    ]))
    expect(spawnedArgs).not.toContain('--dangerously-skip-permissions')
    expect(updateTurnMetadata).toHaveBeenCalledWith(turn.threadId, turn.id, {
      actingModelRoute: {
        model: 'gemini-3.6-flash',
        providerId: 'gemini-subscription',
        accountId: 'turn-account'
      }
    })
    expect((await coordinator.store.load(turn.threadId))?.capabilityFingerprint).toBe(
      delegatedCapabilityFingerprint({
        systemPrompt: '',
        threadPersona: '',
        effort: 'medium',
        planMode: false,
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        capabilities: antigravityCapabilities()
      })
    )
  })

  it('keeps a full-access acting route after the thread becomes restricted', async () => {
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const turn = TurnSchema.parse({
      id: 'turn-full-snapshot',
      threadId: 'thread-full-snapshot',
      status: 'running',
      prompt: 'perform trusted work',
      model: 'gemini-3.6-flash',
      providerId: 'gemini-subscription',
      accountId: 'turn-account',
      actingModelRoute: {
        model: 'gemini-3.6-flash',
        providerId: 'gemini-subscription',
        accountId: 'turn-account'
      },
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access',
      createdAt: '2026-07-23T00:00:00.000Z'
    })
    await threadStore.upsert({
      ...createThreadRecord({
        id: turn.threadId,
        title: 'Patched restricted thread',
        workspace: '/tmp',
        model: 'gemini-9.9-restricted',
        providerId: 'gemini-subscription',
        status: 'running',
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write'
      }),
      turns: [turn]
    })
    await sessionStore.appendItem(
      turn.threadId,
      makeUserItem({
        id: 'item-user',
        threadId: turn.threadId,
        turnId: turn.id,
        text: turn.prompt
      })
    )
    let spawnedArgs: readonly string[] = []
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
        finishTurn: vi.fn(async () => undefined)
      } as unknown as TurnService,
      events: { record: vi.fn(async () => undefined) } as unknown as RuntimeEventRecorder,
      ids: { next: () => 'item-assistant' },
      spawnFn: successfulSpawn('trusted answer\n', (args) => {
        spawnedArgs = args
      })
    })

    await expect(runtime.runTurn(
      turn.threadId,
      turn.id,
      new AbortController().signal,
      'gemini-subscription'
    )).resolves.toBe('completed')

    expect(spawnedArgs).toContain('--dangerously-skip-permissions')
    expect(spawnedArgs).not.toContain('--mode')
    expect(spawnedArgs).not.toContain('--sandbox')
    expect(spawnedArgs).toEqual(expect.arrayContaining([
      '--model',
      'gemini-3.6-flash'
    ]))
  })

  it('forces delegated read-only children into plan and sandbox controls', async () => {
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const turn = TurnSchema.parse({
      id: 'turn-read-only',
      threadId: 'thread-read-only',
      status: 'running',
      prompt: 'inspect only',
      model: 'gemini-3.6-flash',
      clientSurface: 'tui',
      createdAt: '2026-07-23T00:00:00.000Z'
    })
    await threadStore.upsert({
      ...createThreadRecord({
        id: 'thread-read-only',
        title: 'Read-only child',
        workspace: '/tmp',
        model: 'gemini-3.6-flash',
        providerId: 'gemini-subscription',
        status: 'running',
        approvalPolicy: 'auto',
        sandboxMode: 'workspace-write'
      }),
      turns: [turn]
    })
    await sessionStore.appendItem(
      'thread-read-only',
      makeUserItem({
        id: 'item-user',
        threadId: 'thread-read-only',
        turnId: turn.id,
        text: 'inspect only'
      })
    )
    let spawnedArgs: readonly string[] = []
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
        finishTurn: vi.fn(async () => undefined)
      } as unknown as TurnService,
      events: { record: vi.fn(async () => undefined) } as unknown as RuntimeEventRecorder,
      ids: { next: () => 'item-assistant' },
      enforceReadOnly: true,
      systemPrompt: 'You are a scoped read-only child.',
      spawnFn: successfulSpawn('inspected\n', (args) => {
        spawnedArgs = args
      })
    })

    await expect(runtime.runTurn(
      'thread-read-only',
      turn.id,
      new AbortController().signal,
      'gemini-subscription'
    )).resolves.toBe('completed')
    expect(spawnedArgs).toEqual(expect.arrayContaining(['--mode', 'plan', '--sandbox']))
    expect(spawnedArgs).not.toContain('--dangerously-skip-permissions')
    expect(spawnedArgs[1]).toContain('You are a scoped read-only child.')
    expect(spawnedArgs[1]).toContain('Kun terminal TUI')
  })

  it('publishes delegated Gemini CLI turns to the Agent Perspective trace store', async () => {
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const turn = TurnSchema.parse({
      id: 'turn-gemini',
      threadId: 'thread-gemini',
      status: 'running',
      prompt: 'hello from Gemini',
      model: 'gemini-3.6-flash',
      reasoningEffort: 'high',
      createdAt: '2026-07-23T00:00:00.000Z'
    })
    const thread = {
      ...createThreadRecord({
        id: 'thread-gemini',
        title: 'Gemini trace',
        workspace: '/tmp',
        model: 'gemini-3.6-flash',
        providerId: 'gemini-subscription',
        status: 'running'
      }),
      turns: [turn]
    }
    await threadStore.upsert(thread)
    await sessionStore.appendItem(
      thread.id,
      makeUserItem({
        id: 'item-user',
        threadId: thread.id,
        turnId: turn.id,
        text: 'hello from Gemini'
      })
    )
    const recorder = new LlmDebugRecorder()
    const finishTurn = vi.fn(async () => undefined)
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
      events: {
        record: vi.fn(async () => undefined)
      } as unknown as RuntimeEventRecorder,
      ids: { next: () => 'item-assistant' },
      debugSink: recorder,
      spawnFn: successfulSpawn('Gemini delegated answer\n')
    })

    await expect(runtime.runTurn(
      thread.id,
      turn.id,
      new AbortController().signal,
      'gemini-subscription'
    )).resolves.toBe('completed')

    const trace = (await recorder.listThread(thread.id)).records[0]
    expect(trace).toMatchObject({
      threadId: thread.id,
      turnId: turn.id,
      provider: 'gemini-subscription',
      model: 'gemini-3.6-flash',
      transport: 'cli',
      endpointFormat: 'antigravity-cli',
      status: 'completed',
      delegated: {
        providerKind: 'antigravity-cli',
        phase: 'rebased',
        contextManagement: 'sdk-managed',
        nativeHistory: 'none'
      },
      request: {
        method: 'CLI',
        url: 'antigravity-cli://local/print'
      },
      decoded: {
        text: 'Gemini delegated answer',
        stopReason: 'stop'
      }
    })
    expect(JSON.parse(trace.request!.body.text)).toMatchObject({
      model: 'gemini-3.6-flash',
      input: expect.stringContaining('hello from Gemini'),
      effort: 'high'
    })
    expect(finishTurn).toHaveBeenCalledWith({
      threadId: thread.id,
      turnId: turn.id,
      status: 'completed'
    })
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
      for (const chunk of antigravityTestOutput(output)) child.stdout.write(chunk)
      child.stdout.end()
      child.stderr.end()
      child.emit('exit', 0, null)
    })
    return child as unknown as ChildProcess
  }) as typeof spawn
}
