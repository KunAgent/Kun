import { harnessExecutableIdentity } from './harness-executable-identity.js'
/**
 * ACP model probing for `GET /v1/harnesses/:id/models` (docs/ade/03 §12.2).
 * Opens a throwaway connection, calls `session/new`, and reads the `model`
 * config option's value list or legacy availableModels list. No prompt is sent, so the probe incurs
 * no model usage. Results are cached for ten minutes; concurrent probes for
 * the same harness share one in-flight request. A transient agent failure
 * (for example a backend timeout inside `session/new`) is retried once, and
 * the categorical reason of a final failure is returned instead of an
 * indistinguishable empty list.
 */
import { tmpdir } from 'node:os'
import { AcpConnection } from '../runtime/acp/acp-connection.js'
import { AcpClientHost } from '../runtime/acp/acp-client-host.js'
import { applyAcpSessionModel, parseAcpLegacyModels } from '../runtime/acp/acp-legacy-models.js'
import { isAcpAuthenticationRequired } from '../runtime/acp/acp-authentication.js'
import type { HarnessModelCatalog, HarnessModelCatalogError } from '../contracts/harness-models.js'
import { acpModelCatalog } from './acp-model-catalog.js'
import { startAcpProcess, type AcpSpawnFn } from '../runtime/acp/acp-process.js'
import {
  ACP_AGENT_METHODS,
  AcpError,
  AcpNewSessionResultSchema,
  type AcpConfigOption
} from '../runtime/acp/acp-schema.js'
import type { HarnessDefinition, HarnessId } from '../contracts/harness.js'
import { nativeAgentLaunchEnv } from './native-agent-network.js'
import {
  resolveHarnessSecretEnv,
  type HarnessSecretRefResolver
} from './harness-secret-env.js'

export const ACP_MODEL_PROBE_CACHE_MS = 10 * 60 * 1_000
export const ACP_MODEL_PROBE_FAILURE_CACHE_MS = 30_000
const ACP_PROBE_SESSION_TIMEOUT_MS = 30_000
const ACP_PROBE_RETRY_DELAY_MS = 1_000
/** A warm probe process is reused for this long after its last lookup. */
export const ACP_PROBE_IDLE_MS = 60_000

export type AcpModelProbeDeps = {
  /** Settings `harnesses.binaryPaths` override for `launch.command`. */
  binaryPath?: (harnessId: HarnessId) => string | undefined
  /** Resolves `launch.secretEnv` refs so the probe sees the real env (P4-12). */
  resolveSecretEnv?: HarnessSecretRefResolver
  spawn?: AcpSpawnFn
  nowMs?: () => number
  cacheMs?: number
  /** Delay before the single transient retry; tests pass 0. */
  retryDelayMs?: number
  /** Diagnostic sink for failed probes; defaults to stderr (the Kun log). */
  log?: (line: string) => void
  /** Idle lifetime of the reused probe process; tests pass small values. */
  idleMs?: number
}

type PooledProbe = { conn: AcpConnection; users: number; timer?: ReturnType<typeof setTimeout> }

class AcpModelProbeFailure extends Error {
  constructor(readonly reason: HarnessModelCatalogError) { super(reason.message ?? reason.code) }
}

/** Classify without echoing stderr or env: only the agent's own error text survives. */
export function acpModelProbeError(error: unknown): HarnessModelCatalogError {
  if (error instanceof AcpModelProbeFailure) return error.reason
  const message = error instanceof Error ? error.message.replace(/\s+/g, ' ').trim().slice(0, 240) : undefined
  if (isAcpAuthenticationRequired(error)) return { code: 'auth_required', ...(message ? { message } : {}) }
  if (error instanceof AcpError) {
    if (error.code === 'request_timeout') return { code: 'timeout', ...(message ? { message } : {}) }
    // A process that exits during startup (bad plugin, missing runtime) fails
    // the same way again; report it instead of spawning a second copy.
    if (error.code === 'harness_crashed') return { code: 'spawn_failed', ...(message ? { message } : {}) }
    if (error.code === 'agent_error') return { code: 'agent_error', ...(message ? { message } : {}) }
    if (error.code === 'harness_protocol_error') return { code: 'protocol_error', ...(message ? { message } : {}) }
    return { code: 'unavailable', ...(message ? { message } : {}) }
  }
  return { code: 'spawn_failed', ...(message ? { message } : {}) }
}

/** Login, protocol and startup-crash failures are stable; agent and timeout failures are worth one retry. */
function retryable(reason: HarnessModelCatalogError): boolean {
  return reason.code === 'agent_error' || reason.code === 'timeout' || reason.code === 'unavailable'
}

export class AcpModelProbe {
  private readonly generations = new Map<string, number>()
  /**
   * Invalidate one harness (or every harness when omitted). In-flight probes
   * are left to finish under their old key so a refresh never spawns two
   * processes for the same request.
   */
  invalidate(id?: string): void {
    if (id === undefined) {
      for (const key of new Set([...this.generations.keys(), ...[...this.cache.keys()].map(harnessOfKey)])) this.bump(key)
      this.cache.clear()
      return
    }
    this.bump(id)
    for (const key of [...this.cache.keys()]) if (harnessOfKey(key) === id) this.cache.delete(key)
    // An explicit refresh gets a fresh process (for example after a login).
    for (const [key, entry] of [...this.connections]) if (harnessOfKey(key) === id && entry.users === 0) this.drop(key, entry)
  }

  /** Close every warm probe process (runtime shutdown). */
  dispose(): void {
    for (const [key, entry] of [...this.connections]) this.drop(key, entry)
  }
  fetchedAt(definition: HarnessDefinition, selectedModel?: string): string | undefined {
    const value = this.cache.get(this.cacheKey(definition, selectedModel))?.fetchedAt
    return value ? new Date(value).toISOString() : undefined
  }
  private readonly cache = new Map<
    string,
    { expiresAt: number; fetchedAt?: number; catalog: HarnessModelCatalog }
  >()
  private readonly pending = new Map<string, Promise<HarnessModelCatalog>>()
  /**
   * Last successful catalog per launch identity, independent of refresh
   * generations: a failed refresh keeps showing it (marked with `error`)
   * instead of collapsing a working model menu to empty.
   */
  private readonly lastGood = new Map<string, HarnessModelCatalog>()
  /**
   * One warm `acp` process per launch identity. A cold Agent start can take
   * seconds and also boots the user's own MCP servers, so the catalog lookup
   * and every per-model detail lookup share it until it idles out.
   */
  private readonly connections = new Map<string, PooledProbe>()
  private readonly connecting = new Map<string, Promise<PooledProbe>>()

  constructor(private readonly deps: AcpModelProbeDeps = {}) {}

  /**
   * Spawn-free read of the cached probe result. Returns `undefined` when no
   * fresh successful list is cached (absent, expired, or a failed probe) so
   * callers fall back to `staticModels` without blocking on a process spawn.
   */
  peek(definition: HarnessDefinition): string[] | undefined {
    const cached = this.cache.get(this.cacheKey(definition))
    return cached && cached.expiresAt > this.nowMs() && cached.catalog.models.length > 0
      ? cached.catalog.models
      : undefined
  }

  /** Best-effort probe; never throws — failures return `[]`. */
  async probe(definition: HarnessDefinition): Promise<string[]> {
    return (await this.probeCatalog(definition)).models
  }

  /** Never throws; a failure returns no models plus its categorical `error`. */
  async probeCatalog(definition: HarnessDefinition, selectedModel?: string): Promise<HarnessModelCatalog> {
    const key = this.cacheKey(definition, selectedModel)
    const cached = this.cache.get(key)
    if (cached && cached.expiresAt > this.nowMs()) return cached.catalog
    const inFlight = this.pending.get(key)
    if (inFlight) return inFlight
    const started = this.nowMs()
    const task = this.probeWithRetry(definition, selectedModel)
      .then((catalog) => {
        this.store(key, catalog, this.deps.cacheMs ?? ACP_MODEL_PROBE_CACHE_MS)
        if (catalog.models.length > 0) {
          if (this.lastGood.size >= 32) this.lastGood.delete(this.lastGood.keys().next().value!)
          this.lastGood.set(this.identityKey(definition, selectedModel), catalog)
        }
        return catalog
      })
      .catch((error: unknown) => {
        // A failed probe is cached briefly so polling does not hammer a
        // broken binary; an explicit refresh invalidates it immediately.
        const reason = acpModelProbeError(error)
        const previous = this.lastGood.get(this.identityKey(definition, selectedModel))
        const catalog: HarnessModelCatalog = previous
          ? { ...previous, error: reason }
          : { models: [], modelInfo: [], error: reason }
        this.store(key, catalog, ACP_MODEL_PROBE_FAILURE_CACHE_MS)
        this.log(`[harness] ${definition.id} model catalog probe failed after ${this.nowMs() - started}ms: ` +
          `${reason.code}${reason.message ? ` (${reason.message})` : ''}`)
        return catalog
      })
      .finally(() => {
        if (this.pending.get(key) === task) this.pending.delete(key)
      })
    this.pending.set(key, task)
    return task
  }

  private async probeWithRetry(definition: HarnessDefinition, selectedModel?: string): Promise<HarnessModelCatalog> {
    try {
      return await this.probeUncached(definition, selectedModel)
    } catch (error) {
      const reason = acpModelProbeError(error)
      if (!retryable(reason)) throw error
      const delay = this.deps.retryDelayMs ?? ACP_PROBE_RETRY_DELAY_MS
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
      return this.probeUncached(definition, selectedModel)
    }
  }

  private async probeUncached(definition: HarnessDefinition, selectedModel?: string): Promise<HarnessModelCatalog> {
    const lease = await this.acquire(definition)
    const conn = lease.conn
    try {
      const raw = await conn.rpc.request(
        ACP_AGENT_METHODS.sessionNew,
        { cwd: tmpdir(), mcpServers: [] },
        { timeoutMs: ACP_PROBE_SESSION_TIMEOUT_MS }
      )
      const parsed = AcpNewSessionResultSchema.safeParse(raw)
      if (!parsed.success) {
        throw new AcpModelProbeFailure({ code: 'protocol_error', message: 'session/new returned an unrecognized result' })
      }
      const session = { ...parsed.data, models: parseAcpLegacyModels(parsed.data.models) }
      const initial = acpModelCatalog({ harnessId: definition.id, ...parsed.data })
      const off = conn.subscribeSession(session.sessionId, { onUpdate: (update) => {
        if (update.sessionUpdate === 'config_option_update') {
          session.configOptions = (update as { configOptions: AcpConfigOption[] }).configOptions
        }
      } })
      try {
        if (selectedModel) await applyAcpSessionModel(conn, session, selectedModel)
        const catalog = acpModelCatalog({ harnessId: definition.id, configOptions: session.configOptions,
          models: session.models ? { ...(parsed.data.models as object), currentModelId: session.models.currentModelId } : parsed.data.models,
          defaultModel: initial.modelInfo.find((entry) => entry.isDefault)?.id })
        lease.release(true)
        return catalog
      } finally { off() }
    } catch (error) {
      // A failed lookup never leaves a possibly wedged process in the pool.
      lease.release(false)
      throw error
    }
  }

  private async acquire(definition: HarnessDefinition): Promise<{ conn: AcpConnection; release(healthy: boolean): void }> {
    const key = this.identityKey(definition)
    let entry = this.connections.get(key)
    if (entry?.conn.closed) { this.drop(key, entry); entry = undefined }
    if (!entry) {
      let pending = this.connecting.get(key)
      if (!pending) {
        pending = this.connect(definition).then((conn) => {
          const created: PooledProbe = { conn, users: 0 }
          this.connections.set(key, created)
          conn.onExit(() => this.drop(key, created))
          return created
        }).finally(() => this.connecting.delete(key))
        this.connecting.set(key, pending)
      }
      entry = await pending
    }
    const leased = entry
    leased.users += 1
    if (leased.timer) { clearTimeout(leased.timer); leased.timer = undefined }
    let released = false
    return { conn: leased.conn, release: (healthy) => {
      if (released) return
      released = true
      leased.users -= 1
      if (!healthy) { this.drop(key, leased); return }
      if (leased.users === 0 && this.connections.get(key) === leased) {
        leased.timer = setTimeout(() => this.drop(key, leased), this.deps.idleMs ?? ACP_PROBE_IDLE_MS)
        leased.timer.unref?.()
      }
    } }
  }

  private async connect(definition: HarnessDefinition): Promise<AcpConnection> {
    const command =
      this.deps.binaryPath?.(definition.id) ?? definition.launch?.command ?? ''
    if (!command) throw new AcpModelProbeFailure({ code: 'spawn_failed', message: 'No launch command is configured' })
    const secretEnv = await resolveHarnessSecretEnv(
      definition,
      this.deps.resolveSecretEnv
    )
    const process = await startAcpProcess({
      harnessId: definition.id,
      command,
      args: definition.launch?.args ?? [],
      // Same proxy fill as turns and readiness: a Dock-launched app has no
      // shell proxy variables, but the agent still needs its backend.
      env: nativeAgentLaunchEnv(definition, secretEnv),
      secretEnv,
      // Probes use the CLI's existing login. Only session/new can establish
      // that authentication is required; advertised authMethods cannot.
      cwd: tmpdir(),
      spawn: this.deps.spawn
    })
    const conn = AcpConnection.start({ process, identity: 'probe' })
    // Fail-closed mediation host: any fs/terminal/permission request the agent
    // issues during session/new gets a sessionUnavailable error.
    new AcpClientHost().attach(conn)
    try {
      await conn.initialize()
      return conn
    } catch (error) {
      await conn.close().catch(() => undefined)
      throw error
    }
  }

  private drop(key: string, entry: PooledProbe): void {
    if (this.connections.get(key) === entry) this.connections.delete(key)
    if (entry.timer) clearTimeout(entry.timer)
    void entry.conn.close().catch(() => undefined)
  }

  private store(key: string, catalog: HarnessModelCatalog, ttlMs: number): void {
    if (this.cache.size >= 32) this.cache.delete(this.cache.keys().next().value!)
    this.cache.set(key, { fetchedAt: this.nowMs(), expiresAt: this.nowMs() + ttlMs, catalog })
  }

  private bump(id: string): void { this.generations.set(id, (this.generations.get(id) ?? 0) + 1) }

  private cacheKey(definition: HarnessDefinition, selectedModel?: string): string {
    return JSON.stringify({
      id: definition.id,
      generation: this.generations.get(definition.id) ?? 0,
      identity: this.identityKey(definition, selectedModel)
    })
  }

  private identityKey(definition: HarnessDefinition, selectedModel?: string): string {
    return JSON.stringify({
      id: definition.id,
      binary: harnessExecutableIdentity(this.deps.binaryPath?.(definition.id) ?? definition.launch?.command),
      ...(selectedModel ? { selectedModel } : {}),
      command: this.deps.binaryPath?.(definition.id) ?? definition.launch?.command,
      args: definition.launch?.args,
      env: definition.launch?.env
    })
  }

  private log(line: string): void {
    if (this.deps.log) this.deps.log(line)
    else globalThis.process.stderr.write(`${line}\n`)
  }

  private nowMs(): number {
    return this.deps.nowMs?.() ?? Date.now()
  }
}

function harnessOfKey(key: string): string {
  try { return String((JSON.parse(key) as { id?: unknown }).id ?? '') } catch { return '' }
}
