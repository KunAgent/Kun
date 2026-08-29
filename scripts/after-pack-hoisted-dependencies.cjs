'use strict'

const { existsSync, lstatSync, readFileSync, readdirSync, rmSync } = require('node:fs')
const { dirname, join, relative } = require('node:path')

// Shared pure-JS runtimes that the root app and Kun resolve identically.
// after-pack removes the Kun copy from app.asar.unpacked/kun/node_modules; the
// packaged Kun child process then resolves these upward into
// app.asar.unpacked/node_modules, which electron-builder.config.cjs keeps on
// disk via asarUnpack.
//
// Every entry here must also appear in KUN_ROOT_HOISTED_VERSION_ANCHORS so the
// pack fails loudly whenever the root and Kun copies stop matching.
const KUN_ROOT_HOISTED_SHARED_JS_PACKAGES = [
  'pdfjs-dist',
  'xlsx',
  'diff',
  'ipaddr.js',
  'proxy-agent',
  'agent-base',
  'http-proxy-agent',
  'https-proxy-agent',
  'pac-proxy-agent',
  'pac-resolver',
  'proxy-from-env',
  'socks-proxy-agent',
  'socks',
  'smart-buffer',
  'ip-address',
  'netmask',
  'degenerator',
  'ast-types',
  'escodegen',
  'esprima',
  'estraverse',
  'esutils',
  'get-uri',
  'data-uri-to-buffer',
  'basic-ftp',
  'debug',
  'ms',
  'semver',
  'yaml',
  'yauzl',
  // yazl's buffer-crc32 and yauzl's pend transitive deps are deliberately NOT
  // hoisted: electron-builder resolves yazl's buffer-crc32 against extract-zip's
  // nested 0.2.13 copy, so that version anchor can never match. Their nested
  // copies under kun/node_modules stay packaged so Kun keeps resolving the
  // matching 1.0.0; only the package bodies are deduplicated here.
  'yazl',
  'zod'
]

// These packages support the hoisted dependency graph but cannot themselves
// be deduplicated by package name. lru-cache is nested under root proxy-agent,
// while its Kun copy is top-level; buffer-crc32 and pend also have unrelated
// root versions. They still need explicit asarUnpack patterns so a package
// loaded from app.asar.unpacked never crosses back into app.asar for a child.
const KUN_ROOT_HOISTED_SUPPORTING_JS_PACKAGES = [
  'buffer-crc32',
  'lru-cache',
  'pend',
  'proxy-agent-negotiate',
  'tslib'
]

const KUN_ROOT_UNPACKED_SHARED_JS_PACKAGES = [
  ...KUN_ROOT_HOISTED_SHARED_JS_PACKAGES,
  ...KUN_ROOT_HOISTED_SUPPORTING_JS_PACKAGES
]

function resolveDependencyManifestOnDisk(root, issuerManifest, dependencyName) {
  let current = dirname(issuerManifest)
  while (true) {
    const candidate = join(current, 'node_modules', ...dependencyName.split('/'), 'package.json')
    if (existsSync(candidate)) return candidate
    if (current === root) return undefined
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

// A Node child process starts from app.asar.unpacked/kun. Once one of its Kun
// dependencies is hoisted to app.asar.unpacked/node_modules, every required
// dependency reachable from that package must also exist on disk. Otherwise
// Electron can leave the child inside app.asar and Node reports an apparently
// missing package at runtime even though the archive contains it.
function validateRootHoistedDependencyClosure(root) {
  const modules = join(root, 'node_modules')
  const pending = KUN_ROOT_HOISTED_SHARED_JS_PACKAGES.map((packageName) => ({
    packageName,
    manifest: join(modules, ...packageName.split('/'), 'package.json')
  }))
  const visited = new Set()

  while (pending.length > 0) {
    const current = pending.pop()
    if (visited.has(current.manifest)) continue
    if (!existsSync(current.manifest)) {
      throw new Error(
        `[after-pack] Missing unpacked root-hoisted package manifest ${current.packageName}`
      )
    }
    visited.add(current.manifest)
    const packageJson = JSON.parse(readFileSync(current.manifest, 'utf8'))
    for (const dependencyName of Object.keys(packageJson.dependencies || {})) {
      const manifest = resolveDependencyManifestOnDisk(root, current.manifest, dependencyName)
      if (!manifest) {
        throw new Error(
          `[after-pack] Missing unpacked root-hoisted dependency ` +
            `${packageJson.name || current.packageName}@${packageJson.version || 'unknown'} -> ${dependencyName}`
        )
      }
      pending.push({ packageName: dependencyName, manifest })
    }
  }
}

function pathEntryExists(path) {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function packedDependencyPackageRoots(dependencyRoot) {
  if (existsSync(join(dependencyRoot, 'package.json'))) return [dependencyRoot]
  if (!existsSync(dependencyRoot)) return []
  return readdirSync(dependencyRoot, { withFileTypes: true })
    .filter((entry) =>
      (entry.isDirectory() || entry.isSymbolicLink()) &&
      existsSync(join(dependencyRoot, entry.name, 'package.json'))
    )
    .map((entry) => join(dependencyRoot, entry.name))
}

function packageBinNames(packageRoot) {
  const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  let names = []
  if (typeof packageJson.bin === 'string') {
    const packageName = packageJson.name?.split('/').pop()
    if (packageName) names = [packageName]
  } else if (packageJson.bin && typeof packageJson.bin === 'object') {
    names = Object.keys(packageJson.bin)
  }
  for (const name of names) {
    if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
      throw new Error(`[after-pack] Unsafe packaged Kun binary name: ${String(name)}`)
    }
  }
  return names
}

function packedKunPackageRoots(kunModules) {
  return readdirSync(kunModules, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) return []
    const packageRoot = join(kunModules, entry.name)
    return entry.name.startsWith('@')
      ? packedDependencyPackageRoots(packageRoot)
      : packedDependencyPackageRoots(packageRoot).slice(0, 1)
  })
}

function assertNoPackedKunBinOwnerCollisions(kunModules, dependencyRoots) {
  const prunedPackageRoots = new Set(dependencyRoots.flatMap(packedDependencyPackageRoots))
  const owners = new Map()
  for (const packageRoot of packedKunPackageRoots(kunModules)) {
    for (const binName of packageBinNames(packageRoot)) {
      const binOwners = owners.get(binName) || []
      binOwners.push(packageRoot)
      owners.set(binName, binOwners)
    }
  }
  for (const packageRoot of prunedPackageRoots) {
    for (const binName of packageBinNames(packageRoot)) {
      const retainedOwners = (owners.get(binName) || [])
        .filter((owner) => !prunedPackageRoots.has(owner))
      if (retainedOwners.length > 0) {
        const ownerNames = retainedOwners
          .map((owner) => relative(kunModules, owner))
          .join(', ')
        throw new Error(
          `[after-pack] Kun binary launcher collision for ${binName}: retained by ${ownerNames}`
        )
      }
    }
  }
}

function prunePackedKunBinLaunchers(kunModules, dependencyRoot) {
  const binRoot = join(kunModules, '.bin')
  if (!existsSync(binRoot)) return
  const binNames = new Set(packedDependencyPackageRoots(dependencyRoot).flatMap(packageBinNames))
  for (const binName of binNames) {
    for (const suffix of ['', '.cmd', '.ps1']) {
      const launcher = join(binRoot, `${binName}${suffix}`)
      if (!pathEntryExists(launcher)) continue
      rmSync(launcher, { force: true })
      console.log(`[after-pack] Removed hoisted Kun binary launcher: ${binName}${suffix}`)
    }
  }
}

function validatePackedKunBinLinks(kunModules) {
  const binRoot = join(kunModules, '.bin')
  if (!existsSync(binRoot)) return
  for (const entry of readdirSync(binRoot)) {
    const launcher = join(binRoot, entry)
    if (lstatSync(launcher).isSymbolicLink() && !existsSync(launcher)) {
      throw new Error(`[after-pack] Dangling packaged Kun binary launcher: ${entry}`)
    }
  }
}

module.exports = {
  KUN_ROOT_HOISTED_SHARED_JS_PACKAGES,
  KUN_ROOT_HOISTED_SUPPORTING_JS_PACKAGES,
  KUN_ROOT_UNPACKED_SHARED_JS_PACKAGES,
  assertNoPackedKunBinOwnerCollisions,
  pathEntryExists,
  prunePackedKunBinLaunchers,
  validatePackedKunBinLinks,
  validateRootHoistedDependencyClosure
}
