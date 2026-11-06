import { access, mkdir, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { RETIRED_BUILTIN_PET_IDS } from '../../shared/pets-builtin'
import type { PetImportReport, PetSource, PetSourceState } from '../../shared/pets'
import { directoryStateFromError } from './pet-paths'
import { PetStore, pathExists } from './pet-store'
import { validatePetPackage } from './pet-validator'

export function detectCodexHome(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const override = env.CODEX_HOME?.trim()
  return override ? path.resolve(override) : path.join(home, '.codex')
}

export function resolveBuiltinPetsRoot(input: { packaged: boolean; resourcesPath: string; appPath: string }): string {
  return input.packaged ? path.join(input.resourcesPath, 'pets') : path.join(input.appPath, 'resources', 'pets')
}

export function localPetsRoot(libraryRoot: string): string {
  return path.join(path.dirname(libraryRoot), 'local')
}

type Candidate = { folderName: string; petDir: string }

export async function refreshPetLibraries(input: {
  store: PetStore
  builtinRoot: string
  localRoot: string
  codexHome: string
  importCodexPets: boolean
}): Promise<PetImportReport> {
  await mkdir(input.localRoot, { recursive: true })
  const report = emptyReport(input.store.getSettings().selectedPetId)
  report.sourceStates.builtin = await importTree(input.store, input.builtinRoot, 'kun-builtin', report)
  await input.store.retireBuiltinPets()
  report.sourceStates.local = await importTree(input.store, input.localRoot, 'kun-local', report)
  if (input.importCodexPets) {
    report.sourceStates.codex = await importTree(input.store, path.join(input.codexHome, 'pets'), 'codex-custom', report)
    await markMissingSources(input.store, 'codex-custom', report)
  }
  report.sourceMissing = input.store.manifests().filter((manifest) => manifest.sourceMissing)
  report.selectedPetIdUnchanged = input.store.getSettings().selectedPetId
  return report
}

async function importTree(
  store: PetStore,
  root: string,
  source: PetSource,
  report: PetImportReport
): Promise<PetSourceState> {
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch (error) {
    report.failed.push({
      sourcePath: root,
      error: error instanceof Error ? error.message : 'directory unavailable'
    })
    return directoryStateFromError(error)
  }
  const candidates: Candidate[] = []
  for (const folderName of entries) {
    if (folderName.startsWith('.')) continue
    const petDir = path.join(root, folderName)
    try {
      if (!(await stat(petDir)).isDirectory()) continue
      await access(path.join(petDir, 'pet.json'))
      candidates.push({ folderName, petDir })
    } catch {
      // Entries without a readable manifest are ignored until the next refresh.
    }
  }
  candidates.sort((a, b) => a.petDir.localeCompare(b.petDir))
  const kept = new Map<string, string>()
  for (const candidate of candidates) {
    let validated: Awaited<ReturnType<typeof validatePetPackage>>
    try {
      validated = await validatePetPackage(candidate.petDir, candidate.folderName)
    } catch (error) {
      report.failed.push({
        sourcePath: candidate.petDir,
        sourceId: candidate.folderName,
        error: error instanceof Error ? error.message : 'invalid pet package'
      })
      continue
    }
    if (source === 'kun-builtin' && RETIRED_BUILTIN_PET_IDS.has(validated.sourceId)) continue
    const previous = kept.get(validated.sourceId)
    if (previous) {
      report.conflicts.push({ sourcePath: candidate.petDir, sourceId: validated.sourceId, keptSourcePath: previous })
      continue
    }
    kept.set(validated.sourceId, candidate.petDir)
    try {
      const result = await store.importOrUpdate({
        source,
        sourceId: validated.sourceId,
        displayName: validated.displayName,
        description: validated.description,
        spriteVersionNumber: validated.spriteVersionNumber,
        spritesheetSourcePath: validated.spritesheetPath,
        sourcePath: candidate.petDir,
        interactions: validated.interactions
      })
      report[result.status].push(result.manifest)
    } catch (error) {
      report.failed.push({
        sourcePath: candidate.petDir,
        sourceId: validated.sourceId,
        error: error instanceof Error ? error.message : 'import failed'
      })
    }
  }
  return 'ok'
}

async function markMissingSources(store: PetStore, source: PetSource, report: PetImportReport): Promise<void> {
  const seen = new Set([...report.imported, ...report.updated, ...report.unchanged].map((manifest) => manifest.id))
  for (const manifest of store.manifests()) {
    if (manifest.source !== source || seen.has(manifest.id) || !manifest.sourcePath) continue
    if (await pathExists(manifest.sourcePath)) continue
    await store.markSourceMissing(manifest.id)
  }
}

function emptyReport(selectedPetId: string | null): PetImportReport {
  return {
    imported: [],
    updated: [],
    unchanged: [],
    sourceMissing: [],
    failed: [],
    conflicts: [],
    sourceStates: { builtin: 'missing', local: 'missing', codex: 'missing' },
    selectedPetIdUnchanged: selectedPetId
  }
}
