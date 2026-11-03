'use strict'

const assert = require('node:assert/strict')
const { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } = require('node:fs')
const { createRequire } = require('node:module')
const { tmpdir } = require('node:os')
const { dirname, join } = require('node:path')
const test = require('node:test')
const {
  KUN_SCOPE_SHARED_NESTED_PACKAGES,
  sharePackedScopeNestedPackages,
  validatePackedScopeNestedPackages
} = require('./after-pack-scope-dedupe.cjs')

function writeFixture(path, contents) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

function writePackage(root, manifest) {
  writeFixture(join(root, 'package.json'), JSON.stringify({ main: 'index.js', ...manifest }))
  writeFixture(
    join(root, 'index.js'),
    `module.exports = { name: ${JSON.stringify(manifest.name)}, version: ${JSON.stringify(manifest.version)} }\n`
  )
}

function unpackedFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'kun-scope-dedupe-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const kunModules = join(root, 'kun', 'node_modules')
  // Kun's zod@4 is hoisted to the root, so it is what @jimp/* would reach next.
  writePackage(join(root, 'node_modules', 'zod'), { name: 'zod', version: '4.4.3' })
  const jimp = join(kunModules, '@jimp')
  for (const member of ['plugin-blit', 'plugin-crop', 'types']) {
    writePackage(join(jimp, member), {
      name: `@jimp/${member}`,
      version: '1.6.0',
      dependencies: { zod: '^3.23.8' }
    })
    writePackage(join(jimp, member, 'node_modules', 'zod'), { name: 'zod', version: '3.25.76' })
  }
  writePackage(join(jimp, 'utils'), { name: '@jimp/utils', version: '1.6.0' })
  return {
    context: { appOutDir: root },
    helpers: { unpackedAppRoot: () => root },
    root,
    jimp
  }
}

function resolvedZodVersion(packageRoot) {
  return createRequire(join(packageRoot, 'index.js'))('zod').version
}

test('declares the jimp zod@3 copies as the shared scope dependency', () => {
  assert.deepEqual(KUN_SCOPE_SHARED_NESTED_PACKAGES, [{ scope: '@jimp', packageName: 'zod' }])
})

test('shares identical nested copies once per scope without changing resolution', (t) => {
  const { context, helpers, jimp } = unpackedFixture(t)
  assert.throws(
    () => validatePackedScopeNestedPackages(context, helpers),
    /Unexpected duplicate zod copies in @jimp: @jimp\/plugin-blit\/node_modules\/zod/
  )

  sharePackedScopeNestedPackages(context, helpers)

  assert.equal(existsSync(join(jimp, 'node_modules', 'zod', 'package.json')), true)
  for (const member of ['plugin-blit', 'plugin-crop', 'types']) {
    assert.equal(existsSync(join(jimp, member, 'node_modules')), false, member)
    assert.equal(resolvedZodVersion(join(jimp, member)), '3.25.76', member)
  }
  assert.deepEqual(readdirSync(jimp).sort(), [
    'node_modules', 'plugin-blit', 'plugin-crop', 'types', 'utils'
  ])
  assert.doesNotThrow(() => validatePackedScopeNestedPackages(context, helpers))
})

test('refuses to share copies whose versions diverge', (t) => {
  const { context, helpers, jimp } = unpackedFixture(t)
  writePackage(join(jimp, 'types', 'node_modules', 'zod'), { name: 'zod', version: '3.24.0' })
  assert.throws(
    () => sharePackedScopeNestedPackages(context, helpers),
    /Cannot share zod across @jimp: versions 3\.25\.76, 3\.24\.0/
  )
})

test('refuses a shared copy that would replace the version a member resolves today', (t) => {
  const { context, helpers, jimp } = unpackedFixture(t)
  writePackage(join(jimp, 'plugin-zod4'), {
    name: '@jimp/plugin-zod4',
    version: '1.6.0',
    dependencies: { zod: '^4.0.0' }
  })
  assert.equal(resolvedZodVersion(join(jimp, 'plugin-zod4')), '4.4.3')
  assert.throws(
    () => sharePackedScopeNestedPackages(context, helpers),
    /changed @jimp\/plugin-zod4 from 4\.4\.3 to 3\.25\.76/
  )
})

test('leaves scopes with fewer than two nested copies alone', (t) => {
  const { context, helpers, jimp } = unpackedFixture(t)
  for (const member of ['plugin-crop', 'types']) rmSync(join(jimp, member), { recursive: true })
  sharePackedScopeNestedPackages(context, helpers)
  assert.equal(existsSync(join(jimp, 'node_modules')), false)
  assert.equal(resolvedZodVersion(join(jimp, 'plugin-blit')), '3.25.76')
  assert.doesNotThrow(() => validatePackedScopeNestedPackages(context, helpers))
})
