import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import type { HarnessDefinition } from '../contracts/harness.js'
import type { HarnessModelCatalog, HarnessModelInfo } from '../contracts/harness-models.js'
import { HarnessNativeAgentListSchema } from '../contracts/harness-native-agents.js'
import { HarnessSessionSettingListSchema } from '../contracts/harness-session-settings.js'
import { KUN_VERSION } from '../version.js'
import { harnessExecutableIdentity } from './harness-executable-identity.js'
import { nativeProfileEnv, nativeProfileFiles } from './harness-readiness-profile.js'
import { nativeAgentNetworkIdentity } from './native-agent-network.js'
import { providerBinaryEnvKeys, providerModule } from './providers/registry.js'

/** Bump when probe parsing changes what a catalog means; old entries then re-probe once. */
const CATALOG_FORMAT = 1
const MAX_ENTRIES = 64
const SAVE_DEBOUNCE_MS = 1_000
/** Identity reads stat files (and one engine's credential database); pickers ask several times per list. */
const IDENTITY_MEMO_MS = 5_000

export type PersistedModelCatalog = { catalog: HarnessModelCatalog; fetchedAt: string }
type Entry = { harnessId: string; identity: string; fetchedAt: number; catalog: HarnessModelCatalog }

const EntrySchema = z.object({
  harnessId: z.string().min(1).max(128),
  identity: z.string().regex(/^[a-f0-9]{64}$/u),
  fetchedAt: z.number().finite(),
  catalog: z.object({
    models: z.array(z.string().min(1).max(1_024)).min(1).max(1_024),
    // Display facts only; an unreadable part drops itself, not the model list.
    modelInfo: z.array(z.object({ id: z.string().min(1).max(1_024) }).passthrough()).max(1_024).catch([]),
    agents: HarnessNativeAgentListSchema.optional().catch(undefined),
    defaultAgentId: z.string().min(1).max(256).optional().catch(undefined),
    settings: HarnessSessionSettingListSchema.optional().catch(undefined)
  })
})
const FileSchema = z.object({ version: z.literal(1), catalogs: z.array(z.unknown()).max(MAX_ENTRIES) })

function fileIdentity(path: string): string | null {
  try {
    const stat = statSync(path, { bigint: true })
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`
  } catch { return null }
}

/**
 * What an Agent's model list depends on, stable across Runtime processes:
 * the definition, every executable the probe may start (file identity, so an
 * in-place upgrade counts), network setup, credential evidence and the Kun
 * build. Never a per-process salt, or every launch would re-list every Agent.
 * Secret values only enter the digest. Agents whose launch reads credential
 * store refs are not persisted: those can change without any local trace.
 */
export function harnessModelCatalogIdentity(definition: HarnessDefinition,
  executables: ReadonlyArray<string | undefined>): string | undefined {
  if (definition.launch?.secretEnv?.length) return undefined
  const env = { ...process.env, ...definition.launch?.env }
  const commands = [...new Set(executables.filter((command): command is string => Boolean(command?.trim())))]
  return createHash('sha256').update(JSON.stringify({
    format: CATALOG_FORMAT, kun: KUN_VERSION, definition,
    executables: commands.map((command) => [command, harnessExecutableIdentity(command)]),
    runtimeBinaryEnv: providerBinaryEnvKeys().map((key) => process.env[key]),
    network: nativeAgentNetworkIdentity(definition),
    engine: providerModule(definition.id)?.credentials?.fingerprint?.(env),
    env: nativeProfileEnv(definition),
    files: nativeProfileFiles(definition).map((path) => [path, fileIdentity(path)])
  })).digest('hex')
}

/**
 * Agent model catalogs kept across Runtime restarts. Listing models starts
 * each Agent's CLI (Claude Code, OpenCode, Devin, agy, ...), so without this
 * every launch re-spawned all of them to repaint pickers. Entries are
 * display-only: served while the Agent's identity is unchanged; a request
 * for that Agent's own models still asks the Agent. The file holds model
 * names and sha256 identities, never secrets.
 */
export class HarnessModelCatalogStore {
  private readonly entries = new Map<string, Entry>()
  private readonly identities = new Map<string, { at: number; value: string | undefined }>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly deps: {
    path?: string
    identity: (definition: HarnessDefinition) => string | undefined
    nowMs?: () => number
  }) {
    // A small file read once, synchronously, so the first spawn-free peek
    // after a restart already sees it.
    if (deps.path) this.load(deps.path)
  }

  /** The last catalog this Agent listed, while its identity is unchanged. Never spawns. */
  get(definition: HarnessDefinition): PersistedModelCatalog | undefined {
    const entry = this.entries.get(definition.id)
    if (!entry || entry.identity !== this.identity(definition)) return undefined
    return { catalog: entry.catalog, fetchedAt: new Date(entry.fetchedAt).toISOString() }
  }

  /** A successful live listing; empty lists and failures never replace the last good catalog. */
  record(definition: HarnessDefinition, catalog: HarnessModelCatalog): void {
    if (catalog.models.length === 0) return
    const identity = this.identity(definition, true)
    if (!identity) return
    const { error: _error, ...kept } = catalog
    this.entries.delete(definition.id)
    this.entries.set(definition.id, { harnessId: definition.id, identity, fetchedAt: this.now(), catalog: kept })
    while (this.entries.size > MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!)
    this.schedule()
  }

  /** Write any pending change now (tests, shutdown). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
      this.enqueueWrite()
    }
    await this.writing
  }

  private identity(definition: HarnessDefinition, fresh = false): string | undefined {
    const memo = this.identities.get(definition.id)
    if (!fresh && memo && this.now() - memo.at < IDENTITY_MEMO_MS) return memo.value
    const value = this.deps.identity(definition)
    this.identities.set(definition.id, { at: this.now(), value })
    return value
  }

  private load(path: string): void {
    try {
      const file = FileSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
      if (!file.success) return
      for (const raw of file.data.catalogs) {
        const parsed = EntrySchema.safeParse(raw)
        if (!parsed.success) continue
        const { catalog, ...rest } = parsed.data
        this.entries.set(rest.harnessId, { ...rest, catalog: { ...catalog, modelInfo: catalog.modelInfo as HarnessModelInfo[] } })
      }
    } catch {
      // Absent or unreadable: the next listing rebuilds it.
    }
  }

  /** Debounced: several Agents finish listing in one burst. */
  private schedule(): void {
    if (!this.deps.path || this.timer) return
    this.timer = setTimeout(() => { this.timer = undefined; this.enqueueWrite() }, SAVE_DEBOUNCE_MS)
    this.timer.unref?.()
  }

  private enqueueWrite(): void {
    const path = this.deps.path
    if (!path) return
    const body = `${JSON.stringify({ version: 1, catalogs: [...this.entries.values()] })}\n`
    const write = async () => {
      try {
        await mkdir(dirname(path), { recursive: true, mode: 0o700 })
        await atomicWriteFile(path, body)
      } catch {
        // Losing the cache only costs one listing after the next restart.
      }
    }
    this.writing = this.writing.then(write, write)
  }

  private now(): number { return this.deps.nowMs?.() ?? Date.now() }
}
