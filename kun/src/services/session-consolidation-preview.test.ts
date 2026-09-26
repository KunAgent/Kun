import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ThreadRecord, ThreadSummary } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'
import type { TurnItem } from '../contracts/items.js'
import type { ThreadStore, ThreadStoreConditionalWrite, ThreadStoreListPage } from '../ports/thread-store.js'
import { SessionConsolidationPreviewService } from './session-consolidation-preview.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const NOW = '2026-09-10T00:00:00.000Z'
const DAY = 86_400_000
const IDLE_AFTER_MS = 30 * DAY
const MIN_BYTES = 200

function agoIso(ms: number): string {
  return new Date(Date.parse(NOW) - ms).toISOString()
}

function makeItem(kind: 'approval' | 'user_input', status: string): TurnItem {
  const base = {
    id: `item_${kind}`, turnId: 'turn_1', threadId: 'thread', role: 'tool' as const,
    status: 'completed' as const, createdAt: NOW
  }
  if (kind === 'approval') {
    return { ...base, kind: 'approval', approvalId: 'appr_1', toolName: 'tool', summary: 's', status } as TurnItem
  }
  return { ...base, kind: 'user_input', inputId: 'input_1', prompt: 'p', questions: [], status } as TurnItem
}

function makeTurn(overrides: Partial<Turn> & { id: string; status: Turn['status'] }): Turn {
  return {
    threadId: 'thread', prompt: 'p', orchestration: 'direct', steering: [],
    createdAt: NOW, items: [], attachmentIds: [], activeSkillIds: [],
    injectedMemoryIds: [], injectedMemorySummaries: [], injectedInstructionSources: [],
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

class FakeThreadStore implements Pick<ThreadStore,
  'list' | 'listPage' | 'get' | 'getMetadata' | 'upsert' | 'delete' | 'touch' | 'upsertIfRevision' | 'deleteByWorkspace'> {
  constructor(private readonly records: Map<string, ThreadRecord>) {}

  async list(): Promise<ThreadSummary[]> {
    return [...this.records.keys()].map((id) => ({ id }) as unknown as ThreadSummary)
  }
  async listPage(): Promise<ThreadStoreListPage> {
    throw new Error('unexpected call: listPage')
  }
  async get(threadId: string): Promise<ThreadRecord | null> {
    return this.records.get(threadId) ?? null
  }
  async getMetadata(threadId: string): Promise<ThreadRecord | null> {
    return this.records.get(threadId) ?? null
  }
  async upsert(): Promise<ThreadRecord> { throw new Error('unexpected mutation: upsert') }
  async delete(): Promise<boolean> { throw new Error('unexpected mutation: delete') }
  async touch(): Promise<boolean> { throw new Error('unexpected mutation: touch') }
  async upsertIfRevision(): Promise<ThreadStoreConditionalWrite> { throw new Error('unexpected mutation: upsertIfRevision') }
  async deleteByWorkspace(): Promise<string[]> { throw new Error('unexpected mutation: deleteByWorkspace') }
}

async function writeThreadDir(root: string, threadId: string, bytes: number): Promise<string> {
  const dir = join(root, 'threads', threadId)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'messages.jsonl'), 'x'.repeat(bytes))
  return dir
}

describe('SessionConsolidationPreviewService', () => {
  it('partitions candidates and excluded threads with exact reasons, and mutates nothing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-consolidation-preview-'))
    roots.push(root)

    const oldFinishedAt = agoIso(40 * DAY)
    const recentFinishedAt = agoIso(1 * DAY)

    const threads = new Map<string, ThreadRecord>()

    threads.set('thread_candidate', makeThread({
      id: 'thread_candidate',
      turns: [makeTurn({ id: 'turn_1', status: 'completed', finishedAt: oldFinishedAt })]
    }))

    threads.set('thread_not_archived', makeThread({
      id: 'thread_not_archived', status: 'idle',
      turns: [makeTurn({ id: 'turn_1', status: 'completed', finishedAt: oldFinishedAt })]
    }))

    threads.set('thread_active_turn', makeThread({
      id: 'thread_active_turn',
      turns: [
        makeTurn({ id: 'turn_1', status: 'completed', finishedAt: oldFinishedAt }),
        makeTurn({ id: 'turn_2', status: 'queued' })
      ]
    }))

    threads.set('thread_pending_approval', makeThread({
      id: 'thread_pending_approval',
      turns: [makeTurn({
        id: 'turn_1', status: 'completed', finishedAt: oldFinishedAt,
        items: [makeItem('approval', 'pending')]
      })]
    }))

    threads.set('thread_pending_user_input', makeThread({
      id: 'thread_pending_user_input',
      turns: [makeTurn({
        id: 'turn_1', status: 'completed', finishedAt: oldFinishedAt,
        items: [makeItem('user_input', 'pending')]
      })]
    }))

    threads.set('thread_pinned', makeThread({
      id: 'thread_pinned', pinned: true,
      turns: [makeTurn({ id: 'turn_1', status: 'completed', finishedAt: oldFinishedAt })]
    }))

    threads.set('thread_forked_parent', makeThread({
      id: 'thread_forked_parent',
      turns: [makeTurn({ id: 'turn_1', status: 'completed', finishedAt: oldFinishedAt })]
    }))
    threads.set('thread_forked_child', makeThread({
      id: 'thread_forked_child', status: 'idle', parentThreadId: 'thread_forked_parent',
      turns: [makeTurn({ id: 'turn_1', status: 'completed', finishedAt: oldFinishedAt })]
    }))

    threads.set('thread_no_completed_turn_old_updated', makeThread({
      id: 'thread_no_completed_turn_old_updated',
      updatedAt: '2000-01-01T00:00:00.000Z',
      turns: [makeTurn({ id: 'turn_1', status: 'failed' })]
    }))

    threads.set('thread_not_idle', makeThread({
      id: 'thread_not_idle',
      turns: [makeTurn({ id: 'turn_1', status: 'completed', finishedAt: recentFinishedAt })]
    }))

    threads.set('thread_below_min_size', makeThread({
      id: 'thread_below_min_size',
      turns: [makeTurn({ id: 'turn_1', status: 'completed', finishedAt: oldFinishedAt })]
    }))

    const sizes: Record<string, number> = {
      thread_candidate: 500,
      thread_not_archived: 500,
      thread_active_turn: 500,
      thread_pending_approval: 500,
      thread_pending_user_input: 500,
      thread_pinned: 500,
      thread_forked_parent: 500,
      thread_forked_child: 500,
      thread_no_completed_turn_old_updated: 500,
      thread_not_idle: 500,
      thread_below_min_size: 50
    }

    const fixtureFiles: string[] = []
    for (const [id, bytes] of Object.entries(sizes)) {
      const dir = await writeThreadDir(root, id, bytes)
      fixtureFiles.push(join(dir, 'messages.jsonl'))
    }
    const before = await Promise.all(fixtureFiles.map((path) => stat(path)))

    const store = new FakeThreadStore(threads)
    const service = new SessionConsolidationPreviewService({
      threadStore: store, dataDir: root, nowIso: () => NOW,
      idleAfterMs: IDLE_AFTER_MS, minBytes: MIN_BYTES
    })

    const report = await service.run()

    expect(report.candidateCount).toBe(1)
    expect(report.candidates.map((c) => c.threadId)).toEqual(['thread_candidate'])
    expect(report.projectedReclaimableBytes).toBe(500)

    const reasons = new Map(report.excluded.map((e) => [e.threadId, e.reason]))
    expect(reasons.get('thread_not_archived')).toBe('not_archived')
    expect(reasons.get('thread_active_turn')).toBe('active_turn')
    expect(reasons.get('thread_pending_approval')).toBe('pending_approval')
    expect(reasons.get('thread_pending_user_input')).toBe('pending_user_input')
    expect(reasons.get('thread_pinned')).toBe('pinned')
    expect(reasons.get('thread_forked_parent')).toBe('fork_dependency')
    expect(reasons.get('thread_forked_child')).toBe('not_archived')
    expect(reasons.get('thread_no_completed_turn_old_updated')).toBe('no_completed_turn')
    expect(reasons.get('thread_not_idle')).toBe('not_idle')
    expect(reasons.get('thread_below_min_size')).toBe('below_min_size')

    // Explicit regression: an ancient updatedAt never admits a thread with no completed turn.
    const noCompletedTurn = report.excluded.find((e) => e.threadId === 'thread_no_completed_turn_old_updated')
    expect(noCompletedTurn?.updatedAt).toBe('2000-01-01T00:00:00.000Z')
    expect(noCompletedTurn?.reason).toBe('no_completed_turn')
    expect(report.candidates.some((c) => c.threadId === 'thread_no_completed_turn_old_updated')).toBe(false)

    const candidate = report.candidates[0]
    expect(candidate?.lastCompletedTurnFinishedAt).toBe(oldFinishedAt)
    expect(candidate?.hasActiveTurn).toBe(false)
    expect(candidate?.threadPayloadBytes).toBe(500)

    const after = await Promise.all(fixtureFiles.map((path) => stat(path)))
    before.forEach((info, index) => {
      expect(after[index]?.size).toBe(info.size)
      expect(after[index]?.mtimeMs).toBe(info.mtimeMs)
    })
  })
})
