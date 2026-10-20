'use strict'

const { createHash } = require('node:crypto')
const {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync
} = require('node:fs')
const { createRequire } = require('node:module')
const { dirname, join, relative } = require('node:path')

function packageFingerprint(root) {
  const hash = createHash('sha256')
  let bytes = 0
  function visit(path) {
    const details = lstatSync(path)
    if (details.isDirectory()) {
      for (const entry of readdirSync(path).sort()) visit(join(path, entry))
    } else if (details.isFile()) {
      hash.update(`${relative(root, path)}\0${details.size}\0`)
      hash.update(readFileSync(path))
      bytes += details.size
    } else {
      throw new Error(`[after-pack] Cannot deduplicate non-regular Jimp Zod file: ${path}`)
    }
  }
  visit(root)
  return { digest: hash.digest('hex'), bytes }
}

function scopedPackageRoots(scopeRoot) {
  const roots = []
  function visitModules(modules) {
    if (!existsSync(modules)) return
    for (const entry of readdirSync(modules, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const root = join(modules, entry.name)
      if (entry.name.startsWith('@')) visitModules(root)
      else if (existsSync(join(root, 'package.json'))) {
        roots.push(root)
        visitModules(join(root, 'node_modules'))
      }
    }
  }
  visitModules(scopeRoot)
  return roots
}

function deduplicatePackedJimpZod(context, { unpackedAppRoot }) {
  const scope = join(unpackedAppRoot(context), 'kun', 'node_modules', '@jimp')
  if (!existsSync(scope)) return
  const shared = join(scope, 'node_modules', 'zod')
  const copies = readdirSync(scope, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
    .map((entry) => join(scope, entry.name, 'node_modules', 'zod'))
    .filter((path) => existsSync(path))
    .sort()
  if (copies.length === 0 || (copies.length === 1 && !existsSync(shared))) return

  // Jimp's plugins currently ship sixteen identical Zod 3 packages. Share one
  // inside their scope, never with Kun's incompatible root Zod 4. Keep the whole
  // package (including every CJS/ESM export and its license), not a reduced API.
  const source = existsSync(shared) ? shared : copies[0]
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
  if (manifest.name !== 'zod' || ['dependencies', 'optionalDependencies', 'peerDependencies']
    .some((field) => Object.keys(manifest[field] || {}).length > 0)) {
    throw new Error('[after-pack] Jimp Zod must be self-contained before scope-local deduplication')
  }
  const fingerprints = new Map()
  const fingerprint = (path) => {
    if (!fingerprints.has(path)) fingerprints.set(path, packageFingerprint(path))
    return fingerprints.get(path)
  }
  const expected = fingerprint(source)
  for (const copy of copies) {
    if (fingerprint(copy).digest !== expected.digest) {
      throw new Error(`[after-pack] Cannot deduplicate differing Jimp Zod package: ${copy}`)
    }
  }

  // Adding a scope-local dependency also affects nested consumers. Verify their
  // current resolution before changing anything so a future Zod 4 consumer, or
  // a differently patched copy, cannot be silently shadowed by the shared one.
  for (const packageRoot of scopedPackageRoots(scope)) {
    const packagePath = join(packageRoot, 'package.json')
    const consumer = JSON.parse(readFileSync(packagePath, 'utf8'))
    if (!['dependencies', 'optionalDependencies', 'peerDependencies']
      .some((field) => Object.hasOwn(consumer[field] || {}, 'zod'))) continue
    const resolved = dirname(createRequire(packagePath).resolve('zod/package.json'))
    if (fingerprint(resolved).digest !== expected.digest) {
      throw new Error(`[after-pack] Cannot change Jimp Zod resolution for ${consumer.name}`)
    }
  }

  const moved = !existsSync(shared)
  if (moved) {
    mkdirSync(dirname(shared), { recursive: true })
    renameSync(source, shared)
  }
  const removed = copies.filter((copy) => !moved || copy !== source)
  for (const copy of removed) rmSync(copy, { recursive: true, force: true })
  const bytesRemoved = removed.length * expected.bytes
  console.log(`[after-pack] Deduplicated ${removed.length} Jimp Zod copies (${bytesRemoved} bytes).`)
  return { copiesRemoved: removed.length, bytesRemoved }
}

module.exports = { deduplicatePackedJimpZod }
