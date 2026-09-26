/**
 * ACP model probing for `GET /v1/harnesses/:id/models` (docs/ade/03 §12.2).
 * Opens a throwaway connection, calls `session/new`, and reads the `model`
 * config option's value list — no prompt is ever sent, so the probe incurs
 * no model usage. Results are cached for ten minutes; concurrent probes for
 * the same harness share one in-flight request.
 */
import { tmpdir } from 'node:os'
import { AcpConnection } from '../runtime/acp/acp-connection.js'
import { AcpClientHost } from '../runtime/acp/acp-client-host.js'
import { startAcpProcess, type AcpSpawnFn } from '../runtime/acp/acp-process.js'
import {
  ACP_AGENT_METHODS,
  AcpNewSessionResultSchema,
  acpConfigOptionValues
} from '../runtime/acp/acp-schema.js'
import type { HarnessDefinition, HarnessId } from '../contracts/harness.js'

export const ACP_MODEL_PROBE_CACHE_MS = 10 * 60 * 1_000
const ACP_PROBE_SESSION_TIMEOUT_MS = 30_000

export type AcpModelProbeDeps = {
  /** Settings `harnesses.binaryPaths` override for `launch.command`. */
  binaryPath?: (harnessId: HarnessId) => string | undefined
  spawn?: AcpSpawnFn
  nowMs?: () => number
  cacheMs?: number
}

export class AcpModelProbe {
  private readonly cache = new Map<
    string,
    { expiresAt: number; models: string[] }
  >()
  private readonly pending = new Map<string, Promise<string[]>>()

  constructor(private readonly deps: AcpModelProbeDeps = {}) {}

  /**
   * Best-effort probe; never throws — a harness that cannot start a probe
   * session returns `[]` so the route falls back to `staticModels`.
   */
  async probe(definition: HarnessDefinition): Promise<string[]> {
    const key = `${definition.id}:${definition.launch?.command ?? ''}`
    const cached = this.cache.get(key)
    if (cached && cached.expiresAt > this.nowMs()) return cached.models
    const inFlight = this.pending.get(key)
    if (inFlight) return inFlight
    const task = this.probeUncached(definition)
      .then((models) => {
        this.cache.set(key, {
          expiresAt: this.nowMs() + (this.deps.cacheMs ?? ACP_MODEL_PROBE_CACHE_MS),
          models
        })
        return models
      })
      .catch(() => {
        // A failed probe is cached briefly as empty so the route does not
        // hammer a broken binary on every poll.
        this.cache.set(key, { expiresAt: this.nowMs() + 30_000, models: [] })
        return [] as string[]
      })
      .finally(() => {
        if (this.pending.get(key) === task) this.pending.delete(key)
      })
    this.pending.set(key, task)
    return task
  }

  private async probeUncached(definition: HarnessDefinition): Promise<string[]> {
    const command =
      this.deps.binaryPath?.(definition.id) ?? definition.launch?.command ?? ''
    if (!command) return []
    const process = await startAcpProcess({
      command,
      args: definition.launch?.args ?? [],
      env: definition.launch?.env ?? {},
      // Probe sessions never receive credential env; the agent either starts
      // unauthenticated or reports auth requirements via initialize.
      cwd: tmpdir(),
      spawn: this.deps.spawn
    })
    const conn = AcpConnection.start({ process, identity: 'probe' })
    // Fail-closed mediation host: any fs/terminal/permission request the agent
    // issues during session/new gets a sessionUnavailable error.
    new AcpClientHost().attach(conn)
    try {
      await conn.initialize()
      if (conn.requiresAuthentication) return []
      const raw = await conn.rpc.request(
        ACP_AGENT_METHODS.sessionNew,
        { cwd: tmpdir(), mcpServers: [] },
        { timeoutMs: ACP_PROBE_SESSION_TIMEOUT_MS }
      )
      const parsed = AcpNewSessionResultSchema.safeParse(raw)
      if (!parsed.success) return []
      const models = new Set<string>()
      for (const option of parsed.data.configOptions ?? []) {
        if (option.category !== 'model' || option.type !== 'select') continue
        for (const value of acpConfigOptionValues(option)) models.add(value)
      }
      return [...models].sort()
    } finally {
      await conn.close().catch(() => undefined)
    }
  }

  private nowMs(): number {
    return this.deps.nowMs?.() ?? Date.now()
  }
}
