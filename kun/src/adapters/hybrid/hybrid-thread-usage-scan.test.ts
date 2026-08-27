import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanEventsForUsageBackfill } from './hybrid-thread-usage-scan.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempEventsFile(): Promise<{ root: string; path: string }> {
  const root = await mkdtemp(join(tmpdir(), 'kun-usage-scan-'))
  roots.push(root)
  const dir = join(root, 'threads', 'thread_1')
  await mkdir(dir, { recursive: true })
  return { root, path: join(dir, 'events.jsonl') }
}

function usageEventLine(seq: number, padding = ''): string {
  return JSON.stringify({
    kind: 'usage',
    threadId: 'thread_1',
    seq,
    timestamp: `2026-08-08T00:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    turnId: `turn-${seq}`,
    model: 'test-model',
    usage: {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      cacheHitRate: null,
      turns: 1,
      padding
    }
  })
}

function lifecycleEventLine(seq: number): string {
  return JSON.stringify({
    kind: 'thread_created',
    threadId: 'thread_1',
    seq,
    timestamp: `2026-08-08T00:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    title: 'Thread'
  })
}

describe('scanEventsForUsageBackfill', () => {
  it('returns an empty scan for a missing events log', async () => {
    const { path } = await tempEventsFile()
    await expect(scanEventsForUsageBackfill(path)).resolves.toEqual({ highWater: 0, usage: [] })
  })

  it('throws permission errors instead of treating the log as empty', async () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return
    const { path } = await tempEventsFile()
    await writeFile(path, `${usageEventLine(1)}\n`)
    await chmod(path, 0o000)
    try {
      await expect(scanEventsForUsageBackfill(path)).rejects.toMatchObject({ code: 'EACCES' })
    } finally {
      await chmod(path, 0o600)
    }
  })

  it('ignores a torn trailing append but keeps newline-terminated records', async () => {
    const { path } = await tempEventsFile()
    const torn = '{"kind":"usage","threadId":"thread_1","seq":3'
    await writeFile(path, `${usageEventLine(1)}\n${lifecycleEventLine(2)}\n${torn}`)
    await expect(scanEventsForUsageBackfill(path)).resolves.toEqual({
      highWater: 2,
      usage: [expect.objectContaining({ kind: 'usage', seq: 1 })]
    })
  })

  it('counts a complete unterminated trailing record when it parses', async () => {
    const { path } = await tempEventsFile()
    await writeFile(path, `${usageEventLine(1)}\n${usageEventLine(2)}`)
    const scan = await scanEventsForUsageBackfill(path)
    expect(scan.highWater).toBe(2)
    expect(scan.usage.map((event) => event.seq)).toEqual([1, 2])
  })

  it('fails with the line number for a corrupt record in the middle', async () => {
    const { path } = await tempEventsFile()
    await writeFile(path, `${usageEventLine(1)}\nnot-json\n${usageEventLine(3)}\n`)
    await expect(scanEventsForUsageBackfill(path)).rejects.toThrow(/line 2/)
  })

  it('fails when a newline-terminated record exceeds the record budget', async () => {
    const { path } = await tempEventsFile()
    const oversized = usageEventLine(1, 'x'.repeat(128))
    await writeFile(path, `${oversized}\n`)
    await expect(scanEventsForUsageBackfill(path, { maxRecordBytes: 128 }))
      .rejects.toThrow(/exceeds 128 bytes/)
  })

  it('fails while streaming when an unterminated line grows past the budget', async () => {
    const { path } = await tempEventsFile()
    await writeFile(path, 'x'.repeat(512))
    await expect(scanEventsForUsageBackfill(path, { maxRecordBytes: 128 }))
      .rejects.toThrow(/exceeds 128 bytes/)
  })

  it('streams a large log with the same result as a full read', async () => {
    const { path } = await tempEventsFile()
    const lines: string[] = []
    for (let seq = 1; seq <= 20_000; seq += 1) {
      lines.push(seq % 3 === 0 ? lifecycleEventLine(seq) : usageEventLine(seq))
    }
    await writeFile(path, `${lines.join('\n')}\n`)
    const scan = await scanEventsForUsageBackfill(path)
    expect(scan.highWater).toBe(20_000)
    expect(scan.usage).toHaveLength(20_000 - Math.floor(20_000 / 3))
    expect(scan.usage[scan.usage.length - 1]).toMatchObject({ kind: 'usage', seq: 20_000 })
  })
})
