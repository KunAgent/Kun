import { lstat, readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type {
  StorageManualItem,
  StorageUsageCategory,
  StorageUsageCategoryId,
  StorageUsageSnapshot
} from '../../../shared/storage-cleanup'
import { pathBytes } from './disk-usage'
import type { StorageCleanupPaths } from './paths'

/** Top-level entries of each root, mapped to the Settings usage categories. */
const KUN_HOME_CATEGORIES: Record<string, StorageUsageCategoryId> = {
  worktrees: 'worktrees',
  agents: 'agents',
  toolchains: 'agents',
  runtime: 'agents'
}
const DATA_DIR_CATEGORIES: Record<string, StorageUsageCategoryId> = {
  threads: 'threads',
  'child-runs': 'threads',
  'delegated-sessions': 'threads',
  rooms: 'threads',
  attachments: 'attachments',
  artifacts: 'attachments',
  observability: 'caches',
  logs: 'caches'
}
export const USER_DATA_CACHE_DIRS = ['Cache', 'Code Cache', 'GPUCache', 'DawnWebGPUCache', 'DawnGraphiteCache']
const USER_DATA_CATEGORIES: Record<string, StorageUsageCategoryId> = {
  ...Object.fromEntries(USER_DATA_CACHE_DIRS.map((name) => [name, 'caches' as const])),
  logs: 'caches',
  'antigravity-cli': 'agents',
  'agent-sdk': 'agents'
}

const MIGRATION_BACKUP = /(\.bak($|[-.])|\.pre-[\w-]+|pre-[\w-]+-migration|\.recovery-before-|\.bak-)/

/** Settings migration and repair snapshots. Credential backups are never listed. */
export function isMigrationBackupName(name: string): boolean {
  if (/credential/i.test(name)) return false
  return MIGRATION_BACKUP.test(name)
}

/** Backups only become removable once the migration that made them has settled. */
export const MIGRATION_BACKUP_MIN_AGE_DAYS = 30

export async function listMigrationBackups(paths: StorageCleanupPaths, now = new Date()): Promise<string[]> {
  const found: string[] = []
  const cutoff = now.getTime() - MIGRATION_BACKUP_MIN_AGE_DAYS * 86_400_000
  for (const root of [paths.kunHome, paths.dataDir, paths.userData]) {
    for (const name of await readdir(root).catch(() => [] as string[])) {
      // The live settings file is never a backup.
      if (name === 'kun-settings.json' || !isMigrationBackupName(name)) continue
      const info = await lstat(join(root, name)).catch(() => null)
      if (info && info.mtimeMs < cutoff) found.push(join(root, name))
    }
  }
  return [...new Set(found)]
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep))
}

async function classifyRoot(
  root: string,
  map: Record<string, StorageUsageCategoryId>,
  totals: Map<StorageUsageCategoryId, number>,
  skip: (path: string) => boolean
): Promise<void> {
  const names = await readdir(root).catch(() => [] as string[])
  await Promise.all(names.map(async (name) => {
    const path = join(root, name)
    if (skip(path)) return
    const bytes = await pathBytes(path)
    const category = map[name] ?? 'other'
    totals.set(category, (totals.get(category) ?? 0) + bytes)
  }))
}

export async function eventLogBytes(threadsDir: string): Promise<number> {
  const names = await readdir(threadsDir).catch(() => [] as string[])
  let total = 0
  await Promise.all(names.map(async (name) => {
    const info = await lstat(join(threadsDir, name, 'events.jsonl')).catch(() => null)
    if (info?.isFile()) total += info.size
  }))
  return total
}

export async function scanStorageUsage(paths: StorageCleanupPaths, now = new Date()): Promise<StorageUsageSnapshot> {
  const totals = new Map<StorageUsageCategoryId, number>()
  const dataInsideHome = isWithin(paths.kunHome, paths.dataDir)
  await Promise.all([
    classifyRoot(paths.kunHome, KUN_HOME_CATEGORIES, totals, (path) => dataInsideHome && isWithin(path, paths.dataDir)),
    classifyRoot(paths.dataDir, DATA_DIR_CATEGORIES, totals, () => false),
    classifyRoot(paths.userData, USER_DATA_CATEGORIES, totals, (path) => isWithin(path, paths.kunHome))
  ])
  const order: StorageUsageCategoryId[] = ['worktrees', 'threads', 'agents', 'caches', 'attachments', 'other']
  const eventsBytes = await eventLogBytes(join(paths.dataDir, 'threads'))
  const categories: StorageUsageCategory[] = order.map((id) => ({
    id,
    bytes: totals.get(id) ?? 0,
    ...(id === 'threads' ? { detailBytes: eventsBytes } : {})
  }))
  const cacheBytes = (await Promise.all(USER_DATA_CACHE_DIRS.map((name) => pathBytes(join(paths.userData, name)))))
    .reduce((sum, value) => sum + value, 0)
  const backups = await listMigrationBackups(paths, now)
  const backupBytes = (await Promise.all(backups.map(pathBytes))).reduce((sum, value) => sum + value, 0)
  const manualPaths: Array<Omit<StorageManualItem, 'bytes'>> = [
    { id: 'agentRuntimes', path: join(paths.kunHome, 'agents'), removable: false },
    { id: 'toolchains', path: join(paths.kunHome, 'toolchains'), removable: false },
    { id: 'avatar3d', path: join(paths.kunHome, '3d-source'), removable: false },
    { id: 'indexDatabase', path: join(paths.dataDir, 'index.sqlite3'), removable: false }
  ]
  const manual: StorageManualItem[] = await Promise.all(manualPaths.map(async (item) => ({
    ...item,
    bytes: item.id === 'avatar3d'
      ? await pathBytes(item.path) + await pathBytes(join(paths.kunHome, '3d-assets'))
      : await pathBytes(item.path)
  })))
  manual.push({ id: 'migrationBackups', path: paths.dataDir, bytes: backupBytes, removable: backups.length > 0 })
  return {
    scannedAt: now.toISOString(),
    totalBytes: categories.reduce((sum, category) => sum + category.bytes, 0),
    kunDataRoot: paths.kunHome,
    categories,
    safeCleanBytes: cacheBytes,
    manual: manual.filter((item) => item.bytes > 0)
  }
}
