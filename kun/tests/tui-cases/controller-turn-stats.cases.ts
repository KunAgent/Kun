import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RuntimeEvent } from '../../src/contracts/events.js'
import { ThreadSchema } from '../../src/contracts/threads.js'
import type { KunTuiClient, ThreadDetail, TuiConnection } from '../../src/tui/client.js'
import { TuiController } from '../../src/tui/controller.js'

const contextSnapshot = {
  seq: 4,
  timestamp: '2026-10-21T00:00:02.000Z',
  threadId: 'thr_1',
  turnId: 'turn_1',
  kind: 'context_snapshot' as const,
  model: 'deepseek-flash',
  providerId: 'deepseek',
  stepIndex: 0,
  contextWindowTokens: 1_000_000,
  softThresholdTokens: 900_000,
  hardThresholdTokens: 950_000,
  estimatedInputTokens: 35_619,
  breakdown: { tools: 18_240, system: 6_120, skills: 1_410, messages: 9_849, other: 0 },
  toolCount: 42,
  activeSkillIds: []
}

function turn(id: string, createdAt: string) {
  return {
    id,
    threadId: 'thr_1',
    status: 'completed',
    model: 'deepseek-flash',
    providerId: 'deepseek',
    orchestration: 'direct',
    prompt: 'hi',
    steering: [],
    createdAt,
    startedAt: createdAt,
    finishedAt: createdAt,
    items: [],
    attachmentIds: [],
    activeSkillIds: []
  }
}

function detail(): ThreadDetail {
  const base = ThreadSchema.parse({
    id: 'thr_1',
    title: 'Who are you',
    workspace: '/tmp/project',
    providerId: 'deepseek',
    model: 'deepseek-flash',
    mode: 'agent',
    status: 'idle',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    relation: 'primary',
    createdAt: '2026-10-21T00:00:00.000Z',
    updatedAt: '2026-10-21T00:00:03.000Z',
    turns: []
  })
  return {
    ...base,
    latestSeq: 4,
    pendingUserInputIds: [],
    contextSnapshot,
    turns: [turn('turn_1', '2026-10-21T00:00:00.000Z'), turn('turn_2', '2026-10-21T00:00:05.000Z')]
  } as unknown as ThreadDetail
}

const runtime = {
  baseUrl: 'http://127.0.0.1:18899',
  runtimeToken: 'secret',
  discovered: true,
  runtimeInfo: { model: 'deepseek-flash', approvalPolicy: 'on-request', sandboxMode: 'workspace-write' }
} as unknown as TuiConnection

describe('TuiController turn stats hydration', () => {
  it('reopens a session with its context split and usage totals, then records live turn timing', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-tui-turn-stats-'))
    const onEvent: { current?: (event: RuntimeEvent) => void } = {}
    const client = {
      listThreads: vi.fn(async () => [detail()]),
      getThread: vi.fn(async () => detail()),
      subscribeThreadEvents: vi.fn(async (request: { signal: AbortSignal; onEvent: (event: RuntimeEvent) => void }) => {
        onEvent.current = request.onEvent
        await new Promise<void>((resolve) => request.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      threadUsage: vi.fn(async () => ({
        group_by: 'thread',
        buckets: [
          { thread_id: 'thr_other', cost_usd: 9, cost_cny: 9, cache_hit_rate: 0.1, avg_ttft_ms: 9, avg_tokens_per_second: 9 },
          { thread_id: 'thr_1', cost_usd: 0.001, cost_cny: 0.01, cache_hit_rate: 0.8, avg_ttft_ms: 750, avg_tokens_per_second: 44.7 }
        ]
      }))
    }
    const controller = new TuiController(client as unknown as KunTuiClient, {
      runtimeToken: 'secret',
      dataDir,
      workspace: '/tmp/project',
      continueLatest: true,
      noStart: false,
      help: false
    }, runtime)
    try {
      await controller.start()
      expect(controller.state.projection?.contextSnapshot).toMatchObject({ estimatedInputTokens: 35_619 })
      await vi.waitFor(() => expect(controller.state.projection?.usageSummary).toBeDefined())
      expect(client.threadUsage).toHaveBeenCalledWith('thr_1')
      expect(controller.state.projection?.usageSummary).toEqual({
        costUsd: 0.001, costCny: 0.01, cacheHitRate: 0.8, avgTtftMs: 750, avgTokensPerSecond: 44.7
      })
      expect(controller.state.projection?.turnTiming).toBeUndefined()

      // Per-turn timing comes from the live usage event of that turn.
      onEvent.current!({
        seq: 5,
        timestamp: '2026-10-21T00:00:06.000Z',
        threadId: 'thr_1',
        turnId: 'turn_2',
        kind: 'usage',
        usage: {
          promptTokens: 1, completionTokens: 1, totalTokens: 2, cacheHitTokens: 0, cacheMissTokens: 1,
          cacheHitRate: null, turns: 2, turnAvgTtftMs: 300, turnAvgTokensPerSecond: 60
        }
      } as RuntimeEvent)
      expect(controller.state.projection?.turnTiming?.turn_2).toEqual({ avgTtftMs: 300, avgTokensPerSecond: 60 })
    } finally {
      await controller.stop()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('opens a session normally when the usage read fails', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-tui-turn-stats-legacy-'))
    const client = {
      listThreads: vi.fn(async () => [detail()]),
      getThread: vi.fn(async () => detail()),
      subscribeThreadEvents: vi.fn(async (request: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => request.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      threadUsage: vi.fn(async () => { throw new Error('503 usage unavailable') })
    }
    const controller = new TuiController(client as unknown as KunTuiClient, {
      runtimeToken: 'secret',
      dataDir,
      workspace: '/tmp/project',
      continueLatest: true,
      noStart: false,
      help: false
    }, runtime)
    try {
      await controller.start()
      await vi.waitFor(() => expect(client.threadUsage).toHaveBeenCalled())
      expect(controller.state.projection?.thread.id).toBe('thr_1')
      expect(controller.state.projection?.usageSummary).toBeUndefined()
      expect(controller.state.notification).toBeUndefined()
    } finally {
      await controller.stop()
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})
