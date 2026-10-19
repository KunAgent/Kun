'use strict'

const { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } = require('node:fs')
const { dirname, join, relative, sep } = require('node:path')
const { pathEntryExists } = require('./after-pack-hoisted-dependencies.cjs')

// npm cannot hoist a dependency above a conflicting version at the top of
// kun/node_modules. Kun depends on zod@4, so each of jimp 1.x's sixteen @jimp/*
// packages gets a private zod@3 copy (~1.5 MiB apiece). Node resolves a bare
// specifier through every ancestor directory, including the scope directory,
// so one copy at kun/node_modules/@jimp/node_modules/zod serves all of them
// while every package keeps resolving the exact same version as before.
const KUN_SCOPE_SHARED_NESTED_PACKAGES = [{ scope: '@jimp', packageName: 'zod' }]

function readManifest(packageRoot) {
  return JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
}

function declaresDependency(manifest, dependencyName) {
  return ['dependencies', 'optionalDependencies', 'peerDependencies'].some((field) =>
    Object.prototype.hasOwnProperty.call(manifest[field] || {}, dependencyName)
  )
}

function scopeMemberRoots(scopeRoot) {
  return readdirSync(scopeRoot, { withFileTypes: true })
    .filter((entry) =>
      entry.name !== 'node_modules' &&
      entry.isDirectory() &&
      existsSync(join(scopeRoot, entry.name, 'package.json'))
    )
    .map((entry) => join(scopeRoot, entry.name))
}

// Every package directory below the scope, including packages nested inside
// a member's own node_modules, because those also resolve through the scope.
function packageRootsBelow(directory) {
  const roots = []
  const visitModules = (modules) => {
    if (!existsSync(modules)) return
    for (const entry of readdirSync(modules, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === '.bin') continue
      const path = join(modules, entry.name)
      if (entry.name.startsWith('@')) visitModules(path)
      else visitPackage(path)
    }
  }
  const visitPackage = (packageRoot) => {
    if (!existsSync(join(packageRoot, 'package.json'))) return
    roots.push(packageRoot)
    visitModules(join(packageRoot, 'node_modules'))
  }
  for (const member of scopeMemberRoots(directory)) visitPackage(member)
  return roots
}

function resolvePackageRoot(boundary, issuerRoot, dependencyName) {
  let current = issuerRoot
  while (true) {
    const candidate = join(current, 'node_modules', ...dependencyName.split('/'))
    if (existsSync(join(candidate, 'package.json'))) return candidate
    if (current === boundary) return undefined
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

function dependencyResolutions(boundary, scopeRoot, dependencyName) {
  const resolutions = new Map()
  for (const packageRoot of packageRootsBelow(scopeRoot)) {
    const manifest = readManifest(packageRoot)
    if (!declaresDependency(manifest, dependencyName)) continue
    const resolved = resolvePackageRoot(boundary, packageRoot, dependencyName)
    resolutions.set(packageRoot, {
      required: Object.prototype.hasOwnProperty.call(manifest.dependencies || {}, dependencyName),
      version: resolved ? readManifest(resolved).version : undefined
    })
  }
  return resolutions
}

function nestedCopies(scopeRoot, dependencyName) {
  return scopeMemberRoots(scopeRoot)
    .map((member) => join(member, 'node_modules', ...dependencyName.split('/')))
    .filter((copy) => existsSync(join(copy, 'package.json')))
}

function shareScopeNestedPackage(boundary, kunModules, { scope, packageName }) {
  const scopeRoot = join(kunModules, scope)
  if (!existsSync(scopeRoot)) return
  const copies = nestedCopies(scopeRoot, packageName)
  if (copies.length < 2) return
  const versions = new Set(copies.map((copy) => readManifest(copy).version))
  if (versions.size !== 1) {
    throw new Error(
      `[after-pack] Cannot share ${packageName} across ${scope}: versions ${[...versions].join(', ')}`
    )
  }
  if (readManifest(copies[0]).bin) {
    throw new Error(`[after-pack] Cannot share ${packageName} across ${scope}: it declares binaries`)
  }
  const shared = join(scopeRoot, 'node_modules', ...packageName.split('/'))
  if (pathEntryExists(shared)) {
    throw new Error(`[after-pack] Shared ${scope} dependency path already exists: ${shared}`)
  }
  const before = dependencyResolutions(boundary, scopeRoot, packageName)
  mkdirSync(dirname(shared), { recursive: true })
  renameSync(copies[0], shared)
  for (const copy of copies.slice(1)) rmSync(copy, { recursive: true, force: true })
  for (const copy of copies) {
    const modules = dirname(copy)
    if (existsSync(modules) && readdirSync(modules).length === 0) rmSync(modules, { recursive: true })
  }
  const after = dependencyResolutions(boundary, scopeRoot, packageName)
  for (const [packageRoot, { version }] of before) {
    const sharedVersion = after.get(packageRoot)?.version
    if (sharedVersion !== version) {
      throw new Error(
        `[after-pack] Sharing ${packageName} changed ${relative(kunModules, packageRoot)} ` +
          `from ${version} to ${sharedVersion}`
      )
    }
  }
  console.log(
    `[after-pack] Shared ${packageName}@${[...versions][0]} across ${copies.length} ${scope} packages`
  )
}

function sharePackedScopeNestedPackages(context, helpers) {
  const root = helpers.unpackedAppRoot(context)
  const kunModules = join(root, 'kun', 'node_modules')
  if (!existsSync(kunModules)) return
  for (const entry of KUN_SCOPE_SHARED_NESTED_PACKAGES) {
    shareScopeNestedPackage(root, kunModules, entry)
  }
}

function validatePackedScopeNestedPackages(context, helpers) {
  const root = helpers.unpackedAppRoot(context)
  const kunModules = join(root, 'kun', 'node_modules')
  for (const { scope, packageName } of KUN_SCOPE_SHARED_NESTED_PACKAGES) {
    const scopeRoot = join(kunModules, scope)
    if (!existsSync(scopeRoot)) continue
    const copies = nestedCopies(scopeRoot, packageName)
    const versions = new Set(copies.map((copy) => readManifest(copy).version))
    if (copies.length > 1 && versions.size < copies.length) {
      throw new Error(
        `[after-pack] Unexpected duplicate ${packageName} copies in ${scope}: ${copies
          .map((copy) => relative(kunModules, copy).split(sep).join('/'))
          .join(', ')}`
      )
    }
    for (const [packageRoot, { required, version }] of dependencyResolutions(
      root,
      scopeRoot,
      packageName
    )) {
      if (required && !version) {
        throw new Error(
          `[after-pack] ${relative(kunModules, packageRoot)} cannot resolve ${packageName}`
        )
      }
    }
  }
}

module.exports = {
  KUN_SCOPE_SHARED_NESTED_PACKAGES,
  dependencyResolutions,
  sharePackedScopeNestedPackages,
  validatePackedScopeNestedPackages
}
