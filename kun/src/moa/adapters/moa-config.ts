import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MoaConfig } from '../contracts/moa-types.js'
import { MoaConfigSchema, MoaPresetSchema, BUILTIN_MOA_PRESETS, type MoaPreset } from '../contracts/moa-types.js'
import type { ModelCatalogEntry } from '../../seam/types.js'

/**
 * MoA Configuration Adapter
 *
 * Parses and validates MoA config from config.extensions.moa
 * Merges built-in presets with custom user presets
 */

export interface MoaConfigOptions {
  /** Raw config from config.extensions.moa */
  rawConfig?: unknown
  dataDir?: string
}

export class MoaConfigAdapter {
  private config: MoaConfig
  private presetMap: Map<string, MoaPreset>
  private readonly dataDir?: string
  private readonly customPresetIds = new Set<string>()

  constructor(options: MoaConfigOptions) {
    // Parse and validate config
    this.config = MoaConfigSchema.parse(options.rawConfig || {})
    this.dataDir = options.dataDir

    // Build preset map: built-in presets + user custom presets
    this.presetMap = new Map()

    // Add built-in presets first
    for (const preset of BUILTIN_MOA_PRESETS) {
      this.presetMap.set(preset.id, preset)
    }

    // User presets override built-in presets with same ID
    for (const preset of this.config.presets) {
      this.presetMap.set(preset.id, preset)
      this.customPresetIds.add(preset.id)
    }
  }

  async initialize(): Promise<void> {
    if (!this.dataDir) return
    try {
      const content = await readFile(this.presetFilePath(), 'utf8')
      const stored = MoaConfigSchema.pick({ presets: true }).parse(JSON.parse(content))
      for (const preset of stored.presets) {
        this.presetMap.set(preset.id, preset)
        this.customPresetIds.add(preset.id)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  async savePreset(input: unknown): Promise<MoaPreset> {
    const preset = MoaPresetSchema.parse(input)
    for (const layer of preset.layers) {
      if (layer.models.some((model) => model.startsWith('moa:') || model.startsWith('moa-'))) {
        throw new Error('A MoA preset cannot reference another MoA virtual model')
      }
    }
    this.presetMap.set(preset.id, preset)
    this.customPresetIds.add(preset.id)
    await this.persistCustomPresets()
    return preset
  }

  async deletePreset(id: string): Promise<boolean> {
    if (!this.customPresetIds.has(id)) return false
    this.customPresetIds.delete(id)
    this.presetMap.delete(id)
    const builtin = BUILTIN_MOA_PRESETS.find((preset) => preset.id === id)
    if (builtin) this.presetMap.set(id, builtin)
    await this.persistCustomPresets()
    return true
  }

  /**
   * Get all available presets (built-in + custom)
   */
  getPresets(): MoaPreset[] {
    return Array.from(this.presetMap.values()).filter((p) => p.enabled)
  }

  getModelCatalogEntries(): ModelCatalogEntry[] {
    return this.getPresets().map((preset) => ({
      providerId: 'moa',
      modelId: `moa:${preset.id}`,
      label: preset.name,
      capabilities: {
        input: preset.inputModalities ?? ['text'],
        contextWindowTokens: preset.contextBudgetTokens ?? 32_000
      },
      source: 'extension'
    }))
  }

  /**
   * Get a preset by ID
   */
  getPreset(id: string): MoaPreset | undefined {
    const preset = this.presetMap.get(id)
    return preset?.enabled ? preset : undefined
  }

  isCustomPreset(id: string): boolean {
    return this.customPresetIds.has(id)
  }

  /**
   * Get the default preset (either configured or first enabled preset)
   */
  getDefaultPreset(): MoaPreset | undefined {
    if (this.config.defaultPresetId) {
      const preset = this.getPreset(this.config.defaultPresetId)
      if (preset) return preset
    }

    // Fallback: first enabled preset
    return this.getPresets()[0]
  }

  /**
   * Check if MoA tracing is enabled
   */
  isTracingEnabled(): boolean {
    return this.config.enableTracing
  }

  /**
   * Get max concurrent proposers
   */
  getMaxConcurrentProposers(): number {
    return this.config.maxConcurrentProposers
  }

  /**
   * Parse model reference into { providerId?, modelId }
   */
  parseModelReference(ref: string): { providerId?: string; modelId: string } {
    const parts = ref.split('/')
    if (parts.length === 2) {
      return { providerId: parts[0], modelId: parts[1] }
    }
    return { modelId: ref }
  }

  /**
   * Return the distinct provider ids a preset depends on (excluding the
   * default provider, referenced by bare modelId). Used by the GUI to show
   * required providers and by validateProviders() to disable presets whose
   * providers are not configured.
   */
  getPresetProviders(preset: MoaPreset): string[] {
    const providers = new Set<string>()
    for (const layer of preset.layers) {
      for (const ref of layer.models) {
        const { providerId } = this.parseModelReference(ref)
        if (providerId) providers.add(providerId)
      }
    }
    return [...providers].sort()
  }

  /**
   * Disable any enabled preset that references a provider not present in
   * `configuredProviderIds`. Returns the list of presets that were disabled
   * along with their missing providers so the caller can surface an
   * actionable message instead of silently misrouting to the default
   * provider.
   */
  validateProviders(configuredProviderIds: Iterable<string>): Array<{ presetId: string; missing: string[] }> {
    const configured = new Set([...configuredProviderIds].map((id) => id.trim().toLowerCase()))
    const disabled: Array<{ presetId: string; missing: string[] }> = []
    for (const [id, preset] of this.presetMap) {
      if (!preset.enabled) continue
      const missing = this.getPresetProviders(preset).filter(
        (providerId) => !configured.has(providerId.toLowerCase())
      )
      if (missing.length > 0) {
        this.presetMap.set(id, { ...preset, enabled: false })
        disabled.push({ presetId: id, missing })
      }
    }
    return disabled
  }

  private presetFilePath(): string {
    return join(this.dataDir!, 'moa', 'presets.json')
  }

  private async persistCustomPresets(): Promise<void> {
    if (!this.dataDir) return
    const dir = join(this.dataDir, 'moa')
    await mkdir(dir, { recursive: true })
    const filePath = this.presetFilePath()
    const tempPath = `${filePath}.tmp`
    const presets = [...this.customPresetIds]
      .map((id) => this.presetMap.get(id))
      .filter((preset): preset is MoaPreset => preset !== undefined)
    await writeFile(tempPath, JSON.stringify({ presets }, null, 2), 'utf8')
    await rename(tempPath, filePath)
  }
}
