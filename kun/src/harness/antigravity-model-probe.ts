/**
 * Antigravity's own model list for the composer, from `agy models` (no
 * prompt). Results are cached per executable for ten minutes and shared with
 * in-flight requests; Check & enable seeds the cache with its own run.
 */
import type { HarnessDefinition } from '../contracts/harness.js'
import type { HarnessModelCatalog } from '../contracts/harness-models.js'
import { resolveExecutable } from '../process/owned-process.js'
import { harnessExecutableEnv } from './harness-executable-env.js'
import { harnessExecutableIdentity } from './harness-executable-identity.js'
import { spawnCaptured, type SpawnCaptured } from './harness-detector.js'
import { nativeAgentNetworkEnv } from './native-agent-network.js'
import { AGY_MODELS_TIMEOUT_MS, agyModelCatalog } from './antigravity-readiness-probe.js'

const CACHE_MS = 10 * 60_000
const FAILURE_CACHE_MS = 30_000
const EMPTY: HarnessModelCatalog = { models: [], modelInfo: [] }

export class AntigravityModelProbe {
  private revision = 0
  private readonly cache = new Map<string, { catalog: HarnessModelCatalog; expires: number }>()
  private readonly pending = new Map<string, Promise<HarnessModelCatalog>>()
  constructor(private readonly deps: {
    binaryPath?: (id: string) => string | undefined
    spawn?: SpawnCaptured
    resolve?: (command: string) => Promise<string | undefined>
    nowMs?: () => number
    /** Receives each successful listing, e.g. to keep it across restarts. */
    onCatalog?: (definition: HarnessDefinition, catalog: HarnessModelCatalog) => void
  } = {}) {}

  invalidate(): void { this.revision++; this.cache.clear(); this.pending.clear() }

  peek(definition: HarnessDefinition): string[] | undefined {
    const cached = this.cache.get(this.key(definition))
    return cached && cached.expires > this.now() && cached.catalog.models.length ? cached.catalog.models : undefined
  }

  /** Spawn-free cached model facts, under the same freshness rule as `peek`. */
  peekInfo(definition: HarnessDefinition): HarnessModelCatalog['modelInfo'] | undefined {
    return this.peek(definition) ? this.cache.get(this.key(definition))?.catalog.modelInfo : undefined
  }

  /** Check & enable already ran `agy models`; reuse it instead of a second run. */
  seed(definition: HarnessDefinition, catalog: HarnessModelCatalog): void {
    if (catalog.models.length) this.cache.set(this.key(definition), { catalog, expires: this.now() + CACHE_MS })
  }

  async probe(definition: HarnessDefinition): Promise<string[]> { return (await this.probeCatalog(definition)).models }

  /** Never throws; a failed run returns an empty catalog, cached briefly. */
  async probeCatalog(definition: HarnessDefinition): Promise<HarnessModelCatalog> {
    const key = this.key(definition)
    const cached = this.cache.get(key)
    if (cached && cached.expires > this.now()) return cached.catalog
    const inFlight = this.pending.get(key)
    if (inFlight) return inFlight
    const revision = this.revision
    const task = this.run(definition).then((catalog) => {
      if (revision === this.revision) this.cache.set(key, { catalog, expires: this.now() + (catalog.models.length ? CACHE_MS : FAILURE_CACHE_MS) })
      if (catalog.models.length > 0) this.deps.onCatalog?.(definition, catalog)
      return catalog
    }).catch(() => EMPTY).finally(() => { if (this.pending.get(key) === task) this.pending.delete(key) })
    this.pending.set(key, task)
    return task
  }

  private async run(definition: HarnessDefinition): Promise<HarnessModelCatalog> {
    const candidate = this.deps.binaryPath?.(definition.id) ?? definition.detect?.command
    if (!candidate) return EMPTY
    const command = await (this.deps.resolve ?? ((name: string) => resolveExecutable(name, { env: harnessExecutableEnv() })))(candidate)
    if (!command) return EMPTY
    const result = await (this.deps.spawn ?? spawnCaptured)(command, ['models'], { timeoutMs: AGY_MODELS_TIMEOUT_MS,
      env: { ...nativeAgentNetworkEnv(definition), ...definition.launch?.env } })
    return agyModelCatalog(result.stdout)
  }

  private key(definition: HarnessDefinition): string {
    const path = this.deps.binaryPath?.(definition.id)
    return `${this.revision}:${definition.id}:${path ?? ''}:${harnessExecutableIdentity(path ?? definition.detect?.command)}`
  }

  private now(): number { return this.deps.nowMs?.() ?? Date.now() }
}
