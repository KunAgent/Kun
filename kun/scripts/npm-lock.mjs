import assert from 'node:assert/strict'
import { posix } from 'node:path'

const EDGE_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies']

function resolveEntry(packages, owner, name) {
  let directory = owner
  while (true) {
    const key = posix.join(directory, 'node_modules', name)
    if (packages[key]) return key
    if (!directory || directory === '.') return undefined
    directory = posix.dirname(directory)
    if (posix.basename(directory) === 'node_modules') directory = posix.dirname(directory)
    if (directory === '.') directory = ''
  }
}

function matches(values, target) {
  return !values || (!values.includes('!' + target) &&
    (!values.some(value => !value.startsWith('!')) || values.includes(target)))
}

export function supportsTargets(entry, key, targets) {
  return !targets || targets.some(target => {
    const [os, cpu] = target.split('-')
    return matches(entry.os, os) && matches(entry.cpu, cpu) &&
      (os !== 'linux' || (matches(entry.libc, 'glibc') && !key.endsWith('-musl')))
  })
}

export function productionLock(source, manifest, bundledManifests, targets) {
  assert.equal(source.lockfileVersion, 3, 'Kun npm staging requires a v3 source lock')
  const packages = source.packages
  const result = { '': {
    name: manifest.name,
    version: manifest.version,
    license: manifest.license,
    dependencies: manifest.dependencies,
    ...(manifest.optionalDependencies ? { optionalDependencies: manifest.optionalDependencies } : {}),
    bundleDependencies: manifest.bundleDependencies,
    bin: manifest.bin,
    engines: manifest.engines
  } }
  const queue = Object.keys(manifest.dependencies).map((name) => resolveEntry(packages, '', name))
  for (const name of Object.keys(manifest.optionalDependencies ?? {})) {
    const key = resolveEntry(packages, '', name)
    if (key) queue.push(key)
  }
  const seen = new Set()
  while (queue.length) {
    const key = queue.shift()
    assert(key, 'A production dependency is missing from kun/package-lock.json')
    if (seen.has(key)) continue
    seen.add(key)
    const original = packages[key]
    if (!supportsTargets(original, key, targets)) {
      assert(original.optional, `Unsupported mandatory dependency: ${key}`)
      continue
    }
    const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length)
    const bundled = bundledManifests[name]
    const value = original.link ? packages[original.resolved] : original
    assert(value, `Missing linked lock entry: ${key}`)
    const entry = structuredClone(value)
    for (const field of ['dev', 'devOptional', 'link', 'peer']) delete entry[field]
    if (bundled) {
      delete entry.resolved
      delete entry.integrity
      delete entry.hasInstallScript
      entry.inBundle = true
      for (const field of EDGE_FIELDS) {
        if (bundled[field]) entry[field] = bundled[field]
        else delete entry[field]
      }
      delete entry.devDependencies
    }
    if (entry.resolved?.startsWith('https://registry.npmmirror.com/')) {
      entry.resolved = entry.resolved.replace('https://registry.npmmirror.com/', 'https://registry.npmjs.org/')
    }
    assert(!entry.resolved || !/^(?:file:|\.\.?\/)/.test(entry.resolved), `Nonportable resolution: ${key}`)
    result[key] = entry
    for (const field of EDGE_FIELDS) {
      for (const dependency of Object.keys(entry[field] ?? {})) {
        const child = resolveEntry(packages, key, dependency)
        const optional = field === 'optionalDependencies' ||
          (field === 'peerDependencies' && entry.peerDependenciesMeta?.[dependency]?.optional)
        assert(child || optional, `Missing dependency ${dependency} required by ${key}`)
        if (child) queue.push(child)
      }
    }
  }
  // Missing optional targets must not trigger registry resolution when a
  // consumer installs the completed bundle on another supported platform.
  for (const [key, entry] of Object.entries(result)) {
    for (const dependency of Object.keys(entry.optionalDependencies ?? {})) {
      if (resolveEntry(packages, key, dependency) && !resolveEntry(result, key, dependency)) {
        delete entry.optionalDependencies[dependency]
      }
    }
  }
  return { name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true, packages: result }
}
