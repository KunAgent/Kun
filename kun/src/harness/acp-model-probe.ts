/**
 * ACP model probing for `GET /v1/harnesses/:id/models` (docs/ade/03 §12.2).
 * Opens a throwaway connection, calls `session/new`, and reads the `model`
 * config option's value list or legacy availableModels list. No prompt is sent, so the probe incurs
 * no model usage. Results are cached for ten minutes; concurrent probes for
 * the same harness share one in-flight request.
 */
import { tmpdir } from 'node:os'
import { AcpConnection } from '../runtime/acp/acp-connection.js'
import { AcpClientHost } from '../runtime/acp/acp-client-host.js'
import { applyAcpSessionModel, parseAcpLegacyModels } from '../runtime/acp/acp-legacy-models.js'
import type { HarnessModelCatalog } from '../contracts/harness-models.js'
import { acpModelCatalog } from './acp-model-catalog.js'
import { startAcpProcess, type AcpSpawnFn } from '../runtime/acp/acp-process.js'
import {
  ACP_AGENT_METHODS,
  AcpNewSessionResultSchema,
  type AcpConfigOption
} from '../runtime/acp/acp-schema.js'
import type { HarnessDefinition, HarnessId } from '../contracts/harness.js'
import {
  resolveHarnessSecretEnv,
  type HarnessSecretRefResolver
} from './harness-secret-env.js'

export const ACP_MODEL_PROBE_CACHE_MS = 10 * 60 * 1_000
const ACP_PROBE_SESSION_TIMEOUT_MS = 30_000

export type AcpModelProbeDeps = {
  /** Settings `harnesses.binaryPaths` override for `launch.command`. */
  binaryPath?: (harnessId: HarnessId) => string | undefined
  /** Resolves `launch.secretEnv` refs so the probe sees the real env (P4-12). */
  resolveSecretEnv?: HarnessSecretRefResolver
  spawn?: AcpSpawnFn
  nowMs?: () => number
  cacheMs?: number
}

export class AcpModelProbe {
  private readonly cache = new Map<
    string,
    { expiresAt: number; catalog: HarnessModelCatalog }
  >()
  private readonly pending = new Map<string, Promise<HarnessModelCatalog>>()

  constructor(private readonly deps: AcpModelProbeDeps = {}) {}

  /**
   * Best-effort probe; never throws — a harness that cannot start a probe
   * session returns `[]` so the route falls back to `staticModels`.
   */
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

  async probe(definition: HarnessDefinition): Promise<string[]> {
    return (await this.probeCatalog(definition)).models
  }

  async probeCatalog(definition: HarnessDefinition, selectedModel?: string): Promise<HarnessModelCatalog> {
    const key = this.cacheKey(definition, selectedModel)
    const cached = this.cache.get(key)
    if (cached && cached.expiresAt > this.nowMs()) return cached.catalog
    const inFlight = this.pending.get(key)
    if (inFlight) return inFlight
    const task = this.probeUncached(definition, selectedModel)
      .then((catalog) => {
        if (this.cache.size >= 32) this.cache.delete(this.cache.keys().next().value!)
        this.cache.set(key, {
          expiresAt: this.nowMs() + (this.deps.cacheMs ?? ACP_MODEL_PROBE_CACHE_MS),
          catalog
        })
        return catalog
      })
      .catch(() => {
        // A failed probe is cached briefly as empty so the route does not
        // hammer a broken binary on every poll.
        const catalog = { models: [], modelInfo: [] }
        this.cache.set(key, { expiresAt: this.nowMs() + 30_000, catalog })
        return catalog
      })
      .finally(() => {
        if (this.pending.get(key) === task) this.pending.delete(key)
      })
    this.pending.set(key, task)
    return task
  }

  private async probeUncached(definition: HarnessDefinition, selectedModel?: string): Promise<HarnessModelCatalog> {
    const command =
      this.deps.binaryPath?.(definition.id) ?? definition.launch?.command ?? ''
    if (!command) return { models: [], modelInfo: [] }
    const secretEnv = await resolveHarnessSecretEnv(
      definition,
      this.deps.resolveSecretEnv
    )
    const process = await startAcpProcess({
      harnessId: definition.id,
      command,
      args: definition.launch?.args ?? [],
      env: definition.launch?.env ?? {},
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
      const raw = await conn.rpc.request(
        ACP_AGENT_METHODS.sessionNew,
        { cwd: tmpdir(), mcpServers: [] },
        { timeoutMs: ACP_PROBE_SESSION_TIMEOUT_MS }
      )
      const parsed = AcpNewSessionResultSchema.safeParse(raw)
      if (!parsed.success) return { models: [], modelInfo: [] }
      const session = { ...parsed.data, models: parseAcpLegacyModels(parsed.data.models) }
      const initial = acpModelCatalog({ harnessId: definition.id, ...parsed.data })
      const off = conn.subscribeSession(session.sessionId, { onUpdate: (update) => {
        if (update.sessionUpdate === 'config_option_update') {
          session.configOptions = (update as { configOptions: AcpConfigOption[] }).configOptions
        }
      } })
      try {
        if (selectedModel) await applyAcpSessionModel(conn, session, selectedModel)
        return acpModelCatalog({ harnessId: definition.id, configOptions: session.configOptions,
          models: session.models ? { ...(parsed.data.models as object), currentModelId: session.models.currentModelId } : parsed.data.models,
          defaultModel: initial.modelInfo.find((entry) => entry.isDefault)?.id })
      } finally { off() }
    } finally {
      await conn.close().catch(() => undefined)
    }
  }

  private cacheKey(definition: HarnessDefinition, selectedModel?: string): string {
    return JSON.stringify({
      id: definition.id,
      ...(selectedModel ? { selectedModel } : {}),
      command: this.deps.binaryPath?.(definition.id) ?? definition.launch?.command,
      args: definition.launch?.args,
      env: definition.launch?.env
    })
  }

  private nowMs(): number {
    return this.deps.nowMs?.() ?? Date.now()
  }
}
