import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { createChildAgentExecutor } from './child-agent-executor.js'
import { DelegationRuntime, FileDelegationStore, type ChildRunExecutor } from './delegation-runtime.js'

class AbortAwareModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'abort-aware-child-model'
  readonly requests: ModelRequest[] = []
  abortObserved = false
  private readonly streamStartedListeners: Array<() => void> = []

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    for (const listener of this.streamStartedListeners.splice(0)) listener()
    if (!request.abortSignal.aborted) {
      await new Promise<void>((resolve) => {
        request.abortSignal.addEventListener('abort', () => resolve(), { once: true })
      })
    }
    this.abortObserved = request.abortSignal.aborted
  }

  waitForStreamStart(): Promise<void> {
    if (this.requests.length > 0) return Promise.resolve()
    return new Promise((resolve) => this.streamStartedListeners.push(resolve))
  }
}

describe('createChildAgentExecutor', () => {
  it('aborts the child model stream when the parent delegation signal is aborted', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-07-08T00:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const model = new AbortAwareModel()
    const executor = createChildAgentExecutor({
      model,
      toolHost: new LocalToolHost({ tools: [] }),
      prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
      defaultModel: model.model,
      approvalPolicy: 'auto',
      sessionStore,
      threadStore,
      events,
      nowIso
    })
    const parent = new AbortController()
    const run = executor({
      childId: 'child_abort',
      parentThreadId: 'thr_parent',
      parentTurnId: 'turn_parent',
      prompt: 'keep streaming until interrupted',
      workspace: '/tmp/workspace',
      toolPolicy: 'readOnly',
      signal: parent.signal
    })

    await model.waitForStreamStart()
    parent.abort()
    const result = await Promise.race([
      run.then(
        () => 'resolved' as const,
        () => 'rejected' as const
      ),
      new Promise<'timed_out'>((resolve) => setTimeout(() => resolve('timed_out'), 500))
    ])

    expect(result).toBe('rejected')
    expect(model.abortObserved).toBe(true)
    expect((await threadStore.get('child_abort'))?.status).toBe('idle')
    expect((await threadStore.get('child_abort'))?.turns[0]?.status).toBe('aborted')
  })
})

describe('DelegationRuntime detached children', () => {
  it('keeps a background child running when the parent signal is aborted', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'kun-delegation-'))
    try {
      let childSignal: AbortSignal | undefined
      let resolveStarted: () => void = () => {}
      const started = new Promise<void>((resolve) => {
        resolveStarted = resolve
      })
      const executor: ChildRunExecutor = async (input) => {
        childSignal = input.signal
        resolveStarted()
        if (!input.signal.aborted) {
          await new Promise<void>((abortResolve) => {
            input.signal.addEventListener('abort', () => abortResolve(), { once: true })
          })
        }
        throw new Error('child aborted')
      }
      const runtime = new DelegationRuntime({
        config: {
          enabled: true,
          maxParallel: 1,
          maxChildRuns: 10,
          defaultToolPolicy: 'readOnly',
          profiles: {}
        },
        store: new FileDelegationStore(tempDir),
        idGenerator: () => 'child_detached',
        nowIso: () => '2026-07-08T00:00:00.000Z',
        executor
      })
      const parent = new AbortController()

      const queued = await runtime.runChild({
        parentThreadId: 'thr_parent',
        parentTurnId: 'turn_parent',
        prompt: 'background work',
        detach: true,
        signal: parent.signal
      })
      expect(queued.status).toBe('queued')
      await started

      parent.abort()
      await delay(20)
      expect(childSignal?.aborted).toBe(false)
      expect((await runtime.diagnostics('thr_parent')).childRuns[0]?.status).toBe('running')

      expect(runtime.abortChild('child_detached')).toBe(true)
      await waitFor(async () => {
        const status = (await runtime.diagnostics('thr_parent')).childRuns[0]?.status
        expect(status).toBe('aborted')
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(assertion: () => void | Promise<void>): Promise<void> {
  const deadline = Date.now() + 500
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      await assertion()
      return
    } catch (error) {
      lastError = error
      await delay(10)
    }
  }
  if (lastError) throw lastError
}
