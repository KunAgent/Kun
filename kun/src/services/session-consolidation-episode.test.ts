import { describe, expect, it } from 'vitest'
import type { ThreadRecord } from '../contracts/threads.js'
import type { TurnItem } from '../contracts/items.js'
import type { ModelClient, ModelStreamChunk } from '../ports/model-client.js'
import { buildConsolidationEpisode } from './session-consolidation-episode.js'

const NOW = '2026-09-18T00:00:00.000Z'

function makeThread(title = 'A completed project discussion'): ThreadRecord {
  return {
    id: 'thread_1', title, workspace: 'C:/workspace', model: 'test-model', mode: 'agent',
    status: 'archived', approvalPolicy: 'on-request', sandboxMode: 'workspace-write',
    approvalReviewer: 'user', relation: 'primary', createdAt: NOW, updatedAt: NOW,
    turns: [{
      id: 'turn_1', threadId: 'thread_1', prompt: 'p', orchestration: 'direct', steering: [],
      createdAt: NOW, finishedAt: NOW, status: 'completed', items: [], attachmentIds: [],
      activeSkillIds: [], injectedMemoryIds: [], injectedMemorySummaries: [],
      injectedDirectiveIds: [], injectedDirectiveSummaries: [], injectedInstructionSources: []
    }]
  }
}

function userItem(text: string): TurnItem {
  return {
    id: 'item_1', turnId: 'turn_1', threadId: 'thread_1', role: 'user', status: 'completed',
    createdAt: NOW, finishedAt: NOW, kind: 'user_message', text
  }
}

function modelClient(text: string, calls: { count: number }): ModelClient {
  const chunks: ModelStreamChunk[] = [
    { kind: 'assistant_text_delta', text },
    { kind: 'completed', stopReason: 'stop' }
  ]
  return {
    provider: 'test',
    model: 'test-model',
    async *stream() {
      calls.count += 1
      yield* chunks
    }
  }
}

function input(overrides: Partial<Parameters<typeof buildConsolidationEpisode>[0]> = {}) {
  const calls = { count: 0 }
  return {
    calls,
    value: {
      thread: makeThread(),
      items: [userItem('We completed the migration plan and documented the rollout.')],
      cutoffRevision: '3',
      modelClient: modelClient('The conversation completed a migration plan and documented its rollout.', calls),
      model: 'test-model',
      inputMaxBytes: 96 * 1024,
      maxTokens: 400,
      nowIso: NOW,
      ...overrides
    }
  }
}

describe('buildConsolidationEpisode', () => {
  it('writes a reference episode with self-contained excerpt evidence', async () => {
    const prepared = input()
    const result = await buildConsolidationEpisode(prepared.value)

    expect('input' in result).toBe(true)
    if (!('input' in result)) return
    expect(prepared.calls.count).toBe(1)
    expect(result.input.type).toBe('episode')
    expect(result.input.authority).toBe('reference')
    expect(result.input.content).toContain('migration plan')
    expect(result.input.sourceThreadId).toBe('thread_1')
    expect(result.input.sources).toHaveLength(1)
    expect(result.input.sources?.[0]?.threadId).toBe('thread_1')
    expect(result.input.sources?.[0]?.excerpt).toBe(result.excerpt)
    expect(result.input.sources?.[0]?.contentHash).toBe(result.contentHash)
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('refuses sensitive source text before calling the model', async () => {
    const prepared = input({ items: [userItem('Please remember api_key=abcdefgh12345678')] })
    const result = await buildConsolidationEpisode(prepared.value)

    expect(result).toEqual({ blocked: 'sensitive' })
    expect(prepared.calls.count).toBe(0)
  })

  it('refuses sensitive model output instead of persisting it', async () => {
    const prepared = input({
      modelClient: modelClient('The answer contains password=abcdefgh12345678', { count: 0 })
    })
    const result = await buildConsolidationEpisode(prepared.value)

    expect(result).toEqual({ blocked: 'sensitive' })
  })

  it('preserves a non-sensitive multilingual episode as evidence', async () => {
    const prepared = input({
      items: [userItem('我们完成了迁移方案，并记录了发布步骤。')],
      modelClient: modelClient('迁移方案已完成，并记录了发布步骤。', { count: 0 })
    })
    const result = await buildConsolidationEpisode(prepared.value)

    expect('input' in result).toBe(true)
    if (!('input' in result)) return
    expect(result.input.content).toContain('迁移方案')
    expect(result.input.sources?.[0]?.excerpt).toContain('迁移方案')
  })
})
