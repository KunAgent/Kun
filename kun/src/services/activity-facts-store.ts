import { join } from 'node:path'
import { AtomicJsonFile } from '../extensions/atomic-json.js'
import { withManagerDataMutex } from '../manager/data-mutex.js'

/**
 * Cross-client user facts for activity rows (acknowledged / dismissed /
 * pinned) — the only ActivityStore state persisted across restarts
 * (docs/ade/06 §8). Lives at dataDir/ade/activity-facts.json and is
 * written through the Manager data mutex with a 2s debounce.
 */
export type ActivityUserFact = {
  acknowledgedAt?: string
  dismissedAt?: string
  pinned?: boolean
}

type ActivityFactsFile = {
  version: 1
  facts: Record<string, ActivityUserFact>
}

const FLUSH_DELAY_MS = 2_000
const FACTS_MUTEX_RESOURCE = 'ade/activity-facts'

function parseFactsFile(value: unknown): ActivityFactsFile {
  const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  const facts = typeof record.facts === 'object' && record.facts !== null
    ? record.facts as Record<string, unknown>
    : {}
  const out: Record<string, ActivityUserFact> = {}
  for (const [unitId, fact] of Object.entries(facts)) {
    if (typeof fact !== 'object' || fact === null) continue
    const entry = fact as Record<string, unknown>
    out[unitId] = {
      ...(typeof entry.acknowledgedAt === 'string' ? { acknowledgedAt: entry.acknowledgedAt } : {}),
      ...(typeof entry.dismissedAt === 'string' ? { dismissedAt: entry.dismissedAt } : {}),
      ...(entry.pinned === true ? { pinned: true } : {})
    }
  }
  return { version: 1, facts: out }
}

export class ActivityFactsStore {
  private readonly file: AtomicJsonFile<ActivityFactsFile>
  private facts: Record<string, ActivityUserFact> = {}
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private writeChain: Promise<void> = Promise.resolve()
  private mutationCount = 0
  private writtenCount = 0

  constructor(options: { dataDir: string; flushDelayMs?: number }) {
    this.file = new AtomicJsonFile(
      join(options.dataDir, 'ade', 'activity-facts.json'),
      parseFactsFile
    )
    this.flushDelayMs = options.flushDelayMs ?? FLUSH_DELAY_MS
  }

  private readonly flushDelayMs: number

  async load(): Promise<void> {
    const file = await this.file.read(() => ({ version: 1, facts: {} }))
    this.facts = file.facts
  }

  get(unitId: string): ActivityUserFact | undefined {
    return this.facts[unitId]
  }

  all(): Record<string, ActivityUserFact> {
    return { ...this.facts }
  }

  /** Merge fact fields in memory and schedule a debounced durable write. */
  setFact(unitId: string, patch: ActivityUserFact): ActivityUserFact {
    const merged: ActivityUserFact = { ...this.facts[unitId], ...patch }
    this.facts[unitId] = merged
    this.mutationCount += 1
    this.scheduleFlush()
    return merged
  }

  removeFact(unitId: string): void {
    if (!(unitId in this.facts)) return
    delete this.facts[unitId]
    this.mutationCount += 1
    this.scheduleFlush()
  }

  /** Persist immediately; also used as the debounced flush path. */
  flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    this.writeChain = this.writeChain.then(async () => {
      const count = this.mutationCount
      if (count === this.writtenCount) return
      const snapshot: ActivityFactsFile = { version: 1, facts: { ...this.facts } }
      await withManagerDataMutex(FACTS_MUTEX_RESOURCE, () => this.file.write(snapshot))
      this.writtenCount = count
      if (this.mutationCount !== this.writtenCount) this.scheduleFlush()
    })
    return this.writeChain.catch(() => undefined)
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      void this.flush()
    }, this.flushDelayMs)
    this.flushTimer.unref?.()
  }
}
