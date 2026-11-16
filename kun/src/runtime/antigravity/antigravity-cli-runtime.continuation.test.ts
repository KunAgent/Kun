import type { ChildProcess, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InMemorySessionStore } from '../../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../../adapters/in-memory-thread-store.js'
import type { RuntimeEvent } from '../../contracts/events.js'
import { TurnSchema, type TurnReasoningEffort } from '../../contracts/turns.js'
import { makeUserItem } from '../../domain/item.js'
import { createThreadRecord } from '../../domain/thread.js'
import type { RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import type { TurnService } from '../../services/turn-service.js'
import {
  DelegatedSessionCoordinator,
  FileDelegatedSessionBindingStore
} from '../delegated-session-binding.js'
import { AntigravityCliRuntime } from './antigravity-cli-runtime.js'

const cleanupDirs: string[] = []

afterEach(async () => {
  for (const dir of cleanupDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

type ScriptedSpawnStep = {
  stdout?: string
  stderr?: string
  exitCode?: number
}

function scriptedSpawn(
  steps: ScriptedSpawnStep[],
  calls: Array<readonly string[]>
): typeof spawn {
  let index = 0
  return ((_command: string, args: readonly string[]) => {
    calls.push([...args])
    const step = steps[Math.min(index, steps.length - 1)]!
    index += 1
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough
      stderr: PassThrough
      kill: () => boolean
    }
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => true
    queueMicrotask(() => {
      if (step.stdout) child.stdout.write(step.stdout)
      child.stdout.end()
      if (step.stderr) child.stderr.write(step.stderr)
      child.stderr.end()
      child.emit('exit', step.exitCode ?? 0, null)
    })
    return child as unknown as ChildProcess
  }) as typeof spawn
}

async function setupAntigravityRuntime(steps: ScriptedSpawnStep[]) {
  const root = await mkdtemp(join(tmpdir(), 'kun-agy-continuation-'))
  cleanupDirs.push(root)
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const coordinator = new DelegatedSessionCoordinator(
    new FileDelegatedSessionBindingStore(root)
  )
  const recorded: RuntimeEvent[] = []
  const calls: Array<readonly string[]> = []
  let seq = 0
  const turns = {
    applyItem: vi.fn(async (threadId: string, item: Parameters<InMemorySessionStore['appendItem']>[1]) => {
      await sessionStore.appendItem(threadId, item)
    }),
    applyAssistantDelta: vi.fn(async () => undefined),
    updateTurnMetadata: vi.fn(async () => undefined),
    finishTurn: vi.fn(async () => undefined)
  } as unknown as TurnService
  const runtime = new AntigravityCliRuntime({
    providerConfigs: {},
    providerIds: new Set(['gemini-subscription']),
    defaultIsAntigravity: false,
    threadStore,
    sessionStore,
    turns,
    events: {
      record: vi.fn(async (event: RuntimeEvent) => {
        recorded.push(event)
      })
    } as unknown as RuntimeEventRecorder,
    ids: { next: (prefix) => `${prefix}_${++seq}` },
    sessionCoordinator: coordinator,
    spawnFn: scriptedSpawn(steps, calls)
  })
  return { runtime, threadStore, sessionStore, coordinator, recorded, calls }
}

async function runTurnWithModel(
  h: Awaited<ReturnType<typeof setupAntigravityRuntime>>,
  input: {
    threadId: string
    turnId: string
    prompt: string
    model: string
    reasoningEffort?: TurnReasoningEffort
    priorTurns?: ReturnType<typeof TurnSchema.parse>[]
  }
) {
  const turn = TurnSchema.parse({
    id: input.turnId,
    threadId: input.threadId,
    status: 'running',
    prompt: input.prompt,
    model: input.model,
    ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
    createdAt: '2026-08-10T00:00:00.000Z'
  })
  const existing = await h.threadStore.get(input.threadId)
  await h.threadStore.upsert({
    ...createThreadRecord({
      id: input.threadId,
      title: 'Antigravity continuation',
      workspace: '/tmp',
      model: input.model,
      providerId: 'gemini-subscription',
      status: 'running'
    }),
    turns: [...(existing?.turns ?? input.priorTurns ?? []), turn]
  })
  await h.sessionStore.appendItem(
    input.threadId,
    makeUserItem({
      id: `item_${input.turnId}_user`,
      threadId: input.threadId,
      turnId: input.turnId,
      text: input.prompt
    })
  )
  const outcome = await h.runtime.runTurn(
    input.threadId,
    input.turnId,
    new AbortController().signal,
    'gemini-subscription'
  )
  // Simulate turn completion item if needed for priorItems history digest alignment.
  return { outcome, turn }
}

describe('AntigravityCliRuntime model-switch continuation', () => {
  it('resumes the native --conversation with the new --model and emits no handoff brief', async () => {
    const h = await setupAntigravityRuntime([
      {
        stdout: JSON.stringify({
          conversation_id: 'conv-agy-1',
          status: 'SUCCESS',
          response: 'First answer from Gemini'
        })
      },
      {
        stdout: JSON.stringify({
          conversation_id: 'conv-agy-1',
          status: 'SUCCESS',
          response: 'Second answer from Carbon'
        })
      }
    ])

    const first = await runTurnWithModel(h, {
      threadId: 'thr_1',
      turnId: 'turn_1',
      prompt: 'Inspect repo',
      model: 'gemini-3.6-flash'
    })
    expect(first.outcome).toBe('completed')
    expect(h.calls[0]).not.toContain('--conversation')
    expect(h.calls[0]).toEqual(expect.arrayContaining(['--model', 'gemini-3.6-flash']))

    expect(await h.sessionStore.loadItems('thr_1')).toContainEqual(
      expect.objectContaining({
        turnId: 'turn_1',
        kind: 'assistant_text',
        text: 'First answer from Gemini'
      })
    )

    h.recorded.length = 0
    const second = await runTurnWithModel(h, {
      threadId: 'thr_1',
      turnId: 'turn_2',
      prompt: 'Switch to Orchestrator Carbon',
      model: 'orchestrator-carbon'
    })
    expect(second.outcome).toBe('completed')
    expect(h.calls).toHaveLength(2)

    const turn2Args = h.calls[1]!
    const convIdx = turn2Args.indexOf('--conversation')
    expect(convIdx).toBeGreaterThan(-1)
    expect(turn2Args[convIdx + 1]).toBe('conv-agy-1')
    expect(turn2Args).toEqual(expect.arrayContaining(['--model', 'orchestrator-carbon']))
    expect(String(turn2Args[1] ?? '')).not.toContain('<kun_handoff')

    expect(h.recorded.some((e) => e.kind === 'handoff_injected')).toBe(false)
    expect(h.recorded).toContainEqual(
      expect.objectContaining({
        kind: 'delegated_runtime',
        turnId: 'turn_2',
        phase: 'resumed'
      })
    )
    const binding = await h.coordinator.store.load('thr_1')
    expect(binding).toMatchObject({
      nativeSessionId: 'conv-agy-1',
      model: 'orchestrator-carbon',
      modelScope: 'session',
      generation: 1
    })
  })

  it('continues default -> explicit model and tolerates reasoningEffort changes without capabilities_changed', async () => {
    const h = await setupAntigravityRuntime([
      {
        stdout: JSON.stringify({
          conversation_id: 'conv-agy-default',
          status: 'SUCCESS',
          response: 'Answer on default'
        })
      },
      {
        stdout: JSON.stringify({
          conversation_id: 'conv-agy-default',
          status: 'SUCCESS',
          response: 'Answer on Carbon'
        })
      }
    ])

    await runTurnWithModel(h, {
      threadId: 'thr_default',
      turnId: 'turn_1',
      prompt: 'Start on agent default',
      model: 'default',
      reasoningEffort: 'high'
    })
    expect(h.calls[0]).not.toContain('--model')
    expect(h.calls[0]).toEqual(expect.arrayContaining(['--effort', 'high']))

    h.recorded.length = 0
    const second = await runTurnWithModel(h, {
      threadId: 'thr_default',
      turnId: 'turn_2',
      prompt: 'Now use Carbon with medium effort',
      model: 'orchestrator-carbon',
      reasoningEffort: 'medium'
    })
    expect(second.outcome).toBe('completed')

    const turn2Args = h.calls[1]!
    expect(turn2Args).toEqual(
      expect.arrayContaining([
        '--conversation',
        'conv-agy-default',
        '--model',
        'orchestrator-carbon',
        '--effort',
        'medium'
      ])
    )
    expect(String(turn2Args[1] ?? '')).not.toContain('<kun_handoff')
    expect(h.recorded.some((e) => e.kind === 'handoff_injected')).toBe(false)
    expect(h.recorded).toContainEqual(
      expect.objectContaining({
        kind: 'delegated_runtime',
        turnId: 'turn_2',
        phase: 'resumed'
      })
    )
  })

  it.each([
    {
      label: 'non-zero CLI exit',
      failureStep: { exitCode: 1, stderr: 'conversation conv-agy-stale not found' }
    },
    {
      label: 'conversation_id mismatch',
      failureStep: {
        stdout: JSON.stringify({
          conversation_id: 'conv-other-id',
          status: 'SUCCESS',
          response: 'wrong session'
        })
      }
    }
  ])('calls rejectResume once and retries with a handoff brief on $label', async ({ failureStep }) => {
    const h = await setupAntigravityRuntime([
      {
        stdout: JSON.stringify({
          conversation_id: 'conv-agy-stale',
          status: 'SUCCESS',
          response: 'Initial reply'
        })
      },
      failureStep,
      {
        stdout: JSON.stringify({
          conversation_id: 'conv-agy-fresh-2',
          status: 'SUCCESS',
          response: 'Recovered reply'
        })
      }
    ])

    await runTurnWithModel(h, {
      threadId: 'thr_fallback',
      turnId: 'turn_1',
      prompt: 'Initial prompt',
      model: 'gemini-3.6-flash'
    })

    h.recorded.length = 0
    const second = await runTurnWithModel(h, {
      threadId: 'thr_fallback',
      turnId: 'turn_2',
      prompt: 'Follow-up after switch',
      model: 'orchestrator-carbon'
    })
    expect(second.outcome).toBe('completed')
    // Turn 1 (1 spawn) + Turn 2 failed resume (1 spawn) + Turn 2 rebased retry (1 spawn).
    expect(h.calls).toHaveLength(3)

    const failedResumeArgs = h.calls[1]!
    expect(failedResumeArgs).toEqual(
      expect.arrayContaining(['--conversation', 'conv-agy-stale', '--model', 'orchestrator-carbon'])
    )
    expect(String(failedResumeArgs[1] ?? '')).not.toContain('<kun_handoff')

    const retryArgs = h.calls[2]!
    expect(retryArgs).not.toContain('--conversation')
    expect(retryArgs).toEqual(expect.arrayContaining(['--model', 'orchestrator-carbon']))
    expect(String(retryArgs[1] ?? '')).toContain('<kun_handoff')
    expect(String(retryArgs[1] ?? '')).toContain('Initial prompt')

    expect(h.recorded).toContainEqual(
      expect.objectContaining({
        kind: 'delegated_runtime',
        turnId: 'turn_2',
        phase: 'rebased',
        reason: 'native_state_unavailable'
      })
    )
    expect(h.recorded).toContainEqual(
      expect.objectContaining({
        kind: 'handoff_injected',
        turnId: 'turn_2',
        mode: 'full'
      })
    )
    const binding = await h.coordinator.store.load('thr_fallback')
    expect(binding).toMatchObject({
      nativeSessionId: 'conv-agy-fresh-2',
      generation: 2,
      model: 'orchestrator-carbon'
    })
  })
})
