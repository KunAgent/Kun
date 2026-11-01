import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  normalizeStorageCleanupConfig,
  storageCleanupConsentCovers,
  storageCleanupState,
  STORAGE_CLEANUP_RULES_VERSION
} from '../../../shared/storage-cleanup'
import { StorageCleanupConfigStore } from './config-store'
import { executeCleanupPlan } from './executor'
import type { StorageCleanupPaths } from './paths'
import { buildCleanupPlan, type SlimRuntimeClient } from './planner'
import { isMigrationBackupName, listMigrationBackups } from './scan'
import { StorageTrash } from './trash'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

const NOW = new Date('2026-10-29T00:00:00.000Z')
const OLD = new Date('2026-08-01T00:00:00.000Z')

async function fixture(): Promise<StorageCleanupPaths> {
  const root = await mkdtemp(join(tmpdir(), 'kun-storage-cleanup-')); roots.push(root)
  const paths = { kunHome: join(root, 'home'), dataDir: join(root, 'home', 'data'), userData: join(root, 'user-data') }
  await mkdir(paths.dataDir, { recursive: true })
  await mkdir(paths.userData, { recursive: true })
  return paths
}

async function writeOld(path: string, content: string | Buffer, when = OLD): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content)
  await utimes(path, when, when)
}

async function thread(paths: StorageCleanupPaths, id: string, eventBytes: number, when = OLD): Promise<void> {
  const dir = join(paths.dataDir, 'threads', id)
  await writeOld(join(dir, 'events.jsonl'), Buffer.alloc(eventBytes, 120), when)
  await writeOld(join(dir, 'messages.jsonl'), '{}\n', when)
  await writeOld(join(dir, 'metadata.jsonl'), '{}\n', when)
}

function fakeRuntime(pinned: string[] = []): SlimRuntimeClient & { applied: string[][] } {
  const applied: string[][] = []
  return {
    applied,
    preview: async (threadIds) => threadIds.map((threadId) => pinned.includes(threadId)
      ? { threadId, eligible: false, skipReason: 'pinned' as const }
      : { threadId, eligible: true, title: `Title ${threadId}`, workspace: '/w', updatedAt: OLD.toISOString() }),
    apply: async (threadIds) => {
      applied.push(threadIds)
      return {
        slimmed: threadIds.filter((id) => !pinned.includes(id)).map((threadId) => ({ threadId, afterBytes: 100 })),
        skipped: threadIds.filter((id) => pinned.includes(id)).map((threadId) => ({ threadId, reason: 'pinned' }))
      }
    }
  }
}

describe('storage cleanup consent', () => {
  it('requires consent covering the current rules and threshold', () => {
    const base = normalizeStorageCleanupConfig({ enabled: true, olderThanDays: 30 })
    expect(storageCleanupState(base)).toBe('needs_consent')
    const consented = { ...base, consent: { at: NOW.toISOString(), olderThanDays: 30, rulesVersion: STORAGE_CLEANUP_RULES_VERSION } }
    expect(storageCleanupState(consented)).toBe('scheduled')
    // A longer threshold deletes less and stays covered; a shorter one does not.
    expect(storageCleanupConsentCovers({ ...consented, olderThanDays: 90 })).toBe(true)
    expect(storageCleanupConsentCovers({ ...consented, olderThanDays: 7 })).toBe(false)
    expect(storageCleanupConsentCovers({ ...consented, consent: { ...consented.consent, rulesVersion: 0 } })).toBe(false)
    expect(storageCleanupState({ ...consented, enabled: false })).toBe('off')
  })

  it('normalizes unknown input to the safe default (off, 30 days, notify)', () => {
    expect(normalizeStorageCleanupConfig({ enabled: 'yes', olderThanDays: -4, consent: { at: 'nope' } })).toEqual({
      enabled: false, olderThanDays: 1, notifyBefore: true, trashDays: 7
    })
    expect(normalizeStorageCleanupConfig(null).olderThanDays).toBe(30)
  })

  it('persists config and keeps a bounded newest-first history', async () => {
    const paths = await fixture()
    const store = new StorageCleanupConfigStore(join(paths.userData, 'c.json'), join(paths.userData, 'h.json'))
    await store.update((config) => ({ ...config, olderThanDays: 45 }))
    expect((await store.load()).olderThanDays).toBe(45)
    await store.appendHistory({ runId: 'a', reason: 'skipped', startedAt: NOW.toISOString() })
    await store.appendHistory({ runId: 'b', reason: 'skipped', startedAt: NOW.toISOString() })
    expect((await store.history()).map((entry) => entry.runId)).toEqual(['b', 'a'])
  })
})

describe('storage trash', () => {
  it('moves entries out, restores them, and purges expired runs', async () => {
    const paths = await fixture()
    const file = join(paths.kunHome, 'worktrees', 'tasks', 'empty', 'sub')
    await mkdir(file, { recursive: true })
    let now = NOW
    const trash = new StorageTrash(join(paths.kunHome, 'trash'), () => now)
    const run = await trash.begin(7)
    expect(await run.move(join(paths.kunHome, 'worktrees', 'tasks', 'empty'), 10)).toBe(true)
    // The trash never swallows itself or an ancestor of itself.
    expect(await run.move(paths.kunHome, 1)).toBe(false)
    await run.commit()
    expect(await stat(file).catch(() => null)).toBeNull()
    const summary = await trash.summary()
    expect(summary).toMatchObject({ entries: 1, bytes: 10 })
    expect(await trash.restore(summary.runs[0]!.runId)).toEqual({ restored: 1, kept: 0, failures: [] })
    expect((await stat(file)).isDirectory()).toBe(true)

    const second = await trash.begin(7)
    await second.move(file, 1)
    await second.commit()
    now = new Date(NOW.getTime() + 8 * 86_400_000)
    expect(await trash.purgeExpired()).toBe(1)
    expect((await trash.summary()).entries).toBe(0)
  })
})

describe('storage cleanup plan and run', () => {
  it('plans idle threads, empty task worktrees and stale traces, skipping protected and recent ones', async () => {
    const paths = await fixture()
    await thread(paths, 'big', 200_000)
    await thread(paths, 'pinned', 200_000)
    await thread(paths, 'small', 1_000)
    await thread(paths, 'recent', 200_000, new Date('2026-10-20T00:00:00.000Z'))
    await mkdir(join(paths.kunHome, 'worktrees', 'tasks', 'empty-ws', 'nested'), { recursive: true })
    await utimes(join(paths.kunHome, 'worktrees', 'tasks', 'empty-ws'), OLD, OLD)
    await writeOld(join(paths.kunHome, 'worktrees', 'tasks', 'with-code', 'index.ts'), 'code')
    await utimes(join(paths.kunHome, 'worktrees', 'tasks', 'with-code'), OLD, OLD)
    await writeOld(join(paths.dataDir, 'observability', 'trajectory', 'records', 'old.jsonl'), 'x'.repeat(50))
    await writeOld(join(paths.dataDir, 'observability', 'trajectory', 'records', 'new.jsonl'), 'x', new Date('2026-10-25T00:00:00.000Z'))

    const { plan } = await buildCleanupPlan({ paths, olderThanDays: 30, runtime: fakeRuntime(['pinned']), now: NOW })
    expect(plan.items.map((item) => item.id).sort()).toEqual([
      'emptyWorktree:empty-ws', 'threadSlim:big', 'trajectoryRecord:old.jsonl'
    ])
    expect(plan.skipped.pinned).toBe(1)
    expect(plan.items.find((item) => item.id === 'threadSlim:big')?.title).toBe('Title big')
  })

  it('runs only the selected items and records freed and trashed bytes', async () => {
    const paths = await fixture()
    await thread(paths, 'a', 200_000)
    await thread(paths, 'b', 200_000)
    await writeOld(join(paths.dataDir, 'threads', 'a', 'background-shells', 'x.output'), 'y'.repeat(300))
    await writeOld(join(paths.dataDir, 'observability', 'trajectory', 'records', 'old.jsonl'), 'x'.repeat(50))
    const runtime = fakeRuntime()
    const trash = new StorageTrash(join(paths.kunHome, 'trash'), () => NOW)
    const result = await executeCleanupPlan({
      paths, olderThanDays: 30, itemIds: new Set(['threadSlim:a', 'trajectoryRecord:old.jsonl', 'threadSlim:ghost']),
      runtime, trash, trashDays: 7, reason: 'manual'
    })
    expect(runtime.applied).toEqual([['a']])
    expect(result.slimmedThreads).toBe(1)
    expect(result.freedBytes).toBe(200_000 - 100)
    expect(result.trashedBytes).toBe(350)
    expect(result.movedToTrash).toBe(2)
    expect(result.lines.find((line) => line.kind === 'threadSlim')).toMatchObject({ count: 1 })
    expect(await stat(join(paths.dataDir, 'threads', 'a', 'background-shells', 'x.output')).catch(() => null)).toBeNull()
    expect(await readFile(join(paths.dataDir, 'threads', 'b', 'events.jsonl')).then((value) => value.length)).toBe(200_000)
  })
})

describe('migration backups', () => {
  it('lists settled settings and data snapshots but never credential backups or the live file', async () => {
    expect(isMigrationBackupName('kun-settings.json.bak-2026-06-18T10-20-42-515Z')).toBe(true)
    expect(isMigrationBackupName('index.sqlite3.pre-history-rebuild-20260727.bak')).toBe(true)
    expect(isMigrationBackupName('data.pre-deepseekgui-migration-20260726T151528845Z.bak')).toBe(true)
    expect(isMigrationBackupName('credential-recovery-backup-20260727-2200')).toBe(false)
    expect(isMigrationBackupName('kun-settings.pre-extension-credential-migration.json')).toBe(false)
    expect(isMigrationBackupName('kun-settings.json')).toBe(false)
    expect(isMigrationBackupName('model-connections.v2.json')).toBe(false)

    const paths = await fixture()
    await writeOld(join(paths.userData, 'kun-settings.json.bak-old'), 'x')
    await writeOld(join(paths.userData, 'kun-settings.json.bak-new'), 'x', new Date('2026-10-20T00:00:00.000Z'))
    await writeOld(join(paths.userData, 'kun-settings.json'), 'x')
    expect(await listMigrationBackups(paths, NOW)).toEqual([join(paths.userData, 'kun-settings.json.bak-old')])
  })
})
