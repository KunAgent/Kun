import { harnessExecutableIdentity } from './harness-executable-identity.js'
/**
 * Codex app-server model probing for `GET /v1/harnesses/:id/models` (P6-07).
 * Spawns a throwaway `codex app-server`, runs `initialize` + `model/list`,
 * and closes it — the same spawn-free-then-cached contract as AcpModelProbe.
 */
import { startHarnessProcess } from '../session/harness-process.js'
import { statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HarnessModelCatalog } from '../contracts/harness-models.js'
import { codexMetadataProbeArgs, resolveCodexExecutable } from './codex-executable.js'
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
  private revision = 0
  invalidate(): void { this.revision += 1; this.cache.clear(); this.pending.clear() }
  fetchedAt(definition: HarnessDefinition): string | undefined {
    const value = this.cache.get(this.cacheKey(definition))?.fetchedAt
    return value ? new Date(value).toISOString() : undefined
  }
  private readonly cache = new Map<
    string,
    { expiresAt: number; fetchedAt?: number; catalog: HarnessModelCatalog; command: string; binaryIdentity?: string }
  >()
  private readonly pending = new Map<string, Promise<HarnessModelCatalog>>()

  constructor(private readonly deps: CodexModelProbeDeps = {}) {}

  /** Spawn-free read; undefined when no fresh successful list is cached. */
  peek(definition: HarnessDefinition): string[] | undefined {
    const cached = this.cache.get(this.cacheKey(definition))
    return cached && cached.binaryIdentity === harnessExecutableIdentity(cached.command) && cached.expiresAt > this.nowMs() && cached.catalog.models.length > 0
      ? cached.catalog.models
      : undefined
  }

  async probe(definition: HarnessDefinition): Promise<string[]> {
    return (await this.probeCatalog(definition)).models
  }

  async probeCatalog(definition: HarnessDefinition): Promise<HarnessModelCatalog> {
    const override = this.deps.binaryPath?.(definition.id)
    const command = await resolveCodexExecutable(override ?? definition.launch?.command ?? '', Boolean(override))
    const key = this.cacheKey(definition)
    const cached = this.cache.get(key)
    if (cached && cached.command === command && cached.binaryIdentity === harnessExecutableIdentity(command) && cached.expiresAt > this.nowMs()) return cached.catalog
    const pendingKey = `${key}:${command}`
    const inFlight = this.pending.get(pendingKey)
    if (inFlight) return inFlight
    const task = this.probeUncached(definition, command).then((catalog) => {
      this.cache.set(key, { command, catalog, binaryIdentity: harnessExecutableIdentity(command),
        fetchedAt: this.nowMs(), expiresAt: this.nowMs() + (this.deps.cacheMs ?? CODEX_MODEL_PROBE_CACHE_MS) })
      return catalog
    }).catch(() => {
      const catalog = { models: [], modelInfo: [] }
      this.cache.set(key, { command, catalog, binaryIdentity: harnessExecutableIdentity(command), fetchedAt: this.nowMs(), expiresAt: this.nowMs() + 30_000 })
      return catalog
    }).finally(() => { if (this.pending.get(pendingKey) === task) this.pending.delete(pendingKey) })
    this.pending.set(pendingKey, task)
    return task
  }

  private async probeUncached(definition: HarnessDefinition, command: string): Promise<HarnessModelCatalog> {
    const launch = definition.launch
    if (!command || !launch) return { models: [], modelInfo: [] }
    const secretEnv = await resolveHarnessSecretEnv(definition, this.deps.resolveSecretEnv)
    const proc = await startHarnessProcess({ command, args: codexMetadataProbeArgs(launch.args),
      env: { ...nativeAgentNetworkEnv(definition, process.env, secretEnv), ...launch.env },
      secretEnv, cwd: tmpdir() })
    const client = new CodexClient({ process: proc })
    try {
      await withTimeout(client.initialize(), CODEX_PROBE_TIMEOUT_MS)
      const rows = await withTimeout(client.listModels(), CODEX_PROBE_TIMEOUT_MS)
      const configured = await withTimeout(client.configuredModel(), CODEX_PROBE_TIMEOUT_MS).catch(() => undefined)
      const defaultModel = configured && configured !== 'codex-auto-review' ? configured : undefined
      const catalog: HarnessModelCatalog = { models: rows.map((row) => row.model), modelInfo: rows.map((row) => ({
        id: row.model, displayName: row.displayName, description: row.description,
        isDefault: defaultModel ? row.model === defaultModel : row.isDefault,
        ...(row.inputModalities ? { inputModalities: row.inputModalities } : {}),
        defaultReasoningEffort: row.defaultReasoningEffort,
        reasoningEfforts: (row.supportedReasoningEfforts ?? []).flatMap((entry) => {
          const effort = (entry as { reasoningEffort?: unknown })?.reasoningEffort
          return typeof effort === 'string' ? [effort] : []
        })
      })) }
      if (defaultModel && !catalog.models.includes(defaultModel)) {
        catalog.models.push(defaultModel)
        catalog.modelInfo.push({ id: defaultModel, isDefault: true })
      }
      return catalog
    } finally { await proc.stop().catch(() => undefined) }
  }

  private cacheKey(definition: HarnessDefinition): string {
    const home = definition.launch?.env?.CODEX_HOME ?? process.env.CODEX_HOME ?? join(homedir(), '.codex')
    return JSON.stringify({
      revision: this.revision, binary: harnessExecutableIdentity(this.deps.binaryPath?.(definition.id) ?? definition.launch?.command),
      id: definition.id,
      home,
      auth: fileIdentity(join(home, 'auth.json')),
      config: fileIdentity(join(home, 'config.toml')),
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

function fileIdentity(path: string): string {
  try { const value = statSync(path); return `${value.ino}:${value.size}:${value.mtimeMs}` }
  catch { return 'absent' }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('codex probe timed out')), ms)
      timer.unref?.()
    })])
  } finally { if (timer) clearTimeout(timer) }
}
