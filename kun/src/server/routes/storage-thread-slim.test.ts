import { mkdtemp, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { FileSessionStore } from '../../adapters/file/file-session-store.js'
import type { ServerRuntime } from './server-runtime.js'
import { applyThreadSlim, previewThreadSlim } from './storage-thread-slim.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

const OLD = '2026-08-01T00:00:00.000Z'
const IDLE_BEFORE = '2026-09-29T00:00:00.000Z'

function event(seq: number, threadId: string) {
  return { kind: 'context_snapshot', seq, threadId, timestamp: OLD, model: 'm', stepIndex: 0,
    contextWindowTokens: 1, softThresholdTokens: 1, hardThresholdTokens: 1, estimatedInputTokens: seq,
    breakdown: { tools: 0, system: 0, skills: 0, messages: seq, other: 0 }, toolCount: 0,
    activeSkillIds: [], contextManagement: 'sdk-managed', occupancySource: 'agent', padding: 'x'.repeat(2_000) }
}

function thread(id: string, patch: Record<string, unknown> = {}) {
  return { id, title: `T ${id}`, workspace: '/w', status: 'idle', updatedAt: OLD, turns: [], ...patch }
}

async function setup(threads: Record<string, ReturnType<typeof thread>>) {
  const root = await mkdtemp(join(tmpdir(), 'kun-storage-slim-')); roots.push(root)
  const sessionStore = new FileSessionStore({ dataDir: root })
  for (const id of Object.keys(threads)) {
    for (let seq = 1; seq <= 20; seq += 1) await sessionStore.appendEvent(id, event(seq, id) as never)
  }
  const runtime = {
    sessionStore,
    threadService: { getMetadata: async (id: string) => threads[id] ?? null }
  } as unknown as ServerRuntime
  return { root, runtime, sessionStore }
}

function post(body: unknown): Request {
  return new Request('http://kun/v1/storage/threads/slim', { method: 'POST', body: JSON.stringify(body) })
}

describe('storage thread slim', () => {
  it('previews eligibility and protects pinned, running, room, goal and recent threads', async () => {
    const { runtime } = await setup({
      old: thread('old'),
      pinned: thread('pinned', { pinned: true }),
      running: thread('running', { status: 'running' }),
      room: thread('room', { roomContext: { roomId: 'r' } }),
      goal: thread('goal', { goal: { status: 'active' } }),
      recent: thread('recent', { updatedAt: '2026-10-20T00:00:00.000Z' })
    })
    const response = await previewThreadSlim(runtime, post({
      threadIds: ['old', 'pinned', 'running', 'room', 'goal', 'recent', 'missing'], idleBefore: IDLE_BEFORE
    }))
    const { candidates } = JSON.parse(response.body) as { candidates: Array<{ threadId: string; eligible: boolean; skipReason?: string }> }
    expect(Object.fromEntries(candidates.map((c) => [c.threadId, c.skipReason ?? 'ok']))).toEqual({
      old: 'ok', pinned: 'pinned', running: 'active', room: 'room', goal: 'goal', recent: 'recent', missing: 'missing'
    })
  })

  it('keeps the newest event so the seq high-water and replay floor stay monotonic', async () => {
    const { root, runtime, sessionStore } = await setup({ old: thread('old'), pinned: thread('pinned', { pinned: true }) })
    const before = (await stat(join(root, 'threads', 'old', 'events.jsonl'))).size
    const response = await applyThreadSlim(runtime, post({ threadIds: ['old', 'pinned'], idleBefore: IDLE_BEFORE }))
    const result = JSON.parse(response.body) as { slimmed: Array<{ threadId: string; afterBytes: number }>; skipped: Array<{ threadId: string; reason: string }> }
    expect(result.slimmed.map((entry) => entry.threadId)).toEqual(['old'])
    expect(result.slimmed[0]!.afterBytes).toBeLessThan(before / 10)
    expect(result.skipped).toEqual([{ threadId: 'pinned', reason: 'pinned' }])
    expect(await sessionStore.highestSeq('old')).toBe(20)
    expect(await sessionStore.eventReplayFloorSeq('old')).toBe(20)
    expect(await sessionStore.highestSeq('pinned')).toBe(20)

    const again = await applyThreadSlim(runtime, post({ threadIds: ['old'], idleBefore: IDLE_BEFORE }))
    expect((JSON.parse(again.body) as { skipped: unknown[] }).skipped).toEqual([{ threadId: 'old', reason: 'already_slim' }])
  })

  it('rejects malformed bodies', async () => {
    const { runtime } = await setup({})
    expect((await applyThreadSlim(runtime, post({ threadIds: 'x' }))).status).toBe(400)
  })
})
