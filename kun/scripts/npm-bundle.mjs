import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { createRequire } from 'node:module'
import { downloadArchive, extractArchive } from './npm-archive.mjs'
import { json, writeJson } from './npm-files.mjs'

export async function bundleProduction(stage, lock, localNames, cache) {
  const local = new Set(localNames.map(name => `node_modules/${name}`))
  const queue = Object.entries(lock.packages).filter(([key, entry]) => key && !local.has(key) && !entry.inBundle)
  let cursor = 0
  let completed = 0
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (cursor < queue.length) {
      const [key, entry] = queue[cursor++]
      assert(key.startsWith('node_modules/') && !key.split('/').includes('..'), `Invalid dependency location: ${key}`)
      assert(entry.integrity && entry.resolved, `Missing pinned archive for ${key}`)
      const directory = join(stage, key)
      const bytes = await downloadArchive(entry.resolved, entry.integrity, cache)
      await extractArchive(bytes, directory)
      const manifest = await json(join(directory, 'package.json'))
      assert.equal(manifest.version, entry.version, `Wrong dependency archive version: ${key}`)
      // These dependencies are already built; installation must not run arbitrary
      // build/prepare scripts or re-download a different native payload.
      delete manifest.scripts
      delete manifest.devDependencies
      delete manifest.overrides
      // npm synthesizes `node-gyp rebuild` when binding.gyp exists even after
      // install scripts are removed. These payloads already contain prebuilds.
      manifest.gypfile = false
      if (manifest.optionalDependencies) manifest.optionalDependencies = entry.optionalDependencies ?? {}
      await writeJson(join(directory, 'package.json'), manifest)
      entry.inBundle = true
      delete entry.hasInstallScript
      completed++
      if (completed % 40 === 0 || completed === queue.length) process.stderr.write(`[kun-npm] Bundled ${completed}/${queue.length} production archives\n`)
    }
  }))
  const patch = createRequire(import.meta.url)('./patch-babel-glob-interop.cjs')
  patch.patchInstalledModule(createRequire(join(stage, 'package.json')).resolve('babel-plugin-module-resolver'))
}

export function bundledManifest(manifest, lock) {
  const dependencies = {}
  const optionalDependencies = {}
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key || key.slice('node_modules/'.length).includes('/node_modules/')) continue
    const name = key.slice('node_modules/'.length)
    if (!entry.inBundle) {
      if (manifest.optionalDependencies?.[name]) optionalDependencies[name] = entry.version
      continue
    }
    const target = entry.optional || entry.os || entry.cpu ? optionalDependencies : dependencies
    target[name] = entry.version
  }
  return { ...manifest, dependencies, optionalDependencies,
    bundleDependencies: Object.keys({ ...dependencies, ...optionalDependencies })
      .filter(name => lock.packages[`node_modules/${name}`]?.inBundle) }
}

export async function bundleSqlite(stage, descriptor, cache) {
  const root = join(stage, 'node_modules', 'better-sqlite3')
  const manifest = await json(join(root, 'package.json'))
  assert.equal(manifest.version, descriptor.version)
  const files = {}
  for (const [target, entry] of Object.entries(descriptor.targets)) {
    const bytes = await downloadArchive(entry.url, `sha256-${entry.sha256}`, cache)
    // The prebuild archive is build/Release/better_sqlite3.node.
    await extractArchive(bytes, join(root, 'prebuilds', target))
    const binary = await readFile(join(root, 'prebuilds', target, 'Release/better_sqlite3.node'))
    assert(binary.length > 0, `Missing SQLite prebuild for ${target}`)
    files[target] = createHash('sha256').update(binary).digest('hex')
  }
  manifest.files = ['lib', 'prebuilds', 'LICENSE', 'README.md', 'package.json']
  await writeJson(join(root, 'package.json'), manifest)
  const path = join(root, 'lib/database.js')
  const source = await readFile(path, 'utf8')
  const original = "require('bindings')('better_sqlite3.node')"
  assert(source.includes(original), 'Review the SQLite bundled native-loader patch')
  const replacement = `require('../prebuilds/' + process.platform + '-' + process.arch + '/Release/better_sqlite3.node')`
  await writeFile(path, source.replace(original, replacement))
  return { version: descriptor.version, nodeAbi: descriptor.nodeAbi, files,
    targets: Object.fromEntries(Object.entries(descriptor.targets).map(([key, value]) => [key, value.sha256])),
    nativeDirectory: relative(stage, root).split('\\').join('/') + '/prebuilds' }
}
