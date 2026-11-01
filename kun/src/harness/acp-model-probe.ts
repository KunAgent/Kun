import { harnessExecutableIdentity } from './harness-executable-identity.js'
import type { HarnessDefinition, HarnessId } from '../contracts/harness.js'
import type { HarnessModelCatalog } from '../contracts/harness-models.js'

/**
 * ACP model and mode options belong to a session. Keep only catalogs observed
 * on real native-login turns: listing models must not create a throwaway
 * session in the Agent's own history.
 */
export class AcpModelProbe {
  private readonly catalogs = new Map<string, { catalog: HarnessModelCatalog; fetchedAt: number }>()

  constructor(private readonly deps: {
    binaryPath?: (harnessId: HarnessId) => string | undefined
    nowMs?: () => number
    onCatalog?: (definition: HarnessDefinition, catalog: HarnessModelCatalog) => void
  } = {}) {}

  /** A catalog from a real conversation, not a readiness or model probe. */
  seed(definition: HarnessDefinition, catalog: HarnessModelCatalog): void {
    if (catalog.models.length === 0) return
    const key = this.key(definition)
    if (this.catalogs.size >= 32 && !this.catalogs.has(key)) this.catalogs.delete(this.catalogs.keys().next().value!)
    this.catalogs.set(key, { catalog, fetchedAt: this.now() })
    this.deps.onCatalog?.(definition, catalog)
  }

  invalidate(id?: string): void {
    for (const key of this.catalogs.keys()) {
      if (!id || (JSON.parse(key) as { id: string }).id === id) this.catalogs.delete(key)
    }
  }

  peek(definition: HarnessDefinition): string[] | undefined {
    return this.catalogs.get(this.key(definition))?.catalog.models
  }

  peekInfo(definition: HarnessDefinition): HarnessModelCatalog['modelInfo'] | undefined {
    return this.catalogs.get(this.key(definition))?.catalog.modelInfo
  }

  fetchedAt(definition: HarnessDefinition, _selectedModel?: string): string | undefined {
    const entry = this.catalogs.get(this.key(definition))
    return entry ? new Date(entry.fetchedAt).toISOString() : undefined
  }

  async probe(definition: HarnessDefinition): Promise<string[]> {
    return (await this.probeCatalog(definition)).models
  }

  async probeCatalog(definition: HarnessDefinition, _selectedModel?: string): Promise<HarnessModelCatalog> {
    return this.catalogs.get(this.key(definition))?.catalog ?? {
      models: [], modelInfo: [],
      error: { code: 'unavailable', message: 'Native model options are available after a conversation starts; use the Agent default until then.' }
    }
  }

  private key(definition: HarnessDefinition): string {
    const command = this.deps.binaryPath?.(definition.id) ?? definition.launch?.command
    return JSON.stringify({ id: definition.id, command, binary: harnessExecutableIdentity(command),
      args: definition.launch?.args, env: definition.launch?.env })
  }

  private now(): number { return this.deps.nowMs?.() ?? Date.now() }
}
