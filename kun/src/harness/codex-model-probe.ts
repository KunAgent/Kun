/**
 * Codex app-server model probing for `GET /v1/harnesses/:id/models` (P6-07).
 * Spawns a throwaway `codex app-server`, runs `initialize` + `model/list`,
 * and closes it — the same spawn-free-then-cached contract as AcpModelProbe.
 */
import { startHarnessProcess } from '../session/harness-process.js'
import { CodexClient } from '../runtime/codex/codex-client.js'
import type { HarnessDefinition, HarnessId } from '../contracts/harness.js'
import { nativeAgentNetworkEnv, nativeAgentNetworkStatus } from './native-agent-network.js'
import {
  resolveHarnessSecretEnv,
  type HarnessSecretRefResolver
} from './harness-secret-env.js'

export const CODEX_MODEL_PROBE_CACHE_MS = 10 * 60 * 1_000
const CODEX_PROBE_TIMEOUT_MS = 30_000

export type CodexModelProbeDeps = {
  /** Settings `harnesses.binaryPaths` override for `launch.command`. */
  binaryPath?: (harnessId: HarnessId) => string | undefined
  /** Resolves `launch.secretEnv` refs so the probe sees the real env. */
  resolveSecretEnv?: HarnessSecretRefResolver
  nowMs?: () => number
  cacheMs?: number
}

export class CodexModelProbe {
  private readonly cache = new Map<
    string,
    { expiresAt: number; models: string[] }
  >()
  private readonly pending = new Map<string, Promise<string[]>>()

  constructor(private readonly deps: CodexModelProbeDeps = {}) {}

  /** Spawn-free read; undefined when no fresh successful list is cached. */
  peek(definition: HarnessDefinition): string[] | undefined {
    const cached = this.cache.get(this.cacheKey(definition))
    return cached && cached.expiresAt > this.nowMs() && cached.models.length > 0
      ? cached.models
      : undefined
  }

  /** Best-effort probe; never throws — failures cache briefly as []. */
  async probe(definition: HarnessDefinition): Promise<string[]> {
    const key = this.cacheKey(definition)
    const cached = this.cache.get(key)
    if (cached && cached.expiresAt > this.nowMs()) return cached.models
    const inFlight = this.pending.get(key)
    if (inFlight) return inFlight
    const task = this.probeUncached(definition)
      .then((models) => {
        this.cache.set(key, {
          expiresAt:
            this.nowMs() +
            (this.deps.cacheMs ?? CODEX_MODEL_PROBE_CACHE_MS),
          models
        })
        return models
      })
      .catch(() => {
        this.cache.set(key, { expiresAt: this.nowMs() + 30_000, models: [] })
        return [] as string[]
      })
      .finally(() => this.pending.delete(key))
    this.pending.set(key, task)
    return task
  }

  private async probeUncached(
    definition: HarnessDefinition
  ): Promise<string[]> {
    const launch = definition.launch
    if (!launch?.command) return []
    const secretEnv = await resolveHarnessSecretEnv(
      definition,
      this.deps.resolveSecretEnv
    )
    const proc = await startHarnessProcess({
      command: this.deps.binaryPath?.(definition.id) ?? launch.command,
      args: launch.args,
      env: { ...nativeAgentNetworkEnv(definition, process.env, secretEnv), ...launch.env },
      secretEnv,
      cwd: undefined
    })
    const client = new CodexClient({ process: proc })
    try {
      await withTimeout(client.initialize(), CODEX_PROBE_TIMEOUT_MS)
      return await withTimeout(client.listModelsFlat(), CODEX_PROBE_TIMEOUT_MS)
    } finally {
      await proc.stop().catch(() => undefined)
    }
  }

  private cacheKey(definition: HarnessDefinition): string {
    return JSON.stringify({
      id: definition.id,
      network: nativeAgentNetworkStatus(definition).networkFingerprint,
      command: this.deps.binaryPath?.(definition.id) ?? definition.launch?.command,
      args: definition.launch?.args,
      env: definition.launch?.env
    })
  }

  private nowMs(): number {
    return this.deps.nowMs?.() ?? Date.now()
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('codex probe timed out')),
        ms
      )
      timer.unref?.()
    })
  ])
}
