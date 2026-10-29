import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SlimRuntimeClient } from './planner'
import { StorageCleanupService } from './service'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

const OLD = new Date('2026-08-01T00:00:00.000Z')

async function setup(eventBytes: number) {
  const root = await mkdtemp(join(tmpdir(), 'kun-storage-service-')); roots.push(root)
  const paths = { kunHome: join(root, 'home'), dataDir: join(root, 'home', 'data'), userData: join(root, 'user-data') }
  const dir = join(paths.dataDir, 'threads', 't1')
  await mkdir(dir, { recursive: true })
  await mkdir(paths.userData, { recursive: true })
  for (const name of ['events.jsonl', 'messages.jsonl', 'metadata.jsonl']) {
    await writeFile(join(dir, name), name === 'events.jsonl' ? Buffer.alloc(eventBytes, 120) : '{}\n')
    await utimes(join(dir, name), OLD, OLD)
  }
  let now = new Date('2026-10-29T03:00:00.000Z')
  const applied: string[] = []
  const notices: number[] = []
  const runtime: SlimRuntimeClient = {
    preview: async (ids) => ids.map((threadId) => ({ threadId, eligible: true })),
    apply: async (ids) => {
      applied.push(...ids)
      return { slimmed: ids.map((threadId) => ({ threadId, afterBytes: 10 })), skipped: [] }
    }
  }
  const service = new StorageCleanupService({
    paths: async () => paths,
    runtime,
    clearBrowserCaches: async () => undefined,
    notify: ({ bytes }) => notices.push(bytes),
    now: () => now
  })
  return { service, applied, notices, advance: (ms: number) => { now = new Date(now.getTime() + ms) } }
}

describe('storage cleanup scheduler', () => {
  it('does nothing without consent, then notices, waits a day and runs', async () => {
    const { service, applied, notices, advance } = await setup(80 * 1024 * 1024)
    await service.tick()
    expect(notices).toEqual([])

    await service.enable(30)
    await service.tick()
    expect(notices).toHaveLength(1)
    expect((await service.status()).state).toBe('pending')
    expect(applied).toEqual([])

    advance(23 * 60 * 60 * 1000)
    await service.tick()
    expect(applied).toEqual([])

    advance(2 * 60 * 60 * 1000)
    await service.tick()
    expect(applied).toEqual(['t1'])
    const status = await service.status()
    expect(status.state).toBe('scheduled')
    expect(status.config.lastRunAt).toBeDefined()
    expect((await service.history())[0]).toMatchObject({ reason: 'scheduled', slimmedThreads: 1 })
  })

  it('pauses when the threshold shrinks below consent and honours a skip', async () => {
    const { service, applied, notices, advance } = await setup(80 * 1024 * 1024)
    await service.enable(30)
    expect((await service.updateConfig({ olderThanDays: 7 })).state).toBe('needs_consent')
    await service.tick()
    expect(notices).toEqual([])

    await service.updateConfig({ olderThanDays: 30 })
    await service.tick()
    expect(notices).toHaveLength(1)
    await service.skipPendingRun()
    advance(3 * 86_400_000)
    await service.tick()
    expect(applied).toEqual([])
    expect(notices).toHaveLength(1)
  })

  it('records small runs as done without a notice', async () => {
    const { service, notices } = await setup(100 * 1024)
    await service.enable(30)
    await service.tick()
    expect(notices).toEqual([])
    expect((await service.status()).config.lastRunAt).toBeDefined()
  })
})
