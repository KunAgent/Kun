import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SlimRuntimeClient } from './planner'
import { StorageCleanupService } from './service'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

const OLD = new Date('2026-08-01T00:00:00.000Z')

async function setup(eventBytes: number, when = OLD) {
  const root = await mkdtemp(join(tmpdir(), 'kun-storage-service-')); roots.push(root)
  const paths = { kunHome: join(root, 'home'), dataDir: join(root, 'home', 'data'), userData: join(root, 'user-data') }
  const dir = join(paths.dataDir, 'threads', 't1')
  await mkdir(dir, { recursive: true })
  await mkdir(paths.userData, { recursive: true })
  for (const name of ['events.jsonl', 'messages.jsonl', 'metadata.jsonl']) {
    await writeFile(join(dir, name), name === 'events.jsonl' ? Buffer.alloc(eventBytes, 120) : '{}\n')
    await utimes(join(dir, name), when, when)
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
  let resolvePaths = async () => paths
  const service = new StorageCleanupService({
    paths: () => resolvePaths(),
    runtime,
    clearBrowserCaches: async () => undefined,
    notify: ({ bytes }) => notices.push(bytes),
    now: () => now
  })
  return {
    service, paths, runtime, applied, notices,
    setPaths: (resolve: typeof resolvePaths) => { resolvePaths = resolve },
    advance: (ms: number) => { now = new Date(now.getTime() + ms) }
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function revoke(service: StorageCleanupService, change: 'disable' | 'shorten') {
  const status = change === 'disable' ? await service.disable() : await service.updateConfig({ olderThanDays: 1 })
  expect(status.state).toBe(change === 'disable' ? 'off' : 'needs_consent')
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

  it.each(['disable', 'shorten'] as const)('revalidates %s inside the execution lock before reloading a broader cutoff', async (change) => {
    const { service, paths, runtime, applied, setPaths } = await setup(100_000, new Date('2026-10-22T03:00:00.000Z'))
    await service.enable(30)
    await service.updateConfig({ notifyBefore: false })
    const entered = deferred()
    const release = deferred()
    let calls = 0
    setPaths(async () => {
      if (++calls === 2) { entered.resolve(); await release.promise }
      return paths
    })
    const preview = vi.spyOn(runtime, 'preview')
    const tick = service.tick()
    await entered.promise
    await revoke(service, change)
    release.resolve()
    await tick
    expect(applied).toEqual([])
    expect(preview).not.toHaveBeenCalled()
    expect((await service.status()).config.lastRunAt).toBeUndefined()
    expect(await service.history()).toEqual([])
    expect((await readFile(join(paths.dataDir, 'threads', 't1', 'events.jsonl'))).length).toBe(100_000)
  })

  it.each(['disable', 'shorten'] as const)('cancels %s while runtime preview is pending', async (change) => {
    const { service, paths, runtime, applied } = await setup(100_000)
    await service.enable(30)
    await service.updateConfig({ notifyBefore: false })
    const record = join(paths.dataDir, 'observability', 'trajectory', 'records', 'old.jsonl')
    await mkdir(join(record, '..'), { recursive: true })
    await writeFile(record, 'trace')
    await utimes(record, OLD, OLD)
    const entered = deferred()
    const release = deferred()
    runtime.preview = async (ids) => {
      entered.resolve()
      await release.promise
      return ids.map((threadId) => ({ threadId, eligible: true }))
    }
    const tick = service.tick()
    await entered.promise
    await revoke(service, change)
    release.resolve()
    await tick
    expect(applied).toEqual([])
    expect(await readFile(record, 'utf8')).toBe('trace')
    expect((await service.status()).trash.entries).toBe(0)
    expect((await service.status()).config.lastRunAt).toBeUndefined()
    expect(await service.history()).toEqual([])
  })

  it.each(['disable', 'shorten'] as const)('cancels %s after an admitted runtime batch without deleting shell outputs', async (change) => {
    const { service, paths, runtime } = await setup(100_000)
    await service.enable(30)
    await service.updateConfig({ notifyBefore: false })
    const shell = join(paths.dataDir, 'threads', 't1', 'background-shells', 'x.output')
    await mkdir(join(shell, '..'), { recursive: true })
    await writeFile(shell, 'output')
    await utimes(shell, OLD, OLD)
    const entered = deferred()
    const release = deferred()
    runtime.apply = async (ids) => {
      entered.resolve()
      await release.promise
      return { slimmed: ids.map((threadId) => ({ threadId, afterBytes: 10 })), skipped: [] }
    }
    const tick = service.tick()
    await entered.promise
    await revoke(service, change)
    release.resolve()
    await tick
    expect(await readFile(shell, 'utf8')).toBe('output')
    expect((await stat(shell)).isFile()).toBe(true)
    expect((await service.status()).config.lastRunAt).toBeUndefined()
    expect((await service.status()).trash.entries).toBe(0)
    // Already-admitted irreversible work is still accounted for, but does not advance the schedule.
    expect((await service.history())[0]).toMatchObject({ slimmedThreads: 1, movedToTrash: 0 })
  })

  it.each(['disable', 'shorten'] as const)('does not reintroduce notices after %s during preview', async (change) => {
    const { service, runtime, notices } = await setup(80 * 1024 * 1024)
    await service.enable(30)
    const entered = deferred()
    const release = deferred()
    runtime.preview = async (ids) => {
      entered.resolve()
      await release.promise
      return ids.map((threadId) => ({ threadId, eligible: true }))
    }
    const tick = service.tick()
    await entered.promise
    await revoke(service, change)
    release.resolve()
    await tick
    expect(notices).toEqual([])
    const { config } = await service.status()
    expect(config.pendingRunAt).toBeUndefined()
    expect(config.lastRunAt).toBeUndefined()
  })

  it('does not admit a tick while a disabling preference write is pending', async () => {
    const { service, paths, applied, setPaths } = await setup(100_000)
    await service.enable(30)
    await service.updateConfig({ notifyBefore: false })
    const entered = deferred()
    const release = deferred()
    let calls = 0
    setPaths(async () => {
      if (++calls === 1) { entered.resolve(); await release.promise }
      return paths
    })
    const disabling = service.disable()
    await entered.promise
    await service.tick()
    release.resolve()
    await disabling
    expect(applied).toEqual([])
    expect((await service.status()).state).toBe('off')
  })

  it('records small runs as done without a notice', async () => {
    const { service, notices } = await setup(100 * 1024)
    await service.enable(30)
    await service.tick()
    expect(notices).toEqual([])
    expect((await service.status()).config.lastRunAt).toBeDefined()
  })
})
