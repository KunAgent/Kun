import { describe, expect, it, vi } from 'vitest'
import {
  chatBlockFromItem,
  dispatchKunRuntimeEvent,
  dispatchKunRuntimeEvents,
  mergeChatBlocks,
  runtimeProjectionActionsFromEvent,
  threadFromCore
} from './kun-mapper'
import type { CoreRuntimeEventJson, CoreTurnItemJson } from './kun-contract'
import type { ThreadErrorOptions, ThreadEventSink } from './types'
import {
  PRESENTATION_STUDIO_EXTENSION_ID,
  presentationStudioCanonicalToolId,
  presentationStudioModelAlias
} from '@shared/presentation-artifact'

function makeSink(): ThreadEventSink {
  return {
    onSeq: () => undefined,
    onDeltas: () => undefined,
    onUserMessage: () => undefined,
    onTool: () => undefined,
    onCompaction: () => undefined,
    onApproval: () => undefined,
    onUserInput: () => undefined,
    onUserInputStatus: () => undefined,
    onGoal: () => undefined,
    onTodos: () => undefined,
    onTurnComplete: () => undefined,
    onError: () => undefined
  }
}

describe('usage event mapping', () => {
  it('does not infer cache hit rate from cachedTokens-only usage events', async () => {
    let captured: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onUsage: (usage) => {
        captured = usage
      }
    }

    await dispatchKunRuntimeEvent(
      {
        kind: 'usage',
        seq: 12,
        usage: {
          promptTokens: 100,
          completionTokens: 5,
          totalTokens: 105,
          cachedTokens: 42,
          turns: 1
        }
      },
      sink,
      async () => undefined
    )

    expect(captured).toMatchObject({
      inputTokens: 100,
      outputTokens: 5,
      totalTokens: 105,
      cachedTokens: 0,
      cacheMissTokens: 0,
      cacheHitRate: null,
      turns: 1
    })
  })

  it('derives cache hit rate only from explicit hit and miss usage counters', async () => {
    let captured: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onUsage: (usage) => {
        captured = usage
      }
    }

    await dispatchKunRuntimeEvent(
      {
        kind: 'usage',
        seq: 13,
        usage: {
          promptTokens: 100,
          completionTokens: 5,
          totalTokens: 105,
          cacheHitTokens: 80,
          cacheMissTokens: 20,
          tokenEconomySavingsTokens: 4096,
          turns: 1
        }
      },
      sink,
      async () => undefined
    )

    expect(captured).toMatchObject({
      inputTokens: 100,
      outputTokens: 5,
      totalTokens: 105,
      cachedTokens: 80,
      cacheMissTokens: 20,
      cacheHitRate: 0.8,
      tokenEconomySavingsTokens: 4096,
      turns: 1
    })
  })

  it('passes through per-turn and session timing averages', async () => {
    let captured: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onUsage: (usage) => {
        captured = usage
      }
    }

    await dispatchKunRuntimeEvent(
      {
        kind: 'usage',
        seq: 14,
        turnId: 'turn_1',
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          turnAvgTtftMs: 1_000,
          turnAvgTokensPerSecond: 40.2,
          avgTtftMs: 1_200,
          avgTokensPerSecond: 38.5,
          turns: 1
        }
      },
      sink,
      async () => undefined
    )

    expect(captured).toMatchObject({
      turnAvgTtftMs: 1_000,
      turnAvgTokensPerSecond: 40.2,
      avgTtftMs: 1_200,
      avgTokensPerSecond: 38.5,
      turnId: 'turn_1'
    })
  })

  it('passes through cache diagnostics and the live per-request hit rate', async () => {
    let captured: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onUsage: (usage) => {
        captured = usage
      }
    }

    await dispatchKunRuntimeEvent(
      {
        kind: 'usage',
        seq: 16,
        turnId: 'turn_2',
        usage: {
          promptTokens: 100,
          completionTokens: 5,
          totalTokens: 105,
          reasoningTokens: 12,
          cacheHitTokens: 80,
          cacheMissTokens: 20,
          cacheHitRate: 0.8,
          cacheableTokenHitRate: 0.8,
          totalInputTokenHitRate: 0.6,
          cacheMissReasons: ['tool_catalog_changed'],
          cacheSuggestions: ['Keep MCP tools stable.'],
          lastRequestCacheHitRate: 0.8,
          turns: 1
        }
      },
      sink,
      async () => undefined
    )

    expect(captured).toMatchObject({
      reasoningTokens: 12,
      cacheableTokenHitRate: 0.8,
      totalInputTokenHitRate: 0.6,
      cacheMissReasons: ['tool_catalog_changed'],
      cacheSuggestions: ['Keep MCP tools stable.'],
      lastRequestCacheHitRate: 0.8
    })
  })

  it('normalizes missing or invalid timing fields to null', async () => {
    let captured: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onUsage: (usage) => {
        captured = usage
      }
    }

    await dispatchKunRuntimeEvent(
      {
        kind: 'usage',
        seq: 15,
        usage: {
          promptTokens: 10,
          completionTokens: 2,
          totalTokens: 12,
          turnAvgTtftMs: Number.NaN,
          turns: 1
        }
      },
      sink,
      async () => undefined
    )

    expect(captured).toMatchObject({
      turnAvgTtftMs: null,
      turnAvgTokensPerSecond: null,
      avgTtftMs: null,
      avgTokensPerSecond: null
    })
    expect((captured as { turnId?: string }).turnId).toBeUndefined()
  })
})

describe('context snapshot event mapping', () => {
  it('preserves request-local categories and runtime thresholds', () => {
    const actions = runtimeProjectionActionsFromEvent({
      kind: 'context_snapshot',
      seq: 14,
      timestamp: '2026-07-24T00:00:00.000Z',
      threadId: 'thr_1',
      turnId: 'turn_1',
      model: 'deepseek-v4-pro',
      providerId: 'deepseek',
      stepIndex: 1,
      contextWindowTokens: 256_000,
      softThresholdTokens: 192_000,
      hardThresholdTokens: 217_600,
      estimatedInputTokens: 12_000,
      breakdown: {
        tools: 3_000,
        system: 2_000,
        skills: 1_000,
        messages: 5_000,
        other: 1_000
      },
      toolCount: 21,
      activeSkillIds: [' skill-a ', '', 'skill-b']
    })

    expect(actions).toEqual([{
      type: 'context_snapshot_received',
      seq: 14,
      payload: {
        threadId: 'thr_1',
        turnId: 'turn_1',
        model: 'deepseek-v4-pro',
        providerId: 'deepseek',
        stepIndex: 1,
        contextWindowTokens: 256_000,
        softThresholdTokens: 192_000,
        hardThresholdTokens: 217_600,
        estimatedInputTokens: 12_000,
        breakdown: {
          tools: 3_000,
          system: 2_000,
          skills: 1_000,
          messages: 5_000,
          other: 1_000
        },
        toolCount: 21,
        activeSkillIds: ['skill-a', 'skill-b']
      }
    }])
  })

  it('drops incomplete snapshot events instead of showing mixed accounting', () => {
    expect(runtimeProjectionActionsFromEvent({
      kind: 'context_snapshot',
      threadId: 'thr_1',
      model: 'deepseek-v4-pro'
    })).toEqual([])
  })

  it('drops snapshots whose declared total does not equal their categories', () => {
    expect(runtimeProjectionActionsFromEvent({
      kind: 'context_snapshot',
      threadId: 'thr_1',
      model: 'deepseek-v4-pro',
      stepIndex: 0,
      contextWindowTokens: 256_000,
      softThresholdTokens: 192_000,
      hardThresholdTokens: 217_600,
      estimatedInputTokens: 999,
      breakdown: { tools: 1, system: 2, skills: 3, messages: 4, other: 5 },
      toolCount: 1,
      activeSkillIds: []
    })).toEqual([])
  })

  it('preserves SDK-managed unknown native history without inventing occupancy', () => {
    const actions = runtimeProjectionActionsFromEvent({
      kind: 'context_snapshot',
      threadId: 'thr_1',
      turnId: 'turn_2',
      model: 'claude-sonnet-4-5',
      providerId: 'claude-subscription',
      stepIndex: 0,
      contextWindowTokens: 200_000,
      softThresholdTokens: 150_000,
      hardThresholdTokens: 170_000,
      estimatedInputTokens: 12,
      breakdown: { tools: 1, system: 2, skills: 3, messages: 6, other: 0 },
      toolCount: 1,
      activeSkillIds: [],
      contextManagement: 'sdk-managed',
      nativeHistory: 'unknown'
    })
    expect(actions).toEqual([{
      type: 'context_snapshot_received',
      payload: expect.objectContaining({
        contextManagement: 'sdk-managed',
        nativeHistory: 'unknown',
        estimatedInputTokens: 12
      })
    }])
  })
})

describe('delegated runtime capability mapping', () => {
  it('maps bounded capability and rebase state without a native session id', () => {
    expect(runtimeProjectionActionsFromEvent({
      kind: 'delegated_runtime',
      threadId: 'thr_1',
      turnId: 'turn_1',
      providerKind: 'cursor-sdk',
      providerId: 'cursor-subscription',
      phase: 'rebased',
      reason: 'history_changed',
      capabilities: {
        nativeResume: true,
        structuredStreaming: true,
        kunTools: false,
        externalApproval: false,
        liveSteering: false,
        nativeContextTelemetry: false,
        fork: false
      }
    })).toEqual([{
      type: 'delegated_runtime_received',
      payload: {
        threadId: 'thr_1',
        turnId: 'turn_1',
        providerKind: 'cursor-sdk',
        providerId: 'cursor-subscription',
        phase: 'rebased',
        reason: 'history_changed',
        capabilities: {
          nativeResume: true,
          structuredStreaming: true,
          kunTools: false,
          externalApproval: false,
          liveSteering: false,
          nativeContextTelemetry: false,
          fork: false
        }
      }
    }])
  })
})
