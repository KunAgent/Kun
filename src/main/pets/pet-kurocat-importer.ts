import { access, readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { PET_MANIFEST_MAX_BYTES, petIdForSource, type PetImportReport, type PetSource, type PetSourceState } from '../../shared/pets'
import {
  BUILTIN_KUROCAT_SKINS,
  extractKuroCatSkinsFromJson,
  parseKuroCatSkinConfig,
  parseKuroCatUserPrefs,
  type KuroCatSkinConfig,
  type KuroCatUserPrefs
} from '../../shared/pets-kurocat'
import { kurocatDefaultInteractions, renderKurocatPreviewSheetPng } from './pet-kurocat-preview'
import { directoryStateFromError } from './pet-paths'
import { type PetStore } from './pet-store'
import { validatePetPackage } from './pet-validator'

const IGNORED_JSON_NAMES = new Set([
  'settings.json',
  'cats.json',
  'pet.json',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'window-state.json',
  'state.json'
])

const PLUGIN_SUBDIRS = ['cats', 'plugins', 'skins', 'pets'] as const

export function detectKurocatDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home = homedir()
): string {
  const override = env.KUROCAT_HOME?.trim()
  if (override) return path.resolve(override)
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'kuro-cat-pet')
  }
  if (platform === 'win32') {
    const appData = env.APPDATA?.trim() || path.join(home, 'AppData', 'Roaming')
    return path.join(appData, 'kuro-cat-pet')
  }
  const xdg = env.XDG_CONFIG_HOME?.trim() || path.join(home, '.config')
  return path.join(xdg, 'kuro-cat-pet')
}

export async function readKurocatUserPrefs(kurocatDir: string): Promise<KuroCatUserPrefs | null> {
  try {
    const raw = await readFile(path.join(kurocatDir, 'settings.json'), 'utf8')
    if (Buffer.byteLength(raw) > PET_MANIFEST_MAX_BYTES) return null
    return parseKuroCatUserPrefs(JSON.parse(raw))
  } catch {
    return null
  }
}

export async function readKurocatBlackOverride(kurocatDir: string): Promise<KuroCatSkinConfig | null> {
  try {
    const raw = await readFile(path.join(kurocatDir, 'cats.json'), 'utf8')
    if (Buffer.byteLength(raw) > 512 * 1024) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    for (const item of parsed) {
      const skin = parseKuroCatSkinConfig(item)
      if (skin && skin.id === 'black') return skin
    }
    return null
  } catch {
    return null
  }
}

function skinDisplayName(skin: KuroCatSkinConfig): string {
  const base = skin.name.trim() || skin.id
  return skin.emoji && !base.includes(skin.emoji) ? `${skin.emoji} ${base}` : base
}

function skinDescription(skin: KuroCatSkinConfig): string {
  const patternLabels: Record<string, string> = {
    solid: '纯色',
    bicolor: '双色',
    tuxedo: '燕尾',
    tabby: '虎斑',
    calico: '三花',
    siamese: '重点色'
  }
  const pat = patternLabels[skin.pattern ?? 'solid'] ?? '定制'
  return skin.builtin
    ? `KuroCat 原版${pat}桌宠角色，支持实时脊柱形变、肉垫敲键、尾巴拍键与摸头呼噜。`
    : `从本地 KuroCat 导入的${pat}自定义角色/插件（${skin.id}），运行原版实时引擎。`
}

async function importSkinRecord(
  store: PetStore,
  source: PetSource,
  skin: KuroCatSkinConfig,
  sourcePath: string,
  kept: Map<string, string>,
  report: PetImportReport
): Promise<void> {
  const previous = kept.get(skin.id)
  if (previous && previous !== sourcePath) {
    report.conflicts.push({ sourcePath, sourceId: skin.id, keptSourcePath: previous })
    return
  }
  kept.set(skin.id, sourcePath)
  try {
    const result = await store.importOrUpdate({
      source,
      sourceId: skin.id,
      displayName: skinDisplayName(skin).slice(0, 80),
      description: skinDescription(skin).slice(0, 400),
      spriteVersionNumber: 1,
      virtualImageKey: `kurocat-v1:${JSON.stringify(skin)}`,
      spritesheetBytes: () => renderKurocatPreviewSheetPng(skin),
      sourcePath,
      interactions: kurocatDefaultInteractions(),
      kurocatSkin: skin
    })
    report[result.status].push(result.manifest)
  } catch (error) {
    report.failed.push({
      sourcePath,
      sourceId: skin.id,
      error: error instanceof Error ? error.message : 'kurocat skin import failed'
    })
  }
}

async function readSkinsFromJsonFile(
  filePath: string,
  fallbackId: string,
  report: PetImportReport,
  strictReportError: boolean
): Promise<KuroCatSkinConfig[]> {
  let raw: string
  try {
    const info = await stat(filePath)
    if (!info.isFile() || info.size > 512 * 1024) return []
    raw = await readFile(filePath, 'utf8')
  } catch {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    if (strictReportError) {
      report.failed.push({
        sourcePath: filePath,
        sourceId: fallbackId,
        error: error instanceof Error ? error.message : 'invalid JSON'
      })
    }
    return []
  }
  return extractKuroCatSkinsFromJson(parsed, fallbackId)
}

async function scanJsonAndPackagesInFolder(
  store: PetStore,
  folderPath: string,
  source: PetSource,
  kept: Map<string, string>,
  report: PetImportReport,
  allowSubfolderPackages: boolean
): Promise<void> {
  let entries: string[]
  try {
    entries = (await readdir(folderPath)).sort((a, b) => a.localeCompare(b))
  } catch {
    return
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue
    const full = path.join(folderPath, name)
    let info: Awaited<ReturnType<typeof stat>>
    try {
      info = await stat(full)
    } catch {
      continue
    }
    if (info.isFile() && name.toLowerCase().endsWith('.json') && !IGNORED_JSON_NAMES.has(name.toLowerCase())) {
      const stem = path.basename(name, path.extname(name))
      const skins = await readSkinsFromJsonFile(full, stem, report, true)
      for (const skin of skins) {
        await importSkinRecord(store, source, skin, full, kept, report)
      }
      continue
    }
    if (!info.isDirectory()) continue
    // Check if subfolder is a standard pet.json package first
    let hasPetJson = false
    try {
      await access(path.join(full, 'pet.json'))
      hasPetJson = true
    } catch {
      hasPetJson = false
    }
    if (hasPetJson) {
      if (!allowSubfolderPackages) continue
      try {
        const validated = await validatePetPackage(full, name)
        const previous = kept.get(validated.sourceId)
        if (previous) {
          report.conflicts.push({ sourcePath: full, sourceId: validated.sourceId, keptSourcePath: previous })
          continue
        }
        kept.set(validated.sourceId, full)
        const result = await store.importOrUpdate({
          source,
          sourceId: validated.sourceId,
          displayName: validated.displayName,
          description: validated.description,
          spriteVersionNumber: validated.spriteVersionNumber,
          spritesheetSourcePath: validated.spritesheetPath,
          sourcePath: full,
          interactions: validated.interactions,
          kurocatSkin: validated.kurocatSkin
        })
        report[result.status].push(result.manifest)
      } catch (error) {
        report.failed.push({
          sourcePath: full,
          sourceId: name,
          error: error instanceof Error ? error.message : 'invalid pet package'
        })
      }
      continue
    }
    // Otherwise scan 1 level inside the plugin subfolder for *.json skin definitions
    let innerEntries: string[] = []
    try {
      innerEntries = (await readdir(full)).sort((a, b) => a.localeCompare(b))
    } catch {
      innerEntries = []
    }
    for (const inner of innerEntries) {
      if (inner.startsWith('.') || !inner.toLowerCase().endsWith('.json')) continue
      if (IGNORED_JSON_NAMES.has(inner.toLowerCase()) && inner.toLowerCase() !== 'cats.json') continue
      const innerPath = path.join(full, inner)
      const stem = inner.toLowerCase() === 'cat.json' || inner.toLowerCase() === 'skin.json'
        ? name
        : path.basename(inner, path.extname(inner))
      const skins = await readSkinsFromJsonFile(innerPath, stem, report, false)
      for (const skin of skins) {
        await importSkinRecord(store, source, skin, innerPath, kept, report)
      }
    }
  }
}

/** Import all cats, overrides, and plugins from the user's local kuro-cat-pet installation directory. */
export async function importKurocatDirectory(
  store: PetStore,
  kurocatDir: string,
  report: PetImportReport
): Promise<PetSourceState> {
  try {
    const info = await stat(kurocatDir)
    if (!info.isDirectory()) return 'missing'
    await readdir(kurocatDir)
  } catch (error) {
    const state = directoryStateFromError(error)
    if (state !== 'missing') {
      report.failed.push({
        sourcePath: kurocatDir,
        error: error instanceof Error ? error.message : 'kurocat directory unreadable'
      })
    }
    return state
  }

  const kept = new Map<string, string>()
  const catsJsonPath = path.join(kurocatDir, 'cats.json')
  let customCats: KuroCatSkinConfig[] = []
  try {
    await access(catsJsonPath)
    customCats = await readSkinsFromJsonFile(catsJsonPath, 'custom-cat', report, true)
  } catch {
    customCats = []
  }

  // Merge KuroCat companion breeds + user's cats.json overrides & custom pinched/MCP cats
  const merged = new Map<string, { skin: KuroCatSkinConfig; sourcePath: string }>()
  for (const builtin of BUILTIN_KUROCAT_SKINS) {
    if (builtin.id === 'black') continue // Classic black cat is built-in `kun:kurocat`
    merged.set(builtin.id, { skin: builtin, sourcePath: kurocatDir })
  }
  for (const custom of customCats) {
    if (custom.id === 'black') continue // Applied to `kun:kurocat` via readKurocatBlackOverride
    merged.set(custom.id, { skin: { ...custom, builtin: false }, sourcePath: catsJsonPath })
  }

  for (const { skin, sourcePath } of merged.values()) {
    await importSkinRecord(store, 'kurocat-custom', skin, sourcePath, kept, report)
  }

  // Scan top-level kuro-cat-pet/*.json & package folders
  await scanJsonAndPackagesInFolder(store, kurocatDir, 'kurocat-custom', kept, report, true)

  // Scan kuro-cat-pet/{cats,plugins,skins,pets}
  for (const sub of PLUGIN_SUBDIRS) {
    await scanJsonAndPackagesInFolder(store, path.join(kurocatDir, sub), 'kurocat-custom', kept, report, true)
  }

  return 'ok'
}

/** Also allow dropping standalone KuroCat *.json plugin files directly into Kun's own local pets folder. */
export async function importLocalKurocatPlugins(
  store: PetStore,
  localRoot: string,
  report: PetImportReport
): Promise<void> {
  const existingLocalIds = new Set<string>()
  for (const item of [...report.imported, ...report.updated, ...report.unchanged]) {
    if (item.source === 'kun-local') existingLocalIds.add(item.sourceId)
  }
  const kept = new Map<string, string>()
  for (const id of existingLocalIds) {
    const manifest = store.getManifest(petIdForSource('kun-local', id))
    if (manifest?.sourcePath) kept.set(id, manifest.sourcePath)
  }
  await scanJsonAndPackagesInFolder(store, localRoot, 'kun-local', kept, report, false)
}
