import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { readLatestContextSnapshot } from './file-session-context-snapshot.js'
import { FileSessionStore } from './file-session-store.js'
import type { ContextSnapshotEvent } from '../../contracts/context-snapshot.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
function snapshot(seq: number, threadId = 'thread'): ContextSnapshotEvent {
  return { kind: 'context_snapshot', seq, threadId, timestamp: '2026-10-11T00:00:00Z',
    model: 'codex', stepIndex: 0, contextWindowTokens: 100_000, softThresholdTokens: 95_000,
    hardThresholdTokens: 99_000, estimatedInputTokens: seq, breakdown: { tools: 0, system: 0, skills: 0, messages: seq, other: 0 },
    toolCount: 0, activeSkillIds: [], contextManagement: 'sdk-managed', occupancySource: 'agent' }
}
async function log(lines: unknown[], suffix = '') {
  const root = await mkdtemp(join(tmpdir(), 'kun-context-tail-')); roots.push(root)
  const path = join(root, 'events.jsonl')
  await writeFile(path, lines.map((line) => JSON.stringify(line) + '\n').join('') + suffix)
  return path
}

describe('durable context telemetry', () => {
  it('reads only the latest main-agent snapshot at the requested replay boundary', async () => {
    const path = await log([snapshot(1), snapshot(2), snapshot(3, 'foreign'),
      { ...snapshot(4), child: { parentThreadId: 'thread', parentTurnId: 'turn', childId: 'child', childStatus: 'running', childSeq: 1 } }, snapshot(5)])
    expect(await readLatestContextSnapshot(path, 'thread', 4)).toEqual(snapshot(2))
    expect(await readLatestContextSnapshot(path, 'thread', 5)).toEqual(snapshot(5))
    expect(await readLatestContextSnapshot(path, 'thread', 0)).toBeNull()
  })
  it('ignores incomplete and corrupt records and skips huge unrelated lines with bounded memory', async () => {
    const path = await log([snapshot(1), { text: 'x'.repeat(5 * 1024 * 1024) }], '{broken}\n' + JSON.stringify(snapshot(8)))
    expect(await readLatestContextSnapshot(path, 'thread', 99)).toEqual(snapshot(1))
  })
  it('preserves UTF-8 split across read chunks and accepts records spanning chunks', async () => {
    const event = { ...snapshot(3), activeSkillIds: ['技能'.repeat(16_000)] }
    const path = await log([snapshot(1), event, { text: 'tail'.repeat(100) }])
    expect(await readLatestContextSnapshot(path, 'thread', 9)).toEqual(event)
  })
  it('returns null for missing telemetry and an uncommitted first record', async () => {
    expect(await readLatestContextSnapshot(await log([]), 'thread', 10)).toBeNull()
    expect(await readLatestContextSnapshot(await log([], JSON.stringify(snapshot(1))), 'thread', 10)).toBeNull()
    expect(await readLatestContextSnapshot('/does-not-exist/context/events.jsonl', 'thread', 10)).toBeNull()
  })
  it('survives a store restart without materializing event replay and follows retention', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-context-store-')); roots.push(root)
    const first = new FileSessionStore({ dataDir: root })
    await first.appendEvent('thread', snapshot(1)); await first.appendEvent('thread', snapshot(2))
    const reopened = new FileSessionStore({ dataDir: root })
    reopened.loadEventsSince = async () => { throw new Error('Full replay is forbidden') }
    expect(await reopened.loadLatestContextSnapshot('thread', 2)).toEqual(snapshot(2))
    await reopened.trimEventsFromSeq('thread', 2)
    expect(await reopened.loadLatestContextSnapshot('thread', 1)).toBeNull()
    expect(await reopened.loadLatestContextSnapshot('thread', 2)).toEqual(snapshot(2))
    expect(await reopened.loadLatestContextSnapshot('../thread', 2)).toBeNull()
    await first.flushScheduledCompaction(); await reopened.flushScheduledCompaction()
  })
})
