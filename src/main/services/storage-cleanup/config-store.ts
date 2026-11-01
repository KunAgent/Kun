import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  normalizeStorageCleanupConfig,
  type StorageCleanupConfig,
  type StorageCleanupHistoryEntry
} from '../../../shared/storage-cleanup'

const HISTORY_LIMIT = 100

async function writeAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  await writeFile(temp, text, { mode: 0o600 })
  await rename(temp, path)
}

/** Cleanup preferences, consent and run history, kept beside kun-settings.json. */
export class StorageCleanupConfigStore {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly configPath: string, private readonly historyPath: string) {}

  async load(): Promise<StorageCleanupConfig> {
    const raw = await readFile(this.configPath, 'utf8').catch(() => null)
    if (!raw) return normalizeStorageCleanupConfig({})
    try {
      return normalizeStorageCleanupConfig(JSON.parse(raw))
    } catch {
      return normalizeStorageCleanupConfig({})
    }
  }

  /** Serialized read-modify-write so the scheduler and IPC never interleave. */
  update(mutate: (current: StorageCleanupConfig) => StorageCleanupConfig): Promise<StorageCleanupConfig> {
    const next = this.queue.then(async () => {
      const value = normalizeStorageCleanupConfig(mutate(await this.load()))
      await writeAtomic(this.configPath, JSON.stringify(value, null, 2))
      return value
    })
    this.queue = next.catch(() => undefined)
    return next
  }

  async history(): Promise<StorageCleanupHistoryEntry[]> {
    const raw = await readFile(this.historyPath, 'utf8').catch(() => null)
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw) as unknown
      return Array.isArray(parsed) ? parsed as StorageCleanupHistoryEntry[] : []
    } catch {
      return []
    }
  }

  async appendHistory(entry: StorageCleanupHistoryEntry): Promise<void> {
    const next = this.queue.then(async () => {
      const entries = [entry, ...(await this.history())].slice(0, HISTORY_LIMIT)
      await writeAtomic(this.historyPath, JSON.stringify(entries, null, 2))
    })
    this.queue = next.catch(() => undefined)
    await next
  }
}
