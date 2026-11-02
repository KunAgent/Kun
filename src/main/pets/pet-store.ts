import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  boundDismissedKeys
} from '../../shared/pets-payload'
import {
  clampMascotWidth,
  defaultPetSettings,
  petAssetUrl,
  petIdForSource,
  type PetManifest,
  type PetOverlayPlacement,
  type PetSettings,
  type PetSource,
  type PetSpriteVersion,
  type PetSummary
} from '../../shared/pets'
import { spritesheetFileName } from './pet-validator'

const SETTINGS_FILE = 'settings.json'
const LIBRARY_DIR = 'library'

export class PetStore {
  private settings: PetSettings = defaultPetSettings()
  private catalog = new Map<string, PetManifest>()
  private writeChain: Promise<void> = Promise.resolve()
  private readonly settingsPath: string
  private readonly libraryDir: string

  constructor(private readonly rootDir: string) {
    this.settingsPath = path.join(rootDir, SETTINGS_FILE)
    this.libraryDir = path.join(rootDir, LIBRARY_DIR)
  }

  async initialize(): Promise<void> {
    await mkdir(this.libraryDir, { recursive: true })
    this.settings = await this.readSettings()
    this.catalog = await this.scanCatalog()
    this.clearMissingSelection()
  }

  getSettings(): PetSettings {
    return structuredClone(this.settings)
  }

  listPets(): PetSummary[] {
    const order: Record<PetSource, number> = { 'kun-builtin': 0, 'kun-local': 1, 'codex-custom': 2 }
    return [...this.catalog.values()]
      .map((manifest) => this.toSummary(manifest))
      .sort((a, b) => {
        const selected = Number(b.id === this.settings.selectedPetId) - Number(a.id === this.settings.selectedPetId)
        if (selected) return selected
        if (order[a.source] !== order[b.source]) return order[a.source] - order[b.source]
        return a.displayName.localeCompare(b.displayName)
      })
  }

  getManifest(petId: string): PetManifest | null {
    return this.catalog.get(petId) ?? null
  }

  manifests(): PetManifest[] {
    return [...this.catalog.values()]
  }

  libraryRoot(): string {
    return this.libraryDir
  }

  async selectPet(petId: string | null): Promise<PetSettings> {
    return this.mutate(async () => {
      if (petId !== null && !this.catalog.has(petId)) throw new Error('pet not found')
      this.settings.selectedPetId = petId
      if (petId === null) this.settings.overlayOpen = false
    })
  }

  async setOverlayOpen(open: boolean): Promise<PetSettings> {
    return this.mutate(async () => {
      if (open && !this.settings.selectedPetId) throw new Error('select an available pet before opening the overlay')
      if (open && !this.catalog.has(this.settings.selectedPetId ?? '')) {
        throw new Error('select an available pet before opening the overlay')
      }
      this.settings.overlayOpen = open
    })
  }

  async setImportPreferences(input: { importCodexPets?: boolean }): Promise<PetSettings> {
    return this.mutate(async () => {
      if (typeof input.importCodexPets === 'boolean') this.settings.importCodexPets = input.importCodexPets
    })
  }

  async setMascotWidth(width: number): Promise<PetSettings> {
    return this.mutate(async () => {
      this.settings.mascotWidthPx = clampMascotWidth(width)
    })
  }

  async setPlacement(placement: PetOverlayPlacement): Promise<void> {
    await this.mutate(async () => {
      this.settings.placementByDisplay[placement.displayId] = placement
      this.settings.mascotWidthPx = clampMascotWidth(placement.mascotWidthPx)
    })
  }

  async recordWelcomed(petId: string): Promise<void> {
    await this.mutate(async () => {
      if (!this.settings.welcomedPetIds.includes(petId)) this.settings.welcomedPetIds.push(petId)
    })
  }

  async dismissNotification(key: string): Promise<void> {
    await this.mutate(async () => {
      this.settings.dismissedNotificationKeys = boundDismissedKeys([
        ...this.settings.dismissedNotificationKeys,
        key
      ])
    })
  }

  assetPath(petId: string): string | null {
    const manifest = this.catalog.get(petId)
    if (!manifest) return null
    const petDir = path.resolve(this.petDir(petId))
    const asset = path.resolve(petDir, manifest.spritesheetFile)
    if (!asset.startsWith(`${petDir}${path.sep}`)) return null
    return asset
  }

  async importOrUpdate(input: {
    source: PetSource
    sourceId: string
    displayName: string
    description: string
    spriteVersionNumber: PetSpriteVersion
    spritesheetSourcePath: string
    sourcePath: string
  }): Promise<{ manifest: PetManifest; status: 'imported' | 'updated' | 'unchanged' }> {
    return this.enqueueResult(() => this.importOrUpdateNow(input))
  }

  private async importOrUpdateNow(input: {
    source: PetSource
    sourceId: string
    displayName: string
    description: string
    spriteVersionNumber: PetSpriteVersion
    spritesheetSourcePath: string
    sourcePath: string
  }): Promise<{ manifest: PetManifest; status: 'imported' | 'updated' | 'unchanged' }> {
    const petId = petIdForSource(input.source, input.sourceId)
    const fingerprint = await fingerprintPackage(input)
    const existing = this.catalog.get(petId)
    if (existing?.sourceFingerprint === fingerprint && existing.sourceMissing !== true && existing.sourcePath === input.sourcePath) {
      return { manifest: existing, status: 'unchanged' }
    }
    if (existing?.sourceFingerprint === fingerprint) {
      const restored: PetManifest = {
        ...existing,
        displayName: input.displayName,
        description: input.description,
        sourcePath: input.sourcePath,
        sourceMissing: false,
        importedAt: new Date().toISOString()
      }
      await this.writeManifest(restored)
      this.catalog.set(petId, restored)
      return { manifest: restored, status: 'updated' }
    }
    const manifest: PetManifest = {
      schemaVersion: 1,
      id: petId,
      sourceId: input.sourceId,
      displayName: input.displayName,
      description: input.description,
      spriteVersionNumber: input.spriteVersionNumber,
      spritesheetFile: spritesheetFileName(input.spritesheetSourcePath),
      source: input.source,
      sourcePath: input.sourcePath,
      sourceFingerprint: fingerprint,
      importedAt: new Date().toISOString(),
      sourceMissing: false
    }
    await this.commitPackage(manifest, input.spritesheetSourcePath, Boolean(existing))
    this.catalog.set(petId, manifest)
    return { manifest, status: existing ? 'updated' : 'imported' }
  }

  async markSourceMissing(petId: string): Promise<void> {
    await this.enqueue(async () => {
      const existing = this.catalog.get(petId)
      if (!existing || existing.sourceMissing) return
      const updated: PetManifest = { ...existing, sourceMissing: true, importedAt: new Date().toISOString() }
      await this.writeManifest(updated)
      this.catalog.set(petId, updated)
    })
  }

  private async commitPackage(manifest: PetManifest, spritesheetSourcePath: string, replacing: boolean): Promise<void> {
    const targetDir = this.petDir(manifest.id)
    const stagingDir = path.join(this.libraryDir, `.import-${randomUUID()}`)
    const backupDir = `${targetDir}.backup-${randomUUID()}`
    await mkdir(stagingDir, { recursive: true })
    const { copyFile } = await import('node:fs/promises')
    await copyFile(spritesheetSourcePath, path.join(stagingDir, manifest.spritesheetFile))
    await writeFile(path.join(stagingDir, 'pet.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    try {
      if (replacing && await exists(targetDir)) await rename(targetDir, backupDir)
      await rename(stagingDir, targetDir)
      await rm(backupDir, { recursive: true, force: true })
    } catch (error) {
      if (await exists(backupDir)) {
        await rm(targetDir, { recursive: true, force: true })
        await rename(backupDir, targetDir)
      }
      await rm(stagingDir, { recursive: true, force: true })
      throw new Error(`failed to replace pet directory: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }

  private async mutate(change: () => Promise<void>): Promise<PetSettings> {
    await this.enqueue(async () => {
      await change()
      await this.writeSettings()
    })
    return this.getSettings()
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    return this.enqueueResult(task)
  }

  private enqueueResult<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(task, task)
    this.writeChain = run.then(() => undefined, () => undefined)
    return run
  }

  private petDir(petId: string): string {
    return path.join(this.libraryDir, petId.replaceAll(':', '_'))
  }

  private toSummary(manifest: PetManifest): PetSummary {
    return {
      id: manifest.id,
      sourceId: manifest.sourceId,
      displayName: manifest.displayName,
      description: manifest.description,
      source: manifest.source,
      spriteVersionNumber: manifest.spriteVersionNumber,
      spritesheetUrl: petAssetUrl(manifest.id, manifest.sourceFingerprint),
      available: true,
      sourceMissing: manifest.sourceMissing === true,
      ...(manifest.sourceMissing ? { warning: 'The original package is missing. Kun is using its saved copy.' } : {})
    }
  }

  private async readSettings(): Promise<PetSettings> {
    try {
      const text = await readFile(this.settingsPath, 'utf8')
      return normalizeSettings(JSON.parse(text))
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      if (code !== 'ENOENT') {
        const backup = `${this.settingsPath}.corrupt-${Date.now()}`
        await rename(this.settingsPath, backup).catch(() => undefined)
      }
      return defaultPetSettings()
    }
  }

  private async writeSettings(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true })
    const temporary = `${this.settingsPath}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(this.settings, null, 2)}\n`, 'utf8')
    await rename(temporary, this.settingsPath)
  }

  private async writeManifest(manifest: PetManifest): Promise<void> {
    const dir = this.petDir(manifest.id)
    await mkdir(dir, { recursive: true })
    const temporary = path.join(dir, `pet.json.${randomUUID()}.tmp`)
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await rename(temporary, path.join(dir, 'pet.json'))
  }

  private async scanCatalog(): Promise<Map<string, PetManifest>> {
    const catalog = new Map<string, PetManifest>()
    let entries: string[] = []
    try {
      entries = await readdir(this.libraryDir)
    } catch {
      entries = []
    }
    for (const entry of entries) {
      if (entry.startsWith('.')) continue
      try {
        const text = await readFile(path.join(this.libraryDir, entry, 'pet.json'), 'utf8')
        const manifest = normalizeManifest(JSON.parse(text))
        if (!manifest) continue
        const asset = this.assetPathFor(manifest)
        if (await exists(asset)) catalog.set(manifest.id, manifest)
      } catch {
        // A damaged cached package stays isolated from the rest of the library.
      }
    }
    return catalog
  }

  private assetPathFor(manifest: PetManifest): string {
    return path.join(this.petDir(manifest.id), manifest.spritesheetFile)
  }

  private clearMissingSelection(): void {
    if (this.settings.selectedPetId && !this.catalog.has(this.settings.selectedPetId)) {
      this.settings.selectedPetId = null
      this.settings.overlayOpen = false
      void this.writeSettings()
    }
  }
}

export async function fingerprintPackage(input: {
  source: PetSource
  sourceId: string
  displayName: string
  description: string
  spriteVersionNumber: PetSpriteVersion
  spritesheetSourcePath: string
}): Promise<string> {
  const image = createHash('sha256').update(await readFile(input.spritesheetSourcePath)).digest('hex')
  return createHash('sha256').update(JSON.stringify({
    image,
    source: input.source,
    sourceId: input.sourceId,
    displayName: input.displayName,
    description: input.description,
    spriteVersionNumber: input.spriteVersionNumber
  })).digest('hex')
}

function normalizeSettings(value: unknown): PetSettings {
  const defaults = defaultPetSettings()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults
  const candidate = value as Record<string, unknown>
  const placement = candidate.placementByDisplay
  return {
    schemaVersion: 1,
    selectedPetId: typeof candidate.selectedPetId === 'string' ? candidate.selectedPetId : null,
    overlayOpen: candidate.overlayOpen === true,
    mascotWidthPx: clampMascotWidth(candidate.mascotWidthPx),
    importCodexPets: candidate.importCodexPets !== false,
    welcomedPetIds: stringList(candidate.welcomedPetIds),
    dismissedNotificationKeys: boundDismissedKeys(stringList(candidate.dismissedNotificationKeys)),
    placementByDisplay: placement && typeof placement === 'object' && !Array.isArray(placement)
      ? placement as Record<string, PetOverlayPlacement>
      : {}
  }
}

function normalizeManifest(value: unknown): PetManifest | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  const source = candidate.source
  if (source !== 'kun-builtin' && source !== 'kun-local' && source !== 'codex-custom') return null
  if (typeof candidate.sourceId !== 'string' || typeof candidate.displayName !== 'string' || typeof candidate.description !== 'string') {
    return null
  }
  const id = petIdForSource(source, candidate.sourceId)
  if (candidate.id !== id) return null
  if (candidate.spritesheetFile !== 'spritesheet.png' && candidate.spritesheetFile !== 'spritesheet.webp') return null
  return {
    schemaVersion: 1,
    id,
    sourceId: candidate.sourceId,
    displayName: candidate.displayName,
    description: candidate.description,
    spriteVersionNumber: candidate.spriteVersionNumber === 2 ? 2 : 1,
    spritesheetFile: candidate.spritesheetFile,
    source,
    ...(typeof candidate.sourcePath === 'string' ? { sourcePath: candidate.sourcePath } : {}),
    ...(typeof candidate.sourceFingerprint === 'string' ? { sourceFingerprint: candidate.sourceFingerprint } : {}),
    ...(typeof candidate.importedAt === 'string' ? { importedAt: candidate.importedAt } : {}),
    sourceMissing: candidate.sourceMissing === true
  }
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}
