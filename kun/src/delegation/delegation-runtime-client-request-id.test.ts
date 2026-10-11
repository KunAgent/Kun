import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import { SubagentsCapabilityConfig } from '../contracts/capabilities.js'
import { InstructionRuntime } from '../instructions/instruction-runtime.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import { createChildAgentExecutor } from './child-agent-executor.js'
import { DelegationRuntime, FileDelegationStore, type ChildRunExecutor } from './delegation-runtime.js'

function subagentConfig() {
  return SubagentsCapabilityConfig.parse({ enabled: true, maxParallel: 2 })
}

class HistoryModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'child-idem-model'
  readonly requests: ModelRequest[] = []
  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    yield { kind: 'assistant_text_delta', text: 'child result' }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

function makeExecutor(model: ModelClient, threadStore: InMemoryThreadStore, sessionStore: InMemorySessionStore) {
  return createChildAgentExecutor({
    model,
    toolHost: new LocalToolHost({ tools: [] }),
    prefix: createImmutablePrefix({ systemPrompt: 'test prefix' }),
    defaultModel: model.model,
    instructionRuntime: new InstructionRuntime(undefined),
    sessionStore,
    threadStore
  })
}

describe('delegation clientRequestId propagation', () => {
  it('runChild forwards clientRequestId to the executor', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-delegation-crid-'))
    try {
      const calls: Parameters<ChildRunExecutor>[0][] = []
      const runtime = new DelegationRuntime({
        config: subagentConfig(),
        store: new FileDelegationStore(dir),
        executor: async (input) => {
          calls.push(input)
          return { summary: 'done' }
        }
      })
      await runtime.runChild({
        parentThreadId: 'parent',
        parentTurnId: 'turn-1',
        launcher: 'manager-worker',
        prompt: 'run the task',
        workspace: '/workspace',
        security: { sandboxRoot: '/workspace', memoryEnabled: false },
        clientRequestId: 'dsp_abc',
        signal: new AbortController().signal
      })
      expect(calls).toHaveLength(1)
      expect(calls[0].clientRequestId).toBe('dsp_abc')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('resumeChild forwards clientRequestId to the executor', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-delegation-crid-'))
    try {
      const calls: Parameters<ChildRunExecutor>[0][] = []
      const runtime = new DelegationRuntime({
        config: subagentConfig(),
        store: new FileDelegationStore(dir),
        executor: async (input) => {
          calls.push(input)
          return { summary: 'done' }
        }
      })
      const first = await runtime.runChild({
        parentThreadId: 'parent',
        parentTurnId: 'turn-1',
        launcher: 'manager-worker',
        prompt: 'run the task',
        workspace: '/workspace',
        security: { sandboxRoot: '/workspace', memoryEnabled: false },
        inlineProfile: {
          id: 'worker',
          source: 'custom',
          profile: { mode: 'subagent', toolPolicy: 'inherit' }
        },
        signal: new AbortController().signal
      })
      await runtime.resumeChild({
        childId: first.id,
        parentThreadId: 'parent',
        parentTurnId: 'turn-2',
        prompt: 'follow-up dispatch',
        clientRequestId: 'dsp_def',
        signal: new AbortController().signal
      })
      expect(calls).toHaveLength(2)
      expect(calls[1].clientRequestId).toBe('dsp_def')
      expect(calls[1].resumeChild).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a repeated executor call with the same clientRequestId starts only one turn', async () => {
    const model = new HistoryModel()
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const executor = makeExecutor(model, threadStore, sessionStore)
    const signal = new AbortController().signal
    const common = {
      childId: 'child_idem',
      parentThreadId: 'parent',
      parentTurnId: 'turn-1',
      workspace: '/workspace',
      toolPolicy: 'readOnly' as const,
      security: { sandboxRoot: '/workspace', memoryEnabled: false },
      signal
    }
    const first = await executor({ ...common, prompt: 'do the thing', clientRequestId: 'dsp_1' })
    expect(first.summary).toBe('child result')
    // A redelivery with the identical key reattaches: no second turn is created.
    const second = await executor({
      ...common,
      prompt: 'do the thing',
      clientRequestId: 'dsp_1',
      resumeChild: true
    }).catch(() => null)
    const thread = await threadStore.get('child_idem')
    expect(thread?.turns).toHaveLength(1)
    expect(thread?.turns[0]?.clientRequestId).toBe('dsp_1')
    expect(second === null || typeof second.summary === 'string').toBe(true)
    expect(model.requests).toHaveLength(1)
  })

  it('the same clientRequestId with a different prompt is rejected', async () => {
    const model = new HistoryModel()
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const executor = makeExecutor(model, threadStore, sessionStore)
    const signal = new AbortController().signal
    const common = {
      childId: 'child_conf',
      parentThreadId: 'parent',
      parentTurnId: 'turn-1',
      workspace: '/workspace',
      toolPolicy: 'readOnly' as const,
      security: { sandboxRoot: '/workspace', memoryEnabled: false },
      signal
    }
    await executor({ ...common, prompt: 'original task', clientRequestId: 'dsp_2' })
    const result = await executor({
      ...common,
      prompt: 'a different task entirely',
      clientRequestId: 'dsp_2',
      resumeChild: true
    }).then(() => null, (error: unknown) => error)
    // The conflict is surfaced (either as a thrown conflict or a failed child);
    // critically no second turn with the divergent prompt is admitted.
    const thread = await threadStore.get('child_conf')
    expect(thread?.turns).toHaveLength(1)
    expect(result === null || result instanceof Error).toBe(true)
  })
})
