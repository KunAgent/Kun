import { readFileSync as nodeReadFileSync, statSync as nodeStatSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

export type PackagedInstallHealth =
  | { ok: true }
  | { ok: false; missing: string[] }

type PackagedInstallHealthInput = {
  isPackaged: boolean
  executablePath: string
  resourcesPath: string
}

type FileStat = {
  isFile(): boolean
  size: number | bigint
}

type FileStatSync = (path: string) => FileStat
type ModuleLoader = (id: string) => unknown

const requireFromHere = createRequire(import.meta.url)

/**
 * Electron virtualizes `node:fs` access to an ASAR archive. In a packaged app,
 * statSync(resources/app.asar) therefore describes the mounted archive root as
 * a directory instead of the physical archive file. `original-fs` bypasses the
 * ASAR layer; plain Node (including unit tests) falls back to its already-raw fs.
 */
export function resolveInstallHealthFileStat(loadModule: ModuleLoader = requireFromHere): FileStatSync {
  try {
    const rawFs = loadModule('original-fs') as { statSync?: FileStatSync }
    if (typeof rawFs?.statSync === 'function') {
      return (path) => rawFs.statSync!(path)
    }
  } catch {
    // `original-fs` is an Electron built-in and is unavailable in plain Node.
  }
  return (path) => nodeStatSync(path)
}

const rawStatSync = resolveInstallHealthFileStat()

function isNonEmptyFile(path: string): boolean {
  try {
    const stat = rawStatSync(path)
    return stat.isFile() && stat.size > 0n
  } catch {
    return false
  }
}

// Written by after-pack next to app.asar. Reading it through `original-fs`
// would hide nothing, but the manifest itself lives outside the archive.
const RUNTIME_INTEGRITY_MANIFEST = 'kun-runtime-integrity.json'

type RuntimeIntegrityManifest = {
  schemaVersion: number
  files: { path: string, size: number }[]
  modules: { name: string, dir: string }[]
}

/**
 * A resume or an update can leave the unpacked runtime with the bootstrap
 * files intact but a package gone, which fails later inside the child process.
 * The manifest lists every packaged file and module the runtime resolves, so a
 * partial payload is detected before the workbench tries to start.
 *
 * Only names and sizes are checked here: hashing the whole payload on every
 * launch would cost more than it protects. The installer and the release smoke
 * test verify the recorded hashes instead.
 */
function inspectRuntimeIntegrity(resourcesPath: string): string[] {
  const manifestPath = join(resourcesPath, RUNTIME_INTEGRITY_MANIFEST)
  let manifest: RuntimeIntegrityManifest
  try {
    manifest = JSON.parse(nodeReadFileSync(manifestPath, 'utf8')) as RuntimeIntegrityManifest
  } catch {
    // Older installs shipped no manifest; the required-file list above still
    // applies, and a missing manifest must not block an otherwise valid install.
    return []
  }
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.files) || !Array.isArray(manifest.modules)) {
    return ['Kun runtime integrity manifest is unreadable']
  }
  const problems: string[] = []
  for (const file of manifest.files) {
    if (typeof file?.path !== 'string' || typeof file?.size !== 'number') {
      problems.push('Kun runtime integrity manifest entry is invalid')
      continue
    }
    let size: number
    try {
      const stat = rawStatSync(join(resourcesPath, ...file.path.split('/')))
      if (!stat.isFile()) {
        problems.push(`Kun runtime file is missing: ${file.path}`)
        continue
      }
      size = Number(stat.size)
    } catch {
      problems.push(`Kun runtime file is missing: ${file.path}`)
      continue
    }
    if (size !== file.size) problems.push(`Kun runtime file is truncated: ${file.path}`)
  }
  for (const module of manifest.modules) {
    if (typeof module?.name !== 'string' || typeof module?.dir !== 'string') {
      problems.push('Kun runtime integrity manifest module is invalid')
      continue
    }
    if (!isNonEmptyFile(join(resourcesPath, ...module.dir.split('/'), 'package.json'))) {
      problems.push(`Kun runtime package is missing: ${module.name}`)
    }
  }
  return problems
}

/**
 * Detect the subset of interrupted-install failures where Electron can still
 * start but the unpacked Kun runtime is incomplete. A missing app.asar cannot
 * reach this code, so the installer performs the same post-install check.
 */
export function inspectPackagedInstallHealth(input: PackagedInstallHealthInput): PackagedInstallHealth {
  if (!input.isPackaged) return { ok: true }

  const required = [
    { label: 'application executable', path: input.executablePath },
    { label: 'resources/app.asar', path: join(input.resourcesPath, 'app.asar') },
    {
      label: 'Kun runtime entry',
      path: join(input.resourcesPath, 'app.asar.unpacked', 'kun', 'dist', 'cli', 'serve-entry.js')
    },
    {
      label: 'Kun service manager entry',
      path: join(input.resourcesPath, 'app.asar.unpacked', 'kun', 'dist', 'manager', 'manager-entry.js')
    }
  ]
  const missing = required.filter((entry) => !isNonEmptyFile(entry.path)).map((entry) => entry.label)
  const integrity = inspectRuntimeIntegrity(input.resourcesPath)
  const problems = [...missing, ...integrity]
  return problems.length === 0 ? { ok: true } : { ok: false, missing: problems }
}
