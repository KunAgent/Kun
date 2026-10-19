import { createHash } from 'node:crypto'
import type { ModelConnectionSnapshot } from '../contracts/model-connections.js'
import type { RegistryDocument } from './model-connection-registry-core.js'
import { modelCatalogWriteGeneration } from './model-catalog-store.js'

/**
 * Upper bound for facts a projection reads outside the Registry document:
 * catalog staleness ages with the clock, and credential stores can change in
 * another process without a Registry write.
 */
export const REGISTRY_SNAPSHOT_CACHE_TTL_MS = 5 * 60_000

type CachedProjection = { key: string; at: number; snapshot: ModelConnectionSnapshot }

/**
 * Memoizes the projected Registry snapshot. Projection resolves credentials,
 * reads every provider's model catalog and re-derives model capabilities; the
 * desktop long-polls `model-connections/events` and the GUI, routes and
 * gateway ask for snapshots continuously, while the inputs rarely change.
 *
 * The key covers the Registry document content, the credential health the
 * caller just inspected (credential stores change without Registry writes),
 * the catalog metadata cursor, catalog writes made by this process, and
 * explicit invalidations (runtime model profile changes). Callers always
 * receive their own copy.
 */
export class RegistrySnapshotCache {
  private entry: CachedProjection | undefined
  private inflight: { key: string; promise: Promise<ModelConnectionSnapshot> } | undefined
  private generation = 0

  constructor(private readonly now: () => number = Date.now) {}

  invalidate(): void {
    this.generation += 1
    this.entry = undefined
    this.inflight = undefined
  }

  key(document: RegistryDocument, metadataRevision: number, health: ReadonlyMap<string, unknown>): string {
    const content = createHash('sha256').update(JSON.stringify(document))
      .update(JSON.stringify([...health])).digest('base64url')
    return `${this.generation}:${modelCatalogWriteGeneration()}:${metadataRevision}:${content}`
  }

  async project(
    key: string,
    compute: () => Promise<ModelConnectionSnapshot>,
    options: { fresh?: boolean } = {}
  ): Promise<ModelConnectionSnapshot> {
    const entry = this.entry
    if (!options.fresh && entry?.key === key && this.now() - entry.at < REGISTRY_SNAPSHOT_CACHE_TTL_MS) {
      return structuredClone(entry.snapshot)
    }
    const shared = this.inflight
    if (!options.fresh && shared?.key === key) return structuredClone(await shared.promise)
    const generation = this.generation
    const startedAt = this.now()
    const promise = compute()
    this.inflight = { key, promise }
    try {
      const snapshot = await promise
      // An invalidation during the computation means its inputs may be stale.
      if (generation === this.generation) {
        this.entry = { key, at: startedAt, snapshot: structuredClone(snapshot) }
      }
      return snapshot
    } finally {
      if (this.inflight?.promise === promise) this.inflight = undefined
    }
  }

  /** Last projection, for a caller that must answer while the Registry is unreadable. */
  lastKnown(): ModelConnectionSnapshot | undefined {
    return this.entry ? structuredClone(this.entry.snapshot) : undefined
  }
}
