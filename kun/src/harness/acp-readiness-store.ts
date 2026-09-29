/**
 * Persisted ACP readiness cache (P4-03): a successful `initialize`
 * handshake stays valid for 24h while the resolved command and version are
 * unchanged, so a runtime restart does not re-spawn every ACP agent just
 * to fill the catalog. Failures are never cached — a crashed or timed-out
 * probe is re-run on the next detection pass.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HarnessId } from '../contracts/harness.js'

export const ACP_READINESS_CACHE_TTL_MS = 24 * 60 * 60 * 1_000
const CACHE_FILE = 'harness-readiness.json'

type ReadinessEntry = {
  command: string
  version?: string
  ready: 'yes'
  checkedAt: string
}

type ReadinessFile = { version: 1; entries: Record<string, ReadinessEntry> }

export type AcpReadinessCacheView = {
  /** 'yes' only when a fresh entry matches the resolved command+version. */
  get(id: HarnessId, command: string, version: string | undefined): Promise<'yes' | undefined>
  /** Record a successful probe; resolves after the write lands. */
  set(id: HarnessId, command: string, version: string | undefined): Promise<void>
  /** Drop the entry — a real turn launch failure invalidates the cache. */
  clear(id: HarnessId): Promise<void>
}

export class AcpReadinessStore implements AcpReadinessCacheView {
  private entries: Record<string, ReadinessEntry> | undefined
  /** Serializes load+mutate+persist so writes never interleave. */
  private queue: Promise<Record<string, ReadinessEntry>> | undefined

  constructor(
    private readonly deps: {
      dataDir: string
      nowMs: () => number
      nowIso: () => string
    }
  ) {}

  async get(id: HarnessId, command: string, version: string | undefined): Promise<'yes' | undefined> {
    const entries = await this.loaded()
    const entry = entries[id]
    if (!entry || entry.command !== command || entry.version !== version) return undefined
    const age = this.deps.nowMs() - Date.parse(entry.checkedAt)
    if (!Number.isFinite(age) || age > ACP_READINESS_CACHE_TTL_MS) return undefined
    return 'yes'
  }

  set(id: HarnessId, command: string, version: string | undefined): Promise<void> {
    return this.mutate((entries) => {
      entries[id] = {
        command,
        ...(version ? { version } : {}),
        ready: 'yes',
        checkedAt: this.deps.nowIso()
      }
    })
  }

  clear(id: HarnessId): Promise<void> {
    return this.mutate((entries) => {
      delete entries[id]
    })
  }

  /** Serializes mutate+persist so concurrent writes never race the tmp file. */
  private mutate(update: (entries: Record<string, ReadinessEntry>) => void): Promise<void> {
    const run = this.loaded()
      .then(async (entries) => {
        update(entries)
        await this.persist()
      })
      .catch(() => undefined)
    // Keep the shared queue alive but never blocked by a failed write.
    this.queue = run.then(() => this.entries ?? {})
    return run
  }

  /**
   * Lazily reads the cache file once; concurrent callers share the load,
   * a corrupt or missing file starts empty, and a failed read never
   * poisons later calls (the next `loaded()` retries).
   */
  private loaded(): Promise<Record<string, ReadinessEntry>> {
    this.queue ??= this.readEntries()
      .then((entries) => {
        this.entries = entries
        return entries
      })
      .catch(() => {
        this.queue = undefined
        this.entries = {}
        return this.entries
      })
    return this.queue
  }

  private async readEntries(): Promise<Record<string, ReadinessEntry>> {
    const raw = await readFile(this.path(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<ReadinessFile>
    if (parsed.version !== 1 || typeof parsed.entries !== 'object' || !parsed.entries) {
      return {}
    }
    return parsed.entries
  }

  private async persist(): Promise<void> {
    if (!this.entries) return
    const path = this.path()
    await mkdir(this.deps.dataDir, { recursive: true })
    const tmp = `${path}.${process.pid}.tmp`
    const body: ReadinessFile = { version: 1, entries: this.entries }
    await writeFile(tmp, JSON.stringify(body, null, 2), 'utf8')
    await rename(tmp, path)
  }

  private path(): string {
    return join(this.deps.dataDir, CACHE_FILE)
  }
}
