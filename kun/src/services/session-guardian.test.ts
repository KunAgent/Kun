import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionGuardian } from './session-guardian.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('SessionGuardian shallow scans', () => {
  it('uses metadata and the derived item summary without parsing canonical history', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-session-guardian-'))
    roots.push(root)
    const threadId = 'thread_guardian'
    const dir = join(root, 'threads', threadId)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'messages.jsonl'), '{malformed canonical history\n')
    await writeFile(join(dir, 'messages-index.state.json'), JSON.stringify({
      rowCount: 12,
      kindCounts: { compaction: 6, model_context: 9 },
      baselineCount: 0
    }))

    const report = await new SessionGuardian({
      dataDir: root,
      nowIso: () => '2026-08-29T00:00:00.000Z',
      thresholds: { maxMessagesBytes: 1 }
    }).scanThread(threadId)

    expect(report).toMatchObject({
      itemCount: 12,
      compactionCount: 6,
      modelContextCount: 9,
      modelContextBaselineCount: 0,
      archivesBytes: 0,
      snapshotsBytes: 0
    })
    expect(report.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('messages.jsonl'),
      expect.stringContaining('compaction markers'),
      expect.stringContaining('without a baseline')
    ]))
  })
})
