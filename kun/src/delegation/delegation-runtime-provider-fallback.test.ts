import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { LocalToolHost, echoTool } from '../adapters/tool/local-tool-host.js'
import { MultiProviderModelClient } from '../adapters/model/multi-provider-model-client.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import { SubagentsCapabilityConfig } from '../contracts/capabilities.js'
import { emptyUsageSnapshot } from '../contracts/usage.js'
import type { ChildRunFailure } from '../contracts/subagent-retry.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import { UsageService } from '../services/usage-service.js'
import { createChildAgentExecutor } from './child-agent-executor.js'
import { ChildResultExecutionError } from './child-result-materializer.js'
import { DelegationRuntime, FileDelegationStore, type ChildRunExecutor } from './delegation-runtime.js'
import { buildFastContextToolProvider } from '../adapters/tool/fast-context-tool-provider.js'
import type { ToolHostContext } from '../ports/tool-host.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const config = () => SubagentsCapabilityConfig.parse({ enabled: true, maxParallel: 1,
  profiles: { general: { model: 'child-model', providerId: 'broken', toolPolicy: 'inherit' } }
})
const common = () => ({
  parentThreadId: 'parent', parentTurnId: 'parent-turn', launcher: 'delegate_task' as const,
  prompt: 'Inspect once and summarize.', profile: 'general', workspace: '/tmp/workspace',
  inheritedModel: 'parent-model', inheritedProviderId: 'parent-provider', inheritedAccountId: 'parent-account',
  inheritedReasoningEffort: 'high', inheritedServiceTier: 'priority' as const,
  security: { sandboxRoot: '/tmp/workspace', memoryEnabled: false }, signal: new AbortController().signal
})
async function setup(executor: ChildRunExecutor) {
  const root = await mkdtemp(join(tmpdir(), 'kun-child-provider-fallback-')); roots.push(root)
  const store = new FileDelegationStore(root)
  const recordExternalUsage = vi.fn()
  const runtime = new DelegationRuntime({ config: config(), store, executor, recordExternalUsage })
  return { runtime, store, recordExternalUsage }
}
function fail(failure: ChildRunFailure, tokens = 0): never {
  throw new ChildResultExecutionError('provider rejected request', { summary: 'partial' }, {
    failure, usage: { promptTokens: tokens, completionTokens: 0, totalTokens: tokens }, toolInvocations: 0
  })
}

describe('automatic child provider fallback', () => {
  it.each(['authentication', 'quota', 'rate_limit', 'network', 'timeout', 'unavailable', 'model_not_found', 'request'] as const)(
    'falls back once for %s and persists the actual route without changing its profile', async (category) => {
      const executor = vi.fn<ChildRunExecutor>().mockImplementationOnce(async () => fail({ source: 'model', category }, 7))
        .mockResolvedValue({ summary: 'recovered', usage: { promptTokens: 10, completionTokens: 0, totalTokens: 10 } })
      const { runtime, store, recordExternalUsage } = await setup(executor)
      const onRunning = vi.fn()
      const result = await runtime.runChild({ ...common(), onRunning })
      expect(result).toMatchObject({ status: 'completed', model: 'parent-model', providerId: 'parent-provider',
        accountId: 'parent-account', reasoningEffort: 'high', serviceTier: 'priority',
        providerFallback: { from: { providerId: 'broken' }, to: { providerId: 'parent-provider' }, failure: { category } },
        profileSnapshot: { model: 'child-model', providerId: 'broken' }, usage: { totalTokens: 10 } })
      expect(await store.get(result.id)).toEqual(result)
      expect(executor).toHaveBeenCalledTimes(2)
      const next = executor.mock.calls[1]![0]
      expect(next).toMatchObject({ childId: result.id, resumeChild: true, model: 'parent-model', providerId: 'parent-provider',
        accountId: 'parent-account', toolPolicy: 'inherit', security: common().security })
      expect(onRunning.mock.calls.map((call) => call[2]?.model)).toEqual(['child-model', 'parent-model'])
      expect(recordExternalUsage.mock.calls.map((call) => [call[1].totalTokens, call[2].providerId])).toEqual([[7, 'broken'], [3, 'parent-provider']])
    })

  it.each(['runtime', 'contract'] as const)('does not switch providers for a %s failure', async (source) => {
    const executor = vi.fn<ChildRunExecutor>(async () => fail({ source, code: 'turn_step_limit' }))
    const { runtime } = await setup(executor)
    expect((await runtime.runChild(common())).providerFallback).toBeUndefined()
    expect(executor).toHaveBeenCalledTimes(1)
  })

  it('does not rerun the same route or bypass model authority', async () => {
    for (const overrides of [
      { inheritedModel: 'child-model', inheritedProviderId: 'BROKEN' },
      { inheritedModel: undefined },
      { security: { ...common().security, allowedModelProviderIds: ['broken'] } },
      { security: { ...common().security, allowedModelIds: ['child-model'] } }
    ]) {
      const executor = vi.fn<ChildRunExecutor>(async () => fail({ source: 'model', category: 'request' }))
      const { runtime } = await setup(executor)
      expect((await runtime.runChild({ ...common(), ...overrides })).providerFallback).toBeUndefined()
      expect(executor).toHaveBeenCalledTimes(1)
    }
  })

  it('honors cancellation before fallback', async () => {
    const controller = new AbortController()
    const executor = vi.fn<ChildRunExecutor>(async () => { controller.abort(); fail({ source: 'model', category: 'network' }) })
    const { runtime } = await setup(executor)
    expect((await runtime.runChild({ ...common(), signal: controller.signal })).status).toBe('aborted')
    expect(executor).toHaveBeenCalledTimes(1)
  })

  it('retains both failures and never loops if the parent provider also fails, including resume', async () => {
    const executor = vi.fn<ChildRunExecutor>(async () => fail({ source: 'model', category: 'quota' }))
    const { runtime, store } = await setup(executor)
    const first = await runtime.runChild(common())
    expect(first).toMatchObject({ status: 'failed', providerId: 'parent-provider',
      failure: { category: 'quota' }, providerFallback: { failure: { category: 'quota' } } })
    expect(executor).toHaveBeenCalledTimes(2)
    const cold = new DelegationRuntime({ config: config(), store, executor })
    await cold.resumeChild({ childId: first.id, parentThreadId: 'parent', parentTurnId: 'resume', prompt: 'Continue.', signal: common().signal })
    expect(executor).toHaveBeenCalledTimes(3)
    expect(executor.mock.calls[2]![0].providerId).toBe('parent-provider')
  })

  it.each(['metadata', 'legacy', 'disconnect'])('preserves history, usage and evidence across a mid-task failure (%s)', async (variant) => {
    const requests: ModelRequest[] = []
    const usage = new UsageService()
    let round = 0
    const model: ModelClient = { provider: 'test', model: 'default',
      async *stream(request): AsyncIterable<ModelStreamChunk> {
        requests.push(request)
        yield { kind: 'usage', usage: { ...emptyUsageSnapshot(), promptTokens: 10, totalTokens: 10, turns: 1 } }
        if (request.providerId === 'broken') {
          if (++round === 1) {
            yield { kind: 'tool_call_complete', callId: 'echo-once', toolName: 'echo', arguments: { text: 'evidence before failure' } }
            yield { kind: 'completed', stopReason: 'tool_calls' }; return
          }
          yield { kind: 'error', code: variant === 'disconnect' ? 'stream_read_error' : 'http_400', message: 'MissingSessionID', ...(variant === 'metadata' ? { failure: { category: 'request' as const, httpStatus: 400, failoverAllowed: false } } : {}) }; return
        }
        yield { kind: 'assistant_text_delta', text: 'Recovered using prior evidence.' }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const sessionStore = new InMemorySessionStore(), threadStore = new InMemoryThreadStore()
    const execute = vi.fn(echoTool.execute)
    const executor = createChildAgentExecutor({ model, usage, sessionStore, threadStore,
      toolHost: new LocalToolHost({ tools: [{ ...echoTool, execute }] }),
      prefix: createImmutablePrefix({ systemPrompt: 'test' }), defaultModel: 'default' })
    const { runtime } = await setup(executor)
    const result = await runtime.runChild({ ...common(), returnFormat: 'evidence' })
    expect(result).toMatchObject({ status: 'completed', usage: { totalTokens: 30 }, toolInvocations: 1 })
    expect(result.evidence?.[0]).toContain('echo')
    expect(execute).toHaveBeenCalledTimes(1)
    const thread = await threadStore.get(result.id)
    expect(thread?.turns).toHaveLength(2)
    expect(thread?.turns.map((turn) => turn.providerId)).toEqual(['broken', 'parent-provider'])
    expect(requests[2]?.history.some((item) => item.kind === 'tool_result')).toBe(true)
    expect(requests[2]).toMatchObject({ model: 'parent-model', providerId: 'parent-provider', accountId: 'parent-account' })
  })

  it('falls back for detached children without allocating a replacement child', async () => {
    const executor = vi.fn<ChildRunExecutor>().mockImplementationOnce(async () => fail({ source: 'model', category: 'network' }))
      .mockResolvedValue({ summary: 'done in background' })
    const { runtime, store } = await setup(executor)
    const queued = await runtime.runChild({ ...common(), detach: true })
    await vi.waitFor(async () => expect(await store.get(queued.id)).toMatchObject({
      status: 'completed', detached: true, providerId: 'parent-provider'
    }))
    expect(executor).toHaveBeenCalledTimes(2)
    expect(executor.mock.calls.every(([input]) => input.childId === queued.id)).toBe(true)
  })

  it('uses provider-native parent execution after an HTTP child fails', async () => {
    const model: ModelClient = { provider: 'test', model: 'child-model', async *stream(): AsyncIterable<ModelStreamChunk> {
      yield { kind: 'error', code: 'http_401', message: 'Unauthorized' }
    } }
    const nativeRun = vi.fn()
    const executor = createChildAgentExecutor({ model,
      toolHost: new LocalToolHost({ tools: [] }), prefix: createImmutablePrefix({ systemPrompt: 'test' }), defaultModel: 'child-model',
      createDelegatedRuntime: ({ turns, threadStore }) => ({
        handlesProvider: (id) => id === 'parent-provider', capabilities: () => undefined,
        async runTurn(threadId, turnId) {
          nativeRun((await threadStore.get(threadId))?.turns.at(-1))
          await turns.finishTurn({ threadId, turnId, status: 'completed' })
          return 'completed'
        }
      })
    })
    const { runtime } = await setup(executor)
    const record = await runtime.runChild(common())
    expect(record.status).toBe('completed')
    expect(nativeRun).toHaveBeenCalledTimes(1)
    expect(nativeRun.mock.calls[0]?.[0]).toMatchObject({ model: 'parent-model', providerId: 'parent-provider', accountId: 'parent-account' })
  })

  it('recovers Fast Context from a missing configured provider using the acting parent route', async () => {
    const parent: ModelClient = { provider: 'test', model: 'parent-model', async *stream(): AsyncIterable<ModelStreamChunk> {
      yield { kind: 'assistant_text_delta', text: 'Task 1: No evidence found.' }; yield { kind: 'completed', stopReason: 'stop' }
    } }
    const model = new MultiProviderModelClient({ default: parent, providers: new Map([['parent-provider', parent]]) })
    const executor = createChildAgentExecutor({ model, sessionStore: new InMemorySessionStore(), threadStore: new InMemoryThreadStore(),
      toolHost: new LocalToolHost({ tools: [] }), prefix: createImmutablePrefix({ systemPrompt: 'test' }), defaultModel: 'default' })
    const { runtime } = await setup(executor)
    const tool = buildFastContextToolProvider(runtime, () => ({ model: 'missing', providerId: 'missing-provider' }))[0]!.tools[0]!
    const result = await tool.execute({ tasks: [{ title: 'Find', query: 'Find an entry.' }] }, {
      threadId: 'parent', turnId: 'turn', workspace: '/tmp/workspace', approvalPolicy: 'auto',
      abortSignal: common().signal, actingModelRoute: { model: 'parent-model', providerId: 'parent-provider', accountId: 'parent-account' }
    } as ToolHostContext)
    expect(result).toMatchObject({ isError: false, output: { status: 'completed', model: 'parent-model',
      providerFallback: { from: { providerId: 'missing-provider' }, to: { providerId: 'parent-provider' } } } })
  })
})
