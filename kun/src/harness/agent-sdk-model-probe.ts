import { harnessExecutableIdentity } from './harness-executable-identity.js'
/**
 * Claude Code model probing for `GET /v1/harnesses/:id/models` (P3-07).
 * Opens a throwaway `query()` handle — with an empty prompt iterable so no
 * turn ever runs — and calls the SDK's `supportedModels()` control request.
 * Canonical `resolvedModel` ids are returned; results are cached for ten
 * minutes and concurrent probes share one in-flight request.
 */
import { raceProbeAbort } from './probe-abort.js'
import { spawnOwnedSdkProcess } from '../runtime/agent-sdk/owned-sdk-process.js'
import { tmpdir } from 'node:os'
import type { SdkApi } from '../runtime/agent-sdk/sdk-protocol.js'
import type { HarnessTestHandshake } from '../contracts/harness-test.js'
import type { HarnessDefinition, HarnessId } from '../contracts/harness.js'
import { sdkProcessBaseEnv } from '../runtime/agent-sdk/sdk-process-environment.js'
import { buildScopedEnv } from '../runtime/agent-sdk/sdk-options-builder.js'
import { nativeAgentNetworkEnv, nativeAgentNetworkStatus } from './native-agent-network.js'

export const AGENT_SDK_MODEL_PROBE_CACHE_MS = 10 * 60 * 1_000
const AGENT_SDK_PROBE_TIMEOUT_MS = 10_000

export type AgentSdkModelProbeDeps = {
  /** Settings `harnesses.binaryPaths` override for `pathToClaudeCodeExecutable`. */
  binaryPath?: (harnessId: HarnessId) => string | undefined
  /** Injectable SDK loader; production defers the package import. */
  loadSdk?: () => Promise<SdkApi>
  nowMs?: () => number
  cacheMs?: number
  timeoutMs?: number
}

type ProbeModelRow = { value?: string; resolvedModel?: string }

let sharedSdkPromise: Promise<SdkApi> | undefined
function loadAgentSdk(): Promise<SdkApi> {
  if (!sharedSdkPromise) {
    const specifier = '@anthropic-ai/claude-agent-sdk'
    sharedSdkPromise = import(specifier as string).then((mod) => mod as unknown as SdkApi)
  }
  return sharedSdkPromise
}

async function* emptyProbePrompt(): AsyncIterable<never> {}

export class AgentSdkModelProbe {
  private revision = 0
  invalidate(): void { this.revision += 1; this.cache.clear(); this.pending.clear() }
  fetchedAt(definition: HarnessDefinition): string | undefined {
    const value = this.cache.get(this.cacheKey(definition))?.fetchedAt
    return value ? new Date(value).toISOString() : undefined
  }
  private readonly cache = new Map<string, { expiresAt: number; fetchedAt?: number; models: string[] }>()
  private readonly pending = new Map<string, Promise<string[]>>()

  constructor(private readonly deps: AgentSdkModelProbeDeps = {}) {}

  /**
   * Spawn-free read of the cached probe result. Returns `undefined` when no
   * fresh successful list is cached (absent, expired, or a failed probe) so
   * callers fall back to `staticModels` without blocking on a process spawn.
   */
  peek(definition: HarnessDefinition): string[] | undefined {
    const cached = this.cache.get(this.cacheKey(definition))
    return cached && cached.expiresAt > this.nowMs() && cached.models.length > 0
      ? cached.models
      : undefined
  }

  /**
   * Best-effort probe; never throws — a harness that cannot start or answer
   * the control request returns `[]` so the route falls back to
   * `staticModels`.
   */
  async probe(definition: HarnessDefinition): Promise<string[]> {
    const key = this.cacheKey(definition)
    const cached = this.cache.get(key)
    if (cached && cached.expiresAt > this.nowMs()) return cached.models
    const inFlight = this.pending.get(key)
    if (inFlight) return inFlight
    const task = this.probeUncached(definition)
      .then((models) => {
        this.cache.set(key, {
          fetchedAt: this.nowMs(), expiresAt: this.nowMs() + (this.deps.cacheMs ?? AGENT_SDK_MODEL_PROBE_CACHE_MS),
          models
        })
        return models
      })
      .catch(() => {
        this.cache.set(key, { fetchedAt: this.nowMs(), expiresAt: this.nowMs() + 30_000, models: [] })
        return [] as string[]
      })
      .finally(() => {
        if (this.pending.get(key) === task) this.pending.delete(key)
      })
    this.pending.set(key, task)
    return task
  }

  async probeReadiness(definition: HarnessDefinition, env: Record<string, string>, signal: AbortSignal): Promise<Omit<HarnessTestHandshake, 'durationMs'>> {
    signal = AbortSignal.any([signal, AbortSignal.timeout(this.deps.timeoutMs ?? AGENT_SDK_PROBE_TIMEOUT_MS)])
    let authentication: HarnessTestHandshake['authentication'] = 'unverified'
    const models = await this.probeUncached(definition, env, signal, (account) => {
      if (account?.apiProvider === 'firstParty' && Boolean(account.email || account.subscriptionType) && !account.apiKeySource) authentication = 'verified'
    })
    return { ok: models.length > 0, supported: true, protocol: 'agent-sdk', models, authentication }
  }

  private async probeUncached(definition: HarnessDefinition, env: Record<string, string> = {}, signal?: AbortSignal, accountResult?: (account: { email?: string; subscriptionType?: string; apiProvider?: string; apiKeySource?: string } | undefined) => void): Promise<string[]> {
    signal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(this.deps.timeoutMs ?? AGENT_SDK_PROBE_TIMEOUT_MS)])
    signal.throwIfAborted()
    const sdk = await raceProbeAbort((this.deps.loadSdk ?? loadAgentSdk)(), signal)
    signal?.throwIfAborted()
    const query = sdk.query({
      prompt: emptyProbePrompt(),
      options: {
        spawnClaudeCodeProcess: spawnOwnedSdkProcess,
        cwd: tmpdir(),
        env: { ...buildScopedEnv({ ...sdkProcessBaseEnv(), ...nativeAgentNetworkEnv(definition) }), ...env },
        ...(this.deps.binaryPath?.(definition.id)
          ? { pathToClaudeCodeExecutable: this.deps.binaryPath(definition.id) }
          : {})
      }
    })
    try {
      const rows = await raceProbeAbort(query.supportedModels?.() ?? Promise.resolve([]), signal)
      if (accountResult) accountResult(await raceProbeAbort(query.accountInfo?.() ?? Promise.resolve(undefined), signal))
      const models = new Set<string>()
      for (const row of (rows ?? []) as ProbeModelRow[]) {
        const id = row.resolvedModel ?? row.value
        if (id) models.add(id)
      }
      return [...models].sort()
    } finally {
      try {
        query.close?.()
      } catch {
        // best-effort shutdown of the probe process
      }
    }
  }

  private cacheKey(definition: HarnessDefinition): string {
    return `${this.revision}:${harnessExecutableIdentity(this.deps.binaryPath?.(definition.id))}:${definition.id}:${this.deps.binaryPath?.(definition.id) ?? ''}:${nativeAgentNetworkStatus(definition).networkFingerprint}`
  }

  private nowMs(): number {
    return this.deps.nowMs?.() ?? Date.now()
  }
}
