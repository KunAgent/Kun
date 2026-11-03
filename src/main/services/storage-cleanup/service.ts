import { join } from 'node:path'
import {
  STORAGE_CLEANUP_NOTICE_LEAD_MS,
  STORAGE_CLEANUP_RULES_VERSION,
  STORAGE_CLEANUP_RUN_INTERVAL_DAYS,
  clampStorageCleanupDays,
  storageCleanupConsentCovers,
  storageCleanupState,
  type StorageCleanupConfig,
  type StorageCleanupConfigPatch,
  type StorageCleanupHistoryEntry,
  type StorageCleanupPlan,
  type StorageCleanupResult,
  type StorageCleanupStatus,
  type StorageTrashRestoreResponse,
  type StorageTrashSummary,
  type StorageUsageSnapshot
} from '../../../shared/storage-cleanup'
import { StorageCleanupConfigStore } from './config-store'
import { pathBytes } from './disk-usage'
import { CleanupTally, executeCleanupPlan, trashPath } from './executor'
import { storageCleanupLocations, type StorageCleanupPaths } from './paths'
import { buildCleanupPlan, staleTrajectoryRecords, type SlimRuntimeClient } from './planner'
import { listMigrationBackups, scanStorageUsage, USER_DATA_CACHE_DIRS } from './scan'
import { StorageTrash } from './trash'

const DAY_MS = 86_400_000
const TICK_MS = 6 * 60 * 60 * 1000
const FIRST_TICK_MS = 10 * 60 * 1000
/** A scheduled run that would free less than this is recorded as done without a notice. */
const NOTICE_MIN_BYTES = 50 * 1024 * 1024

export type StorageCleanupServiceDeps = {
  paths: () => Promise<StorageCleanupPaths>
  runtime: SlimRuntimeClient
  clearBrowserCaches: () => Promise<void>
  notify: (notice: { bytes: number; olderThanDays: number }) => void
  now?: () => Date
}

export class StorageCleanupService {
  private timer: NodeJS.Timeout | null = null
  private running: Promise<unknown> | null = null
  private storeCache: { key: string; store: StorageCleanupConfigStore } | null = null
  private configVersion = 0
  private configUpdates = 0

  constructor(private readonly deps: StorageCleanupServiceDeps) {}

  private now(): Date { return this.deps.now?.() ?? new Date() }

  private async context(): Promise<{ paths: StorageCleanupPaths; store: StorageCleanupConfigStore; trash: StorageTrash }> {
    const paths = await this.deps.paths()
    const key = `${paths.userData}\0${paths.kunHome}`
    if (this.storeCache?.key !== key) {
      this.storeCache = {
        key,
        store: new StorageCleanupConfigStore(storageCleanupLocations.config(paths), storageCleanupLocations.history(paths))
      }
    }
    return { paths, store: this.storeCache.store, trash: new StorageTrash(storageCleanupLocations.trashRoot(paths), () => this.now()) }
  }

  /** One cleanup at a time: scheduled runs, manual runs and cache clears share disk and Kun. */
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.running) return Promise.reject(new Error('A storage cleanup is already running.'))
    const promise = work().finally(() => { this.running = null })
    this.running = promise
    return promise
  }

  /** Invalidate scheduled work before the first await, including while preferences are being saved. */
  private async changeConfig(mutate: (config: StorageCleanupConfig) => StorageCleanupConfig): Promise<void> {
    this.configVersion += 1
    this.configUpdates += 1
    try {
      const { store } = await this.context()
      await store.update(mutate)
    } finally {
      this.configUpdates -= 1
    }
  }

  private isCurrent(version: number): boolean {
    return version === this.configVersion && this.configUpdates === 0
  }

  private nextRunAt(config: StorageCleanupConfig): string | undefined {
    if (storageCleanupState(config) !== 'scheduled' && storageCleanupState(config) !== 'pending') return undefined
    if (config.pendingRunAt) return config.pendingRunAt
    const last = config.lastRunAt ? Date.parse(config.lastRunAt) : 0
    const skip = config.skipUntil ? Date.parse(config.skipUntil) : 0
    const due = Math.max(last + STORAGE_CLEANUP_RUN_INTERVAL_DAYS * DAY_MS, skip, this.now().getTime())
    // With a notice, the run itself lands a day after the notice goes out.
    return new Date(due + (config.notifyBefore ? STORAGE_CLEANUP_NOTICE_LEAD_MS : 0)).toISOString()
  }

  async status(): Promise<StorageCleanupStatus> {
    const { store, trash } = await this.context()
    const config = await store.load()
    const nextRunAt = this.nextRunAt(config)
    return { config, state: storageCleanupState(config), ...(nextRunAt ? { nextRunAt } : {}), trash: await trash.summary() }
  }

  async scan(): Promise<StorageUsageSnapshot> {
    return scanStorageUsage((await this.context()).paths, this.now())
  }

  async enable(olderThanDays: number): Promise<StorageCleanupStatus> {
    const days = clampStorageCleanupDays(olderThanDays)
    await this.changeConfig((config) => ({
      ...config,
      enabled: true,
      olderThanDays: days,
      consent: { at: this.now().toISOString(), olderThanDays: days, rulesVersion: STORAGE_CLEANUP_RULES_VERSION }
    }))
    return this.status()
  }

  async disable(): Promise<StorageCleanupStatus> {
    await this.changeConfig(({ pendingRunAt: _pending, ...config }) => ({ ...config, enabled: false }))
    return this.status()
  }

  /** Changes never widen consent: a shorter threshold flips the state to needs_consent. */
  async updateConfig(patch: StorageCleanupConfigPatch): Promise<StorageCleanupStatus> {
    await this.changeConfig((config) => {
      const next = {
        ...config,
        ...(patch.olderThanDays !== undefined ? { olderThanDays: clampStorageCleanupDays(patch.olderThanDays) } : {}),
        ...(patch.notifyBefore !== undefined ? { notifyBefore: patch.notifyBefore } : {}),
        ...(patch.trashDays !== undefined ? { trashDays: clampStorageCleanupDays(patch.trashDays, config.trashDays) } : {})
      }
      if (!storageCleanupConsentCovers(next)) delete next.pendingRunAt
      return next
    })
    return this.status()
  }

  async preview(olderThanDays?: number): Promise<StorageCleanupPlan> {
    const { paths, store } = await this.context()
    const days = clampStorageCleanupDays(olderThanDays ?? (await store.load()).olderThanDays)
    return (await buildCleanupPlan({ paths, olderThanDays: days, runtime: this.deps.runtime, now: this.now() })).plan
  }

  run(olderThanDays: number, itemIds: string[]): Promise<StorageCleanupResult> {
    return this.exclusive(async () => {
      const { paths, store, trash } = await this.context()
      const config = await store.load()
      const result = await executeCleanupPlan({
        paths, olderThanDays: clampStorageCleanupDays(olderThanDays), itemIds: new Set(itemIds),
        runtime: this.deps.runtime, trash, trashDays: config.trashDays, reason: 'manual'
      })
      await store.appendHistory(result)
      return result
    })
  }

  clearCaches(): Promise<StorageCleanupResult> {
    return this.exclusive(async () => {
      const { paths, store, trash } = await this.context()
      const tally = new CleanupTally()
      const cacheBytes = async (): Promise<number> =>
        (await Promise.all(USER_DATA_CACHE_DIRS.map((name) => pathBytes(join(paths.userData, name))))).reduce((a, b) => a + b, 0)
      const before = await cacheBytes()
      await this.deps.clearBrowserCaches()
      const freed = Math.max(0, before - await cacheBytes())
      tally.freedBytes += freed
      tally.add('cache', freed)
      const run = await trash.begin((await store.load()).trashDays)
      for (const record of await staleTrajectoryRecords(storageCleanupLocations.trajectoryRecords(paths), this.now().getTime())) {
        await trashPath(run.move, tally, 'trajectoryRecord', record.path, record.bytes)
      }
      await run.commit()
      const result = tally.finish(run.runId, 'caches')
      await store.appendHistory(result)
      return result
    })
  }

  removeMigrationBackups(): Promise<StorageCleanupResult> {
    return this.exclusive(async () => {
      const { paths, store, trash } = await this.context()
      const tally = new CleanupTally()
      const run = await trash.begin((await store.load()).trashDays)
      for (const path of await listMigrationBackups(paths, this.now())) {
        await trashPath(run.move, tally, 'backup', path, await pathBytes(path))
      }
      await run.commit()
      const result = tally.finish(run.runId, 'manual')
      await store.appendHistory(result)
      return result
    })
  }

  async skipPendingRun(): Promise<StorageCleanupStatus> {
    const now = this.now()
    await this.changeConfig(({ pendingRunAt: _pending, ...config }) => ({
      ...config,
      skipUntil: new Date(now.getTime() + STORAGE_CLEANUP_RUN_INTERVAL_DAYS * DAY_MS).toISOString()
    }))
    const { store } = await this.context()
    await store.appendHistory({ runId: `skip-${now.getTime()}`, reason: 'skipped', startedAt: now.toISOString() })
    return this.status()
  }

  async history(): Promise<StorageCleanupHistoryEntry[]> {
    return (await this.context()).store.history()
  }

  async restoreTrashRun(runId: string): Promise<StorageTrashRestoreResponse> {
    const { trash } = await this.context()
    const result = await trash.restore(runId)
    return { ...result, trash: await trash.summary() }
  }

  async emptyTrash(): Promise<StorageTrashSummary> {
    const { trash } = await this.context()
    await trash.empty()
    return trash.summary()
  }

  async dataPaths(): Promise<StorageCleanupPaths> {
    return (await this.context()).paths
  }

  start(): void {
    this.stop()
    const tick = (): void => { void this.tick().catch((error) => console.warn('[kun-gui] storage cleanup tick failed', error)) }
    const first = setTimeout(tick, FIRST_TICK_MS)
    first.unref?.()
    this.timer = setInterval(tick, TICK_MS)
    this.timer.unref?.()
  }

  stop(): void {
    this.configVersion += 1
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Purge expired trash, then advance the notice → run cycle when consent covers it. */
  async tick(): Promise<void> {
    if (this.running || this.configUpdates > 0) return
    const version = this.configVersion
    const { paths, store, trash } = await this.context()
    await trash.purgeExpired()
    const config = await store.load()
    if (!this.isCurrent(version) || !config.enabled || !storageCleanupConsentCovers(config)) return
    const now = this.now().getTime()
    if (config.pendingRunAt) {
      if (Date.parse(config.pendingRunAt) > now) return
      await this.runScheduled(version)
      return
    }
    const due = Math.max(
      config.lastRunAt ? Date.parse(config.lastRunAt) + STORAGE_CLEANUP_RUN_INTERVAL_DAYS * DAY_MS : 0,
      config.skipUntil ? Date.parse(config.skipUntil) : 0
    )
    if (due > now) return
    if (!config.notifyBefore) {
      await this.runScheduled(version)
      return
    }
    const { plan } = await buildCleanupPlan({ paths, olderThanDays: config.olderThanDays, runtime: this.deps.runtime, now: this.now() })
    if (!this.isCurrent(version)) return
    let notify = false
    await store.update((current) => {
      if (!this.isCurrent(version) || !current.enabled || !storageCleanupConsentCovers(current)) return current
      if (plan.totalBytes < NOTICE_MIN_BYTES) return { ...current, lastRunAt: new Date(now).toISOString() }
      notify = true
      return { ...current, pendingRunAt: new Date(now + STORAGE_CLEANUP_NOTICE_LEAD_MS).toISOString() }
    })
    if (notify && this.isCurrent(version)) this.deps.notify({ bytes: plan.totalBytes, olderThanDays: config.olderThanDays })
  }

  private runScheduled(version: number): Promise<StorageCleanupResult | undefined> {
    return this.exclusive(async () => {
      const { paths, store, trash } = await this.context()
      const config = await store.load()
      if (!this.isCurrent(version) || !config.enabled || !storageCleanupConsentCovers(config)) return
      const shouldContinue = (): boolean => this.isCurrent(version)
      const result = await executeCleanupPlan({
        paths, olderThanDays: config.olderThanDays, itemIds: 'all', runtime: this.deps.runtime,
        trash, trashDays: config.trashDays, reason: 'scheduled', shouldContinue
      })
      // A cancelled run must not consume the next schedule or erase a newer notice/skip.
      if (shouldContinue()) {
        await store.update((current) => {
          if (!shouldContinue()) return current
          const { pendingRunAt: _pending, ...next } = current
          return { ...next, lastRunAt: result.finishedAt }
        })
      }
      if (shouldContinue() || result.slimmedThreads > 0 || result.movedToTrash > 0 || result.failed > 0) {
        await store.appendHistory(result)
      }
      return result
    })
  }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}
