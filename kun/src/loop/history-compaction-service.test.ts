import { describe, expect, it, vi } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { MultiProviderModelClient } from '../adapters/model/multi-provider-model-client.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import { makeUserItem } from '../domain/item.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import type { ModelClient, ModelRequest } from '../ports/model-client.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { UsageService } from '../services/usage-service.js'
import { ContextCompactor } from './context-compactor.js'
import { resolveCoherentProviderAccount } from './compaction-summary.js'
import { HistoryCompactionService } from './history-compaction-service.js'
import type { LoopTelemetry } from './loop-telemetry.js'
import type { ResolvedHook } from '../hooks/hook-engine.js'
import type { ContextCompactionConfig } from './model-context-profile.js'

const threadId = 'thread_compaction_service'
const turnId = 'turn_compaction_service'

function silentModel(): ModelClient {
  return {
    provider: 'test',
    model: 'test-model',
    async *stream() {
      yield { kind: 'completed' as const, stopReason: 'stop' as const }
    }
  }
}

function createEvents(sessionStore: InMemorySessionStore): RuntimeEventRecorder {
  const bus = new InMemoryEventBus()
  return new RuntimeEventRecorder({
    eventBus: bus,
    sessionStore,
    allocateSeq: (id) => bus.allocateSeq(id),
    nowIso: () => '2026-01-01T00:00:00.000Z'
  })
}

async function seedLongHistory(sessionStore: InMemorySessionStore, prefix: string): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await sessionStore.appendItem(threadId, makeUserItem({
      id: `${prefix}_${index}`,
      threadId,
      turnId,
      text: `${prefix} context ${index} ${'x'.repeat(120)}`
    }))
  }
}

function modelCompactionService(
  sessionStore: InMemorySessionStore,
  model: ModelClient,
  contextCompaction: ContextCompactionConfig,
  compactor = new ContextCompactor({ softThreshold: 1, hardThreshold: 2 })
): HistoryCompactionService {
  return new HistoryCompactionService({
    sessionStore,
    compactor,
    prefix: createImmutablePrefix({ systemPrompt: 'stable prefix' }),
    model,
    usage: new UsageService(),
    events: createEvents(sessionStore),
    ids: new SequentialIdGenerator(),
    telemetry: {
      hydratePromptPressureIfCold: async () => undefined,
      consumePromptPressure: () => undefined
    },
    recordGoalUsage: async () => undefined,
    getContextCompaction: () => contextCompaction,
    rewriteThreadItemsFromSession: async () => undefined
  })
}

describe('HistoryCompactionService', () => {
  it('inherits a thread account only when the turn keeps the same provider', () => {
    expect(resolveCoherentProviderAccount({
      turnProviderId: 'ext-other',
      threadProviderId: 'ext-current',
      threadAccountId: 'account-current'
    })).toEqual({ providerId: 'ext-other' })
    expect(resolveCoherentProviderAccount({
      turnProviderId: 'EXT-CURRENT',
      threadProviderId: 'ext-current',
      threadAccountId: 'account-current'
    })).toEqual({ providerId: 'EXT-CURRENT', accountId: 'account-current' })
  })

  it('hydrates pressure, atomically writes the visible marker, then projects and reports it', async () => {
    const sessionStore = new InMemorySessionStore()
    for (let index = 0; index < 5; index += 1) {
      await sessionStore.appendItem(threadId, makeUserItem({
        id: `item_${index}`,
        threadId,
        turnId,
        text: `older context ${index} ${'x'.repeat(120)}`
      }))
    }
    const telemetryCalls: string[] = []
    const telemetry = {
      hydratePromptPressureIfCold: vi.fn(async () => {
        telemetryCalls.push('hydrate')
      }),
      consumePromptPressure: vi.fn(() => {
        telemetryCalls.push('consume')
        return undefined
      })
    } as unknown as Pick<LoopTelemetry, 'hydratePromptPressureIfCold' | 'consumePromptPressure'>
    const effectOrder: string[] = []
    const service = new HistoryCompactionService({
      sessionStore,
      compactor: new ContextCompactor({ softThreshold: 1, hardThreshold: 2 }),
      prefix: createImmutablePrefix({ systemPrompt: 'stable prefix' }),
      model: silentModel(),
      usage: new UsageService(),
      events: createEvents(sessionStore),
      ids: new SequentialIdGenerator(),
      telemetry,
      recordGoalUsage: async () => undefined,
      clearReadTracker: (id) => {
        effectOrder.push(`clear:${id}`)
      },
      rewriteThreadItemsFromSession: async (id) => {
        effectOrder.push(`project:${id}`)
      }
    })

    const history = await service.compactIfNeeded({
      items: await sessionStore.loadItems(threadId),
      model: 'test-model',
      signal: new AbortController().signal,
      threadId,
      turnId
    })

    expect(telemetryCalls).toEqual(['hydrate', 'consume'])
    expect(history[0]).toMatchObject({ kind: 'compaction', id: 'compaction_1' })
    expect(effectOrder).toEqual([`clear:${threadId}`, `project:${threadId}`])
    const persisted = await sessionStore.loadItems(threadId)
    expect(persisted.map((item) => item.id)).toEqual([
      'item_0',
      'item_1',
      'item_2',
      'item_3',
      'compaction_1',
      'item_4'
    ])
    await expect(sessionStore.loadEventsSince(threadId, 0)).resolves.toEqual([
      expect.objectContaining({ kind: 'compaction_completed', itemId: 'compaction_1' })
    ])
  })

  it('does not emit another automatic marker when only the prior summary is foldable', async () => {
    const sessionStore = new InMemorySessionStore()
    await seedLongHistory(sessionStore, 'repeat_guard')
    const rewriteThreadItemsFromSession = vi.fn(async () => undefined)
    const service = new HistoryCompactionService({
      sessionStore,
      compactor: new ContextCompactor({ softThreshold: 1, hardThreshold: 2 }),
      prefix: createImmutablePrefix({ systemPrompt: 'stable prefix' }),
      model: silentModel(),
      usage: new UsageService(),
      events: createEvents(sessionStore),
      ids: new SequentialIdGenerator(),
      telemetry: {
        hydratePromptPressureIfCold: async () => undefined,
        consumePromptPressure: () => undefined
      },
      recordGoalUsage: async () => undefined,
      rewriteThreadItemsFromSession
    })
    const request = {
      model: 'test-model',
      signal: new AbortController().signal,
      threadId,
      turnId
    }

    const compacted = await service.compactIfNeeded({
      ...request,
      items: await sessionStore.loadItems(threadId)
    })
    const unchanged = await service.compactIfNeeded({ ...request, items: compacted })

    expect(unchanged).toEqual(compacted)
    expect(rewriteThreadItemsFromSession).toHaveBeenCalledTimes(1)
    const events = await sessionStore.loadEventsSince(threadId, 0)
    expect(events.filter((event) => event.kind === 'compaction_completed')).toHaveLength(1)
    expect((await sessionStore.loadItems(threadId)).filter((item) => item.kind === 'compaction')).toHaveLength(1)
  })

  it('only consumes the pending prompt-pressure signal when no compaction is needed', async () => {
    const sessionStore = new InMemorySessionStore()
    const item = makeUserItem({ id: 'item_only', threadId, turnId, text: 'short' })
    const telemetry = {
      hydratePromptPressureIfCold: vi.fn(async () => undefined),
      consumePromptPressure: vi.fn(() => undefined)
    } as unknown as Pick<LoopTelemetry, 'hydratePromptPressureIfCold' | 'consumePromptPressure'>
    const rewriteThreadItemsFromSession = vi.fn(async () => undefined)
    const service = new HistoryCompactionService({
      sessionStore,
      compactor: new ContextCompactor({ softThreshold: 1_000_000, hardThreshold: 1_100_000 }),
      prefix: createImmutablePrefix({ systemPrompt: 'stable prefix' }),
      model: silentModel(),
      usage: new UsageService(),
      events: createEvents(sessionStore),
      ids: new SequentialIdGenerator(),
      telemetry,
      recordGoalUsage: async () => undefined,
      rewriteThreadItemsFromSession
    })

    const inputItems = [item]
    const history = await service.compactIfNeeded({
      items: inputItems,
      model: 'test-model',
      signal: new AbortController().signal,
      threadId,
      turnId
    })

    expect(history).toBe(inputItems)
    expect(history).toEqual([item])
    expect(telemetry.hydratePromptPressureIfCold).toHaveBeenCalledWith(threadId, 'test-model')
    expect(telemetry.consumePromptPressure).toHaveBeenCalledWith(threadId, 'test-model')
    expect(rewriteThreadItemsFromSession).not.toHaveBeenCalled()
    await expect(sessionStore.loadItems(threadId)).resolves.toEqual([])
  })

  it('reads hooks and model-summary settings lazily after construction', async () => {
    const sessionStore = new InMemorySessionStore()
    for (let index = 0; index < 5; index += 1) {
      await sessionStore.appendItem(threadId, makeUserItem({
        id: `live_item_${index}`,
        threadId,
        turnId,
        text: index === 4
          ? `Active Skill: retained-auto-tail-only\nlive runtime config ${index} ${'x'.repeat(120)}`
          : `live runtime config ${index} ${'x'.repeat(120)}`
      }))
    }
    const requests: ModelRequest[] = []
    const model: ModelClient = {
      provider: 'test',
      model: 'initial-model',
      async *stream(request) {
        requests.push(request)
        yield { kind: 'assistant_text_delta' as const, text: 'summary from live config' }
        yield { kind: 'completed' as const, stopReason: 'stop' as const }
      }
    }
    const seenPreCompact = vi.fn()
    let hooks: readonly ResolvedHook[] | undefined
    let contextCompaction: ContextCompactionConfig | undefined
    const service = new HistoryCompactionService({
      sessionStore,
      compactor: new ContextCompactor({ softThreshold: 1, hardThreshold: 2 }),
      prefix: createImmutablePrefix({ systemPrompt: 'stable prefix' }),
      model,
      usage: new UsageService(),
      events: createEvents(sessionStore),
      ids: new SequentialIdGenerator(),
      telemetry: {
        hydratePromptPressureIfCold: async () => undefined,
        consumePromptPressure: () => undefined
      },
      recordGoalUsage: async () => undefined,
      getHooks: () => hooks,
      getContextCompaction: () => contextCompaction,
      rewriteThreadItemsFromSession: async () => undefined
    })

    hooks = [{ phase: 'PreCompact', run: seenPreCompact }]
    contextCompaction = { summaryMode: 'model', summaryModel: 'live-summary-model' }
    const history = await service.compactIfNeeded({
      items: await sessionStore.loadItems(threadId),
      model: 'main-model',
      signal: new AbortController().signal,
      threadId,
      turnId
    })

    expect(seenPreCompact).toHaveBeenCalledWith(expect.objectContaining({ phase: 'PreCompact' }))
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ model: 'live-summary-model' })
    const summaryUserMessages = requests[0]?.history
      .filter((item) => item.kind === 'user_message')
      .map((item) => item.text) ?? []
    expect(summaryUserMessages.some((text) => text.includes('live runtime config 0'))).toBe(true)
    expect(summaryUserMessages.some((text) => text.includes('live runtime config 4'))).toBe(false)
    const continuation = summaryUserMessages.at(-1) ?? ''
    expect(continuation).toContain('Provide a detailed summary of our conversation above')
    expect(continuation).not.toContain('Active Skill: retained-auto-tail-only')
    expect(history[0]).toMatchObject({ kind: 'compaction', summary: expect.stringContaining('summary from live config') })
  })

  it('uses the heuristic summary when folded source ids are unavailable instead of sending the retained tail', async () => {
    const sessionStore = new InMemorySessionStore()
    await seedLongHistory(sessionStore, 'missing_source')
    const requests: ModelRequest[] = []
    const model: ModelClient = {
      provider: 'test',
      model: 'summary-model',
      async *stream(request) {
        requests.push(request)
        yield { kind: 'assistant_text_delta' as const, text: 'this must not be used' }
        yield { kind: 'completed' as const, stopReason: 'stop' as const }
      }
    }
    const compactor = new ContextCompactor({ softThreshold: 1, hardThreshold: 2 })
    const compact = compactor.compact.bind(compactor)
    vi.spyOn(compactor, 'compact').mockImplementation((input) => {
      const result = compact(input)
      if (result.summaryItem.kind !== 'compaction') return result
      return {
        ...result,
        summaryItem: { ...result.summaryItem, sourceItemIds: undefined }
      }
    })
    const service = modelCompactionService(
      sessionStore,
      model,
      { summaryMode: 'model' },
      compactor
    )

    await service.compactIfNeeded({
      items: await sessionStore.loadItems(threadId),
      model: 'summary-model',
      signal: new AbortController().signal,
      threadId,
      turnId
    })

    expect(requests).toHaveLength(0)
    const events = await sessionStore.loadEventsSince(threadId, 0)
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'error',
      code: 'compaction_summary_fallback',
      message: expect.stringContaining('no folded source items')
    }))
  })

  it('charges model-summary usage to the active Goal before the main-model budget recheck', async () => {
    const sessionStore = new InMemorySessionStore()
    await seedLongHistory(sessionStore, 'goal_budget')
    const recordGoalUsage = vi.fn(async () => undefined)
    const model: ModelClient = {
      provider: 'test',
      model: 'summary-model',
      async *stream() {
        yield {
          kind: 'usage' as const,
          usage: {
            promptTokens: 8,
            completionTokens: 3,
            totalTokens: 11,
            cacheHitRate: null,
            turns: 1
          }
        }
        yield { kind: 'assistant_text_delta' as const, text: 'goal-aware summary' }
        yield { kind: 'completed' as const, stopReason: 'stop' as const }
      }
    }
    const service = new HistoryCompactionService({
      sessionStore,
      compactor: new ContextCompactor({ softThreshold: 1, hardThreshold: 2 }),
      prefix: createImmutablePrefix({ systemPrompt: 'stable prefix' }),
      model,
      usage: new UsageService(),
      events: createEvents(sessionStore),
      ids: new SequentialIdGenerator(),
      telemetry: {
        hydratePromptPressureIfCold: async () => undefined,
        consumePromptPressure: () => undefined
      },
      recordGoalUsage,
      getContextCompaction: () => ({ summaryMode: 'model' }),
      rewriteThreadItemsFromSession: async () => undefined
    })

    await service.compactIfNeeded({
      items: await sessionStore.loadItems(threadId),
      model: 'summary-model',
      signal: new AbortController().signal,
      threadId,
      turnId
    })

    expect(recordGoalUsage).toHaveBeenCalledTimes(1)
    expect(recordGoalUsage).toHaveBeenCalledWith(threadId, 11)
  })

  it('routes the full compaction history through the current provider and account instead of default', async () => {
    const sessionStore = new InMemorySessionStore()
    await seedLongHistory(sessionStore, 'private_extension')
    const defaultRequests: ModelRequest[] = []
    const extensionRequests: ModelRequest[] = []
    const defaultModel: ModelClient = {
      provider: 'default-spy',
      model: 'default-model',
      async *stream(request) {
        defaultRequests.push(request)
        yield { kind: 'assistant_text_delta' as const, text: 'wrong provider' }
        yield { kind: 'completed' as const, stopReason: 'stop' as const }
      }
    }
    const extensionModel: ModelClient = {
      provider: 'ext-private',
      model: 'extension-model',
      async *stream(request) {
        extensionRequests.push(request)
        yield { kind: 'assistant_text_delta' as const, text: 'private provider summary' }
        yield { kind: 'completed' as const, stopReason: 'stop' as const }
      }
    }
    const model = new MultiProviderModelClient({
      default: defaultModel,
      providers: new Map([['ext-private', extensionModel]])
    })
    const service = modelCompactionService(sessionStore, model, {
      summaryMode: 'model',
      summaryModel: 'extension-summary-model'
    })

    const history = await service.compactIfNeeded({
      items: await sessionStore.loadItems(threadId),
      model: 'main-extension-model',
      providerId: 'ext-private',
      accountId: 'account-private',
      signal: new AbortController().signal,
      threadId,
      turnId
    })

    expect(defaultRequests).toEqual([])
    expect(extensionRequests).toHaveLength(1)
    expect(extensionRequests[0]).toMatchObject({
      model: 'extension-summary-model',
      providerId: 'ext-private',
      accountId: 'account-private'
    })
    expect(history[0]).toMatchObject({
      kind: 'compaction',
      summary: expect.stringContaining('private provider summary')
    })
  })

  it('fails closed before any provider sees history when an explicit summary provider mismatches the active account', async () => {
    const sessionStore = new InMemorySessionStore()
    await seedLongHistory(sessionStore, 'mismatched_account')
    const defaultRequests: ModelRequest[] = []
    const otherProviderRequests: ModelRequest[] = []
    const model = new MultiProviderModelClient({
      default: {
        provider: 'default-spy',
        model: 'default-model',
        async *stream(request) {
          defaultRequests.push(request)
          yield { kind: 'completed' as const, stopReason: 'stop' as const }
        }
      },
      providers: new Map([['ext-other', {
        provider: 'ext-other',
        model: 'other-model',
        async *stream(request) {
          otherProviderRequests.push(request)
          yield { kind: 'completed' as const, stopReason: 'stop' as const }
        }
      } satisfies ModelClient]])
    })
    const service = modelCompactionService(sessionStore, model, {
      summaryMode: 'model',
      summaryModel: 'other-model',
      summaryProviderId: 'ext-other'
    })

    const history = await service.compactIfNeeded({
      items: await sessionStore.loadItems(threadId),
      model: 'main-model',
      providerId: 'ext-current',
      accountId: 'account-current',
      signal: new AbortController().signal,
      threadId,
      turnId
    })

    expect(defaultRequests).toEqual([])
    expect(otherProviderRequests).toEqual([])
    expect(history[0]).toMatchObject({ kind: 'compaction' })
    const events = await sessionStore.loadEventsSince(threadId, 0)
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'error',
      code: 'compaction_summary_fallback',
      message: expect.stringContaining('does not match the active account binding')
    }))
  })

  it('routes an accountless explicit extension provider exactly once and never falls back to default', async () => {
    const sessionStore = new InMemorySessionStore()
    await seedLongHistory(sessionStore, 'missing_account')
    const defaultRequests: ModelRequest[] = []
    const routedRequests: ModelRequest[] = []
    let providerTransportCalls = 0
    const accountRequiredProvider: ModelClient = {
      provider: 'ext-account-required',
      model: 'account-model',
      async *stream(request) {
        routedRequests.push(request)
        if (!request.accountId) throw new Error('account is required before extension provider transport')
        providerTransportCalls += 1
        yield { kind: 'completed' as const, stopReason: 'stop' as const }
      }
    }
    const model = new MultiProviderModelClient({
      default: {
        provider: 'default-spy',
        model: 'default-model',
        async *stream(request) {
          defaultRequests.push(request)
          yield { kind: 'completed' as const, stopReason: 'stop' as const }
        }
      },
      providers: new Map([['ext-account-required', accountRequiredProvider]])
    })
    const service = modelCompactionService(sessionStore, model, {
      summaryMode: 'model',
      summaryModel: 'account-model',
      summaryProviderId: 'ext-account-required'
    })

    await service.compactIfNeeded({
      items: await sessionStore.loadItems(threadId),
      model: 'main-model',
      providerId: 'ext-current',
      signal: new AbortController().signal,
      threadId,
      turnId
    })

    expect(defaultRequests).toEqual([])
    expect(routedRequests).toHaveLength(1)
    expect(routedRequests[0]).toMatchObject({ providerId: 'ext-account-required' })
    expect(routedRequests[0]?.accountId).toBeUndefined()
    expect(providerTransportCalls).toBe(0)
    const events = await sessionStore.loadEventsSince(threadId, 0)
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'error',
      code: 'compaction_summary_fallback',
      message: expect.stringContaining('account is required before extension provider transport')
    }))
  })
})
