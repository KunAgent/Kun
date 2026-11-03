'use strict'

const { createHash } = require('node:crypto')
const { existsSync, readFileSync, readdirSync, statSync, writeFileSync } = require('node:fs')
const { builtinModules } = require('node:module')
const { dirname, join, relative, resolve, sep } = require('node:path')

// A packaged Kun runtime can break long after the build succeeded: an update
// that only partly replaced app.asar.unpacked, a pruned dependency, or a
// truncated package leaves dist and node_modules out of step, and Node then
// throws ERR_MODULE_NOT_FOUND from a file the installer already accepted.
// The manifest written here is the single list of files and packages that the
// installer and the app health check verify, so a broken payload is rejected
// before it replaces a working install.
const MANIFEST_FILE_NAME = 'kun-runtime-integrity.json'
const SCHEMA_VERSION = 1
const BUILTIN_MODULES = new Set(
  builtinModules.flatMap((name) => [name, name.replace(/^node:/u, '')])
)
const ELECTRON_PROVIDED_PACKAGES = new Set(['electron'])
// Import statements in compiled output are the source of truth for what the
// runtime loads. Specifiers computed at runtime are deliberately out of scope.
const IMPORT_PATTERN =
  /(?<=[;{}()=\s]|^)(?:(?:import|export)\s*(?:[^'"\n;]*?\s*from\s*)?|import\s*\(\s*|require(?:\.resolve)?\s*\(\s*)['"]([^'"]+)['"]/gu
const BOOTSTRAP_FILES = [
  'app.asar.unpacked/kun/dist/cli/serve-entry.js',
  'app.asar.unpacked/kun/dist/cli/serve.js',
  'app.asar.unpacked/kun/dist/manager/manager-entry.js',
  'app.asar.unpacked/kun/dist/runtime-build.json',
  'app.asar.unpacked/kun/package.json'
]
// Every process the desktop app starts, including the terminal UI that runs on
// its own Node interpreter.
const RUNTIME_ENTRY_MODULES = [
  'cli/serve-entry.js',
  'manager/manager-entry.js',
  'cli/agent-cli.js',
  'cli/index.js'
]
// The packaged Kun child resolves its dependencies upward: first its own
// node_modules, then the root-hoisted copies that after-pack keeps on disk.
const KUN_MODULES_DIRS = [
  'app.asar.unpacked/kun/node_modules',
  'app.asar.unpacked/node_modules',
  'node_modules'
]

function toPosix(value) {
  return value.split(sep).join('/')
}

function manifestPathProblem(path) {
  if (typeof path !== 'string' || path.length === 0) return 'entry has no path'
  if (path.includes('\\')) return `path uses backslashes: ${path}`
  if (path.startsWith('/')) return `path is absolute: ${path}`
  if (/^[A-Za-z]:/u.test(path)) return `path has a drive letter: ${path}`
  const segments = path.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return `path is not a normalized relative path: ${path}`
  }
  return undefined
}

function packageNameFromSpecifier(specifier) {
  if (
    typeof specifier !== 'string' ||
    specifier.length === 0 ||
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('node:')
  ) {
    return undefined
  }
  const first = specifier.split('/')[0]
  if (BUILTIN_MODULES.has(specifier) || BUILTIN_MODULES.has(first)) return undefined
  if (!/^@?[a-zA-Z0-9][a-zA-Z0-9._~-]*$/u.test(first)) return undefined
  if (!specifier.startsWith('@')) return first
  const [scope, name] = specifier.split('/')
  return scope && name ? `${scope}/${name}` : undefined
}

function resolveDistModule(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier)
  const candidates = [base, `${base}.js`, join(base, 'index.js'), `${base}.mjs`]
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile())
}

// Only modules reachable from the real entry points count. Scanning every file
// under dist would report test-support modules that ship but never load.
function runtimePackages(distDir, entryFiles) {
  const packages = new Set()
  const missingRelative = new Set()
  const visited = new Set()
  const pending = entryFiles
    .map((entry) => join(distDir, ...entry.split('/')))
    .filter((entry) => existsSync(entry))
  while (pending.length > 0) {
    const file = pending.pop()
    if (!file || visited.has(file)) continue
    visited.add(file)
    for (const match of readFileSync(file, 'utf8').matchAll(IMPORT_PATTERN)) {
      const specifier = match[1]
      if (specifier.startsWith('.')) {
        const target = resolveDistModule(file, specifier)
        if (target) pending.push(target)
        else missingRelative.add(`${toPosix(relative(distDir, file))} -> ${specifier}`)
        continue
      }
      const name = packageNameFromSpecifier(specifier)
      if (name && !ELECTRON_PROVIDED_PACKAGES.has(name)) packages.add(name)
    }
  }
  return {
    packages: [...packages].sort(),
    missingRelative: [...missingRelative].sort(),
    reachableFiles: visited.size
  }
}

// Node resolves these to builtins before node_modules, so a packaged copy is
// never what the runtime loads.
function isBuiltinName(name) {
  return BUILTIN_MODULES.has(name) || BUILTIN_MODULES.has(name.replace(/^node:/u, ''))
}

// Node looks for a dependency in the requiring package's own node_modules
// first, then in each ancestor directory, so a nested copy (for example
// @opentui/core/node_modules/marked) is the one the runtime actually loads.
function nestedModulesDirs(fromDir) {
  const dirs = []
  let current = fromDir
  while (current) {
    dirs.push(`${current}/node_modules`)
    const parts = current.split('/')
    const cut = parts.length >= 2 && parts[parts.length - 2].startsWith('@') ? 2 : 1
    if (parts.length <= cut) break
    current = parts.slice(0, -cut).join('/')
  }
  return dirs
}

function resolveModuleDir(resourcesDir, name, fromDir) {
  const modulesDirs = fromDir
    ? [...nestedModulesDirs(fromDir), ...KUN_MODULES_DIRS]
    : KUN_MODULES_DIRS
  for (const modulesDir of modulesDirs) {
    const candidate = join(resourcesDir, ...modulesDir.split('/'), ...name.split('/'))
    if (existsSync(join(candidate, 'package.json'))) {
      return toPosix(relative(resourcesDir, candidate))
    }
  }
  return undefined
}

// Only declared runtime dependencies are followed. peerDependencies can be
// satisfied by an ancestor package and would produce false failures, and
// @types/* packages are declaration files that some packages still list as a
// dependency even though nothing loads them at runtime.
function packageDependencies(manifestPath) {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    return Object.keys(manifest.dependencies || {}).filter(
      (name) =>
        !name.startsWith('@types/') &&
        // better-sqlite3 uses this only from its install script. The packaged
        // runtime already includes the Electron-rebuilt native binding.
        !(manifest.name === 'better-sqlite3' && name === 'prebuild-install')
    )
  } catch {
    return []
  }
}

// Walking declared dependencies, not just the direct imports, is what catches a
// package whose own dependency was pruned or dropped from the payload.
function runtimeModuleClosure(resourcesDir, rootNames) {
  const modules = new Map()
  const pending = rootNames.map((name) => ({ name, fromDir: undefined }))
  while (pending.length > 0) {
    const { name, fromDir } = pending.pop()
    if (!name || modules.has(name)) continue
    const dir = resolveModuleDir(resourcesDir, name, fromDir)
    modules.set(name, { name, dir })
    if (!dir) continue
    const absolute = join(resourcesDir, ...dir.split('/'))
    for (const dependency of packageDependencies(join(absolute, 'package.json'))) {
      if (!isBuiltinName(dependency) && !modules.has(dependency)) {
        pending.push({ name: dependency, fromDir: dir })
      }
    }
  }
  return [...modules.values()].sort((left, right) => left.name.localeCompare(right.name))
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function treeTotals(root) {
  let fileCount = 0
  let totalBytes = 0
  const pending = [root]
  while (pending.length > 0) {
    const current = pending.pop()
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) pending.push(path)
      else if (entry.isFile()) {
        fileCount += 1
        totalBytes += statSync(path).size
      }
    }
  }
  return { fileCount, totalBytes }
}

function readRuntimeBuildId(resourcesDir) {
  const buildInfoPath = join(resourcesDir, 'app.asar.unpacked', 'kun', 'dist', 'runtime-build.json')
  if (!existsSync(buildInfoPath)) return undefined
  try {
    const buildId = JSON.parse(readFileSync(buildInfoPath, 'utf8')).buildId
    return typeof buildId === 'string' && buildId.length > 0 ? buildId : undefined
  } catch {
    return undefined
  }
}

function buildPackagedRuntimeIntegrity(options) {
  const resourcesDir = options && options.resourcesDir
  if (!resourcesDir) throw new Error('[runtime-integrity] resourcesDir is required')
  const distDir = join(resourcesDir, 'app.asar.unpacked', 'kun', 'dist')
  if (!existsSync(distDir)) {
    throw new Error(`[runtime-integrity] Packaged Kun runtime is missing: ${distDir}`)
  }
  const files = []
  for (const path of BOOTSTRAP_FILES) {
    const absolute = join(resourcesDir, ...path.split('/'))
    if (!existsSync(absolute)) {
      throw new Error(`[runtime-integrity] Required runtime file is missing: ${path}`)
    }
    files.push({ path, size: statSync(absolute).size, sha256: sha256File(absolute) })
  }
  const scan = runtimePackages(distDir, RUNTIME_ENTRY_MODULES)
  if (scan.missingRelative.length > 0) {
    throw new Error(
      '[runtime-integrity] Compiled runtime imports files that are not packaged:\n' +
        scan.missingRelative.map((entry) => `- ${entry}`).join('\n')
    )
  }
  const unresolved = []
  const modules = []
  for (const module of runtimeModuleClosure(resourcesDir, scan.packages)) {
    if (!module.dir) {
      unresolved.push(module.name)
      continue
    }
    const absolute = join(resourcesDir, ...module.dir.split('/'))
    files.push({
      path: `${module.dir}/package.json`,
      size: statSync(join(absolute, 'package.json')).size,
      sha256: sha256File(join(absolute, 'package.json'))
    })
    modules.push({ name: module.name, dir: module.dir, ...treeTotals(absolute) })
  }
  if (unresolved.length > 0) {
    throw new Error(
      '[runtime-integrity] Compiled runtime imports packages that are not packaged:\n' +
        unresolved.map((name) => `- ${name}`).join('\n')
    )
  }
  const unique = new Map(files.map((file) => [file.path, file]))
  return {
    schemaVersion: SCHEMA_VERSION,
    runtimeBuildId: readRuntimeBuildId(resourcesDir),
    platform: options.platform,
    arch: options.arch,
    files: [...unique.values()].sort((left, right) => left.path.localeCompare(right.path)),
    modules
  }
}

function manifestProblems(manifest) {
  if (!manifest || typeof manifest !== 'object') return ['manifest is not an object']
  const problems = []
  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    problems.push(`unsupported manifest schemaVersion: ${String(manifest.schemaVersion)}`)
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    problems.push('manifest lists no files')
  }
  if (!Array.isArray(manifest.modules) || manifest.modules.length === 0) {
    problems.push('manifest lists no modules')
  }
  if (problems.length > 0) return problems
  const seen = new Set()
  for (const file of manifest.files) {
    const pathProblem = manifestPathProblem(file && file.path)
    if (pathProblem) {
      problems.push(pathProblem)
      continue
    }
    if (seen.has(file.path)) problems.push(`duplicate manifest path: ${file.path}`)
    seen.add(file.path)
    if (!Number.isInteger(file.size) || file.size < 0) problems.push(`invalid size for ${file.path}`)
    if (typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(file.sha256)) {
      problems.push(`invalid sha256 for ${file.path}`)
    }
  }
  for (const module of manifest.modules) {
    if (
      !module ||
      typeof module.name !== 'string' ||
      packageNameFromSpecifier(module.name) !== module.name
    ) {
      problems.push(`invalid module name: ${String(module && module.name)}`)
      continue
    }
    const pathProblem = manifestPathProblem(module.dir)
    if (pathProblem) problems.push(`${module.name}: ${pathProblem}`)
    if (!Number.isInteger(module.fileCount) || module.fileCount <= 0) {
      problems.push(`invalid fileCount for ${module.name}`)
    }
    if (!Number.isInteger(module.totalBytes) || module.totalBytes <= 0) {
      problems.push(`invalid totalBytes for ${module.name}`)
    }
  }
  return problems
}

// mode 'presence' checks names and sizes only so ordinary startup stays cheap;
// mode 'hash' is for the installer and the release smoke test, which must not
// accept a truncated or swapped file.
function verifyPackagedRuntimeIntegrity(options) {
  const resourcesDir = options && options.resourcesDir
  if (!resourcesDir) throw new Error('[runtime-integrity] resourcesDir is required')
  const manifest = options.manifest
  const mode = options.mode === 'hash' ? 'hash' : 'presence'
  const problems = manifestProblems(manifest)
  if (problems.length > 0) return { ok: false, problems, runtimeBuildId: undefined }
  for (const file of manifest.files) {
    const absolute = join(resourcesDir, ...file.path.split('/'))
    if (!existsSync(absolute)) {
      problems.push(`missing ${file.path}`)
      continue
    }
    const size = statSync(absolute).size
    if (size !== file.size) {
      problems.push(`size mismatch for ${file.path} (expected ${file.size}, found ${size})`)
      continue
    }
    if (mode === 'hash' && sha256File(absolute) !== file.sha256) {
      problems.push(`sha256 mismatch for ${file.path}`)
    }
  }
  for (const module of manifest.modules) {
    const absolute = join(resourcesDir, ...module.dir.split('/'))
    if (!existsSync(join(absolute, 'package.json'))) {
      problems.push(`missing package ${module.name}`)
      continue
    }
    if (mode !== 'hash') continue
    const totals = treeTotals(absolute)
    if (totals.fileCount !== module.fileCount || totals.totalBytes !== module.totalBytes) {
      problems.push(
        `incomplete package ${module.name}: expected ${module.fileCount} files/` +
          `${module.totalBytes} bytes, found ${totals.fileCount}/${totals.totalBytes}`
      )
    }
  }
  const expectedBuildId = manifest.runtimeBuildId
  const actualBuildId = readRuntimeBuildId(resourcesDir)
  if (expectedBuildId && actualBuildId && expectedBuildId !== actualBuildId) {
    problems.push(`runtime build id mismatch (expected ${expectedBuildId}, found ${actualBuildId})`)
  }
  return { ok: problems.length === 0, problems, runtimeBuildId: actualBuildId }
}

function readPackagedRuntimeIntegrity(resourcesDir) {
  const manifestPath = join(resourcesDir, MANIFEST_FILE_NAME)
  if (!existsSync(manifestPath)) return undefined
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    return undefined
  }
}

function writePackagedRuntimeIntegrity(resourcesDir, manifest) {
  writeFileSync(join(resourcesDir, MANIFEST_FILE_NAME), `${JSON.stringify(manifest, null, 2)}\n`)
}

function formatIntegrityProblems(problems) {
  return problems.map((problem) => `- ${problem}`).join('\n')
}

module.exports = {
  MANIFEST_FILE_NAME,
  SCHEMA_VERSION,
  BOOTSTRAP_FILES,
  RUNTIME_ENTRY_MODULES,
  packageNameFromSpecifier,
  isBuiltinName,
  runtimePackages,
  runtimeModuleClosure,
  buildPackagedRuntimeIntegrity,
  manifestProblems,
  verifyPackagedRuntimeIntegrity,
  readPackagedRuntimeIntegrity,
  writePackagedRuntimeIntegrity,
  formatIntegrityProblems
}
