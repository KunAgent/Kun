import { describe, expect, it } from 'vitest'
import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'
import {
  buildCandidateEpisodePreview,
  previewCandidateEpisodes
} from './session-consolidation-episode-preview.js'

const NOW = '2026-09-10T00:00:00.000Z'

function makeTurn(overrides: Partial<Turn> & { id: string; status: Turn['status'] }): Turn {
  return {
    threadId: 'thread', prompt: 'p', orchestration: 'direct', steering: [],
    createdAt: NOW, items: [], attachmentIds: [], activeSkillIds: [],
    injectedMemoryIds: [], injectedMemorySummaries: [], injectedDirectiveIds: [],
    injectedDirectiveSummaries: [], injectedInstructionSources: [],
    ...overrides
  }
}

function makeThread(overrides: Partial<ThreadRecord> & { id: string }): ThreadRecord {
  return {
    title: 'T', workspace: '/', model: 'model', mode: 'agent', status: 'archived',
    approvalPolicy: 'on-request', sandboxMode: 'workspace-write', approvalReviewer: 'user',
    relation: 'primary', createdAt: NOW, updatedAt: NOW, turns: [],
    ...overrides
  }
}

function threadWithText(text: string): ThreadRecord {
  return makeThread({
    id: 'thread_episode',
    turns: [makeTurn({
      id: 'turn_1', status: 'completed', finishedAt: NOW,
      items: [{
        id: 'item_1', turnId: 'turn_1', threadId: 'thread_episode', role: 'assistant',
        status: 'completed', createdAt: NOW, kind: 'assistant_text', text
      }]
    })]
  })
}

describe('buildCandidateEpisodePreview', () => {
  it('bounds the excerpt for large transcripts', () => {
    const thread = threadWithText('word '.repeat(2_000))
    const bounded = buildCandidateEpisodePreview(thread, 1_024)
    const unbounded = buildCandidateEpisodePreview(thread, 1_000_000)
    expect(bounded.threadId).toBe('thread_episode')
    expect(bounded.excerptBytes).toBeLessThan(unbounded.excerptBytes)
    expect(bounded.transcriptExcerpt).toContain('[truncated]')
    expect(Buffer.byteLength(bounded.transcriptExcerpt, 'utf8')).toBe(bounded.excerptBytes)
  })

  it('produces a stable contentHash for identical input', () => {
    const thread = threadWithText('identical content')
    const first = buildCandidateEpisodePreview(thread, 4_096)
    const second = buildCandidateEpisodePreview(thread, 4_096)
    expect(first.contentHash).toBe(second.contentHash)
    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('changes the hash when the transcript content changes', () => {
    const a = buildCandidateEpisodePreview(threadWithText('alpha'), 4_096)
    const b = buildCandidateEpisodePreview(threadWithText('beta'), 4_096)
    expect(a.contentHash).not.toBe(b.contentHash)
  })
})

describe('previewCandidateEpisodes', () => {
  it('reads candidate records only through get/getMetadata, never mutating the store', async () => {
    const thread = threadWithText('hello world')
    const store = {
      async get(): Promise<ThreadRecord | null> { throw new Error('unexpected call: get') },
      async getMetadata(threadId: string): Promise<ThreadRecord | null> {
        return threadId === thread.id ? thread : null
      }
    }
    const previews = await previewCandidateEpisodes([thread.id, 'missing_thread'], store, 4_096)
    expect(previews).toHaveLength(1)
    expect(previews[0]?.threadId).toBe(thread.id)
    expect(previews[0]?.transcriptExcerpt).toContain('hello world')
  })
})
