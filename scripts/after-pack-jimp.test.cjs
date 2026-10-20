'use strict'

const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, statSync, symlinkSync, writeFileSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const { dirname, join, relative } = require('node:path')
const test = require('node:test')
const { deduplicatePackedJimpZod } = require('./after-pack-jimp.cjs')
const { logicalBytes, MIB } = require('./check-package-size.cjs')

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'kun-jimp-payload-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const scope = join(root, 'kun', 'node_modules', '@jimp')
  return {
    root, scope,
    shared: join(scope, 'node_modules', 'zod'),
    prune: () => deduplicatePackedJimpZod({}, { unpackedAppRoot: () => root })
  }
}

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

function writeZod(root, version = '3.25.76') {
  write(join(root, 'package.json'), JSON.stringify({ name: 'zod', version, main: 'index.cjs' }))
  write(join(root, 'index.cjs'), `module.exports = ${JSON.stringify(version)}`)
  write(join(root, 'LICENSE'), 'MIT license fixture')
}

function writeConsumer(scope, name, version = '3.25.76') {
  const root = join(scope, name)
  write(join(root, 'package.json'), JSON.stringify({
    name: `@jimp/${name}`, dependencies: { zod: version }
  }))
  writeZod(join(root, 'node_modules', 'zod'), version)
  return join(root, 'node_modules', 'zod')
}

test('deduplicates byte-identical Jimp copies without replacing root Zod', (t) => {
  const { root, scope, shared, prune } = fixture(t)
  writeZod(join(root, 'node_modules', 'zod'), '4.4.3')
  const first = writeConsumer(scope, 'first')
  const second = writeConsumer(scope, 'second')
  const before = logicalBytes(root)
  const expectedBytes = logicalBytes(first)
  assert.deepEqual(prune(), { copiesRemoved: 1, bytesRemoved: expectedBytes })
  assert.equal(before - logicalBytes(root), expectedBytes)
  assert.equal(existsSync(first), false)
  assert.equal(existsSync(second), false)
  assert.equal(readFileSync(join(shared, 'LICENSE'), 'utf8'), 'MIT license fixture')
  assert.equal(require(join(root, 'node_modules', 'zod')), '4.4.3')
  assert.equal(prune(), undefined, 'repeat packaging is idempotent')
})

for (const change of ['version', 'content']) {
  test(`rejects differing Jimp Zod ${change} before removing any package`, (t) => {
    const { scope, shared, prune } = fixture(t)
    const first = writeConsumer(scope, 'first')
    const second = writeConsumer(scope, 'second', change === 'version' ? '4.4.3' : '3.25.76')
    if (change === 'content') write(join(second, 'index.cjs'), 'module.exports = "patched"')
    assert.throws(prune, /Cannot deduplicate differing Jimp Zod package/)
    assert.equal(existsSync(first), true)
    assert.equal(existsSync(second), true)
    assert.equal(existsSync(shared), false)
  })
}

test('does not shadow a nested Jimp consumer of root Zod 4', (t) => {
  const { root, scope, shared, prune } = fixture(t)
  writeZod(join(root, 'node_modules', 'zod'), '4.4.3')
  const first = writeConsumer(scope, 'first')
  writeConsumer(scope, 'second')
  // Put the incompatible consumer under a sibling without a local Zod copy.
  write(join(scope, 'third', 'package.json'), JSON.stringify({ name: '@jimp/third' }))
  write(join(scope, 'third', 'node_modules', 'nested', 'package.json'), JSON.stringify({
    name: 'nested', dependencies: { zod: '^4.0.0' }
  }))
  assert.throws(prune, /Cannot change Jimp Zod resolution for nested/)
  assert.equal(existsSync(first), true)
  assert.equal(existsSync(shared), false)
})

test('does not relocate a Zod package with runtime dependencies', (t) => {
  const { scope, shared, prune } = fixture(t)
  const first = writeConsumer(scope, 'first')
  const second = writeConsumer(scope, 'second')
  for (const copy of [first, second]) {
    write(join(copy, 'package.json'), JSON.stringify({
      name: 'zod', version: '3.25.76', dependencies: { other: '1.0.0' }
    }))
  }
  assert.throws(prune, /Jimp Zod must be self-contained/)
  assert.equal(existsSync(first), true)
  assert.equal(existsSync(shared), false)
})

test('does not follow symlinks while comparing Jimp Zod payloads', {
  skip: process.platform === 'win32' && 'Creating file symlinks requires Windows privileges'
}, (t) => {
  const { scope, shared, prune } = fixture(t)
  const first = writeConsumer(scope, 'first')
  writeConsumer(scope, 'second')
  symlinkSync('index.cjs', join(first, 'linked.cjs'))
  assert.throws(prune, /Cannot deduplicate non-regular Jimp Zod file/)
  assert.equal(existsSync(first), true)
  assert.equal(existsSync(shared), false)
})

function copyJimpClosure(destination) {
  const projectDir = join(__dirname, '..')
  const { getMainFileMatchers } = require('app-builder-lib/out/fileMatcher')
  const builderConfig = require('../electron-builder.config.cjs')
  const [matcher] = getMainFileMatchers(projectDir, destination, (value) => value, {}, {
    info: {
      projectDir, buildResourcesDir: 'build',
      config: { ...builderConfig, files: [...builderConfig.files] },
      isPrepackedAppAsar: false, debugLogger: { isEnabled: false }
    }
  }, join(projectDir, 'dist'), false)
  const filter = matcher.createFilter()
  const visited = new Set()
  function copy(source) {
    if (visited.has(source)) return
    visited.add(source)
    cpSync(source, join(destination, relative(projectDir, source)), {
      recursive: true, filter: (path) => filter(path, statSync(path))
    })
    const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
    for (const name of Object.keys(manifest.dependencies || {})) {
      let current = source
      while (!existsSync(join(current, 'node_modules', name, 'package.json'))) {
        assert.notEqual(current, projectDir, `Missing installed dependency ${name}`)
        current = dirname(current)
      }
      copy(join(current, 'node_modules', name))
    }
  }
  copy(join(projectDir, 'kun', 'node_modules', 'jimp'))
  copy(join(projectDir, 'kun', 'node_modules', 'zod'))
}

function runJimp(root) {
  // Run outside the checkout, in a fresh process with no resolution cache or
  // NODE_PATH fallback. Cover the CJS and ESM image APIs used by screenshots,
  // room previews and avatar uploads, and all plugins' Zod imports.
  return execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict'
    import { createHash } from 'node:crypto'
    import { existsSync, readFileSync, readdirSync } from 'node:fs'
    import { createRequire } from 'node:module'
    import { join } from 'node:path'
    import { Jimp as ESM } from 'jimp'
    const require = createRequire(import.meta.url)
    const { Jimp: CJS } = require('jimp')
    assert.equal(require('zod/package.json').version, '4.4.3')
    const scope = join(process.cwd(), 'node_modules', '@jimp')
    const sharedManifest = join(scope, 'node_modules', 'zod', 'package.json')
    for (const name of readdirSync(scope)) {
      const manifestPath = join(scope, name, 'package.json')
      if (!existsSync(manifestPath)) continue
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (!manifest.dependencies?.zod) continue
      const fromPlugin = createRequire(manifestPath)
      assert.equal(fromPlugin('zod/package.json').version, '3.25.76')
      if (existsSync(sharedManifest)) {
        assert.equal(fromPlugin.resolve('zod/package.json'), sharedManifest)
      }
    }
    const results = []
    for (const Jimp of [ESM, CJS]) {
      const data = Buffer.alloc(8 * 6 * 4)
      for (let i = 0; i < data.length; i += 1) data[i] = i % 256
      const image = Jimp.fromBitmap({ data, width: 8, height: 6 })
      const png = await image.resize({ w: 4, h: 3 }).getBuffer('image/png')
      const decoded = await Jimp.read(png)
      assert.equal(decoded.bitmap.width, 4)
      assert.equal(decoded.bitmap.height, 3)
      const preview = await decoded.cover({ w: 3, h: 3 }).getBuffer('image/jpeg', { quality: 82 })
      const avatar = await Jimp.read(preview)
      avatar.scaleToFit({ w: 2, h: 2 })
      assert.equal(avatar.bitmap.width, 2)
      assert.equal(avatar.bitmap.height, 2)
      assert.throws(() => avatar.resize({ w: 'invalid' }))
      results.push(createHash('sha256').update(png).update(preview).digest('hex'))
    }
    assert.equal(results[0], results[1])
    process.stdout.write(JSON.stringify(results))
  `], {
    cwd: join(root, 'kun'), env: { ...process.env, NODE_PATH: '' },
    encoding: 'utf8', timeout: 30_000
  })
}

test('filtered Jimp keeps every Zod file and both image APIs while saving over 14 MiB', (t) => {
  const { root, scope, shared, prune } = fixture(t)
  copyJimpClosure(root)
  const consumers = readdirSync(scope).filter((name) =>
    existsSync(join(scope, name, 'node_modules', 'zod', 'package.json'))
  )
  const source = join(scope, consumers[0], 'node_modules', 'zod')
  const files = readdirSync(source, { recursive: true })
    .filter((path) => statSync(join(source, path)).isFile())
    .map((path) => [path, readFileSync(join(source, path))])
  const outputBefore = runJimp(root)
  const bytesBefore = logicalBytes(root)
  const result = prune()
  assert.ok(result.bytesRemoved > 14 * MIB)
  assert.equal(bytesBefore - logicalBytes(root), result.bytesRemoved)
  for (const [path, bytes] of files) assert.deepEqual(readFileSync(join(shared, path)), bytes, path)
  for (const name of consumers) {
    assert.equal(existsSync(join(scope, name, 'node_modules', 'zod')), false)
  }
  assert.equal(runJimp(root), outputBefore)
  t.diagnostic(`Removed ${result.copiesRemoved} duplicate packages: ${result.bytesRemoved} bytes`)
})
