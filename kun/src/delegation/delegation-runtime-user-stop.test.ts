import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { SubagentsCapabilityConfig } from '../contracts/capabilities.js'
import { createThreadRecord } from '../domain/thread.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { TurnService } from '../services/turn-service.js'
import { DelegationRuntime, FileDelegationStore } from './delegation-runtime.js'

describe('DelegationRuntime user child stop', () => {
  it('aborts only the selected foreground child and persists a user-visible outcome', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-delegation-user-stop-'))
    try {
      const ids = ['child_a', 'child_b']
      const signals = new Map<string, AbortSignal>()
      let releaseSibling = (): void => undefined
      const siblingDone = new Promise<void>((resolve) => {
        releaseSibling = resolve
      })
      const events = { record: vi.fn(async () => undefined) }
      const store = new FileDelegationStore(dir)
      const runtime = new DelegationRuntime({
        config: SubagentsCapabilityConfig.parse({ enabled: true, maxParallel: 2 }),
        store,
        events: events as unknown as RuntimeEventRecorder,
        idGenerator: () => ids.shift() ?? 'child_extra',
        executor: async (input) => {
          signals.set(input.childId, input.signal)
          if (input.childId === 'child_a') {
            await untilAborted(input.signal)
            throw new Error('aborted')
          }
          await siblingDone
          return { summary: 'sibling completed' }
        }
      })

      const selected = runtime.runChild({
        parentThreadId: 'parent',
        parentTurnId: 'turn',
        launcher: 'delegate_task',
        prompt: 'selected work',
        workspace: '/workspace',
        inlineProfile: {
          id: 'general', source: 'builtin',
          profile: { mode: 'subagent', toolPolicy: 'inherit' }
        },
        security: { sandboxRoot: '/workspace', memoryEnabled: false },
        signal: new AbortController().signal
      })
      const sibling = runtime.runChild({
        parentThreadId: 'parent',
        parentTurnId: 'turn',
        launcher: 'delegate_task',
        prompt: 'sibling work',
        signal: new AbortController().signal
      })

      await waitFor(() => signals.size === 2)
      expect(runtime.abortChild('child_a')).toBe(true)
      await waitFor(() => signals.get('child_a')?.aborted === true)
      expect(signals.get('child_b')?.aborted).toBe(false)
      releaseSibling()

      await expect(selected).resolves.toMatchObject({
        id: 'child_a',
        status: 'aborted',
        terminationReason: 'user_stop',
        resumable: true,
        error: 'Subagent was stopped by the user.'
      })
      await expect(sibling).resolves.toMatchObject({
        id: 'child_b',
        status: 'completed',
        summary: 'sibling completed'
      })
      expect(runtime.abortChild('child_a')).toBe(false)
      expect((await store.get('child_a'))?.terminationReason).toBe('user_stop')
      expect(events.record).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'turn_aborted',
        child: expect.objectContaining({
          childId: 'child_a',
          childStatus: 'aborted',
          childTerminationReason: 'user_stop'
        })
      }))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('notifies the parent agent when the user stops a detached child', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-delegation-user-stop-notice-'))
    try {
      const nowIso = () => '2026-08-12T00:00:00.000Z'
      const threadStore = new InMemoryThreadStore()
      const sessionStore = new InMemorySessionStore()
      const eventBus = new InMemoryEventBus()
      const events = new RuntimeEventRecorder({
        eventBus,
        sessionStore,
        allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
        nowIso
      })
      const turns = new TurnService({
        threadStore,
        sessionStore,
        events,
        inflight: new InflightTracker(),
        steering: new SteeringQueue(),
        compactor: new ContextCompactor(),
        ids: new SequentialIdGenerator(),
        nowIso
      })
      const store = new FileDelegationStore(dir)
      let childSignal: AbortSignal | undefined
      const runtime = new DelegationRuntime({
        config: SubagentsCapabilityConfig.parse({ enabled: true, maxParallel: 1 }),
        store,
        events,
        threadStore,
        turns,
        nowIso,
        idGenerator: () => 'child_background',
        executor: async (input) => {
          childSignal = input.signal
          await untilAborted(input.signal)
          throw new Error('aborted')
        }
      })
      await threadStore.upsert(createThreadRecord({
        id: 'parent',
        title: 'Parent',
        workspace: '/ws',
        model: 'test-model'
      }))
      const parentTurn = await turns.startTurn({
        threadId: 'parent',
        request: { prompt: 'start parent' }
      })
      await turns.interruptTurn({ threadId: 'parent', turnId: parentTurn.turnId })
      const runTurn = vi.fn(async () => undefined)
      runtime.bindAgentLoop({ runTurn })

      const queued = await runtime.runChild({
        parentThreadId: 'parent',
        parentTurnId: parentTurn.turnId,
        launcher: 'delegate_task',
        label: 'research',
        prompt: 'background work',
        detach: true,
        signal: new AbortController().signal
      })
      await waitFor(() => childSignal !== undefined)
      expect(runtime.abortChild(queued.id)).toBe(true)
      await waitFor(() => runTurn.mock.calls.length === 1)

      expect(await store.get(queued.id)).toMatchObject({
        status: 'aborted',
        terminationReason: 'user_stop',
        error: 'Subagent was stopped by the user.'
      })
      const parent = await threadStore.get('parent')
      const noticeTurn = parent?.turns.at(-1)
      expect(noticeTurn?.prompt).toContain('<status>aborted</status>')
      expect(noticeTurn?.prompt).toContain('<termination_reason>user_stop</termination_reason>')
      expect(noticeTurn?.items[0]).toMatchObject({
        kind: 'user_message',
        messageSource: 'background_subagent',
        displayText: 'Background subagent research was stopped by the user'
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

async function untilAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return
  await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
