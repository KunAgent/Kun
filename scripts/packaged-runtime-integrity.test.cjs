'use strict'

const assert = require('node:assert/strict')
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { test } = require('node:test')
const {
  MANIFEST_FILE_NAME,
  buildPackagedRuntimeIntegrity,
  readPackagedRuntimeIntegrity,
  verifyPackagedRuntimeIntegrity,
  writePackagedRuntimeIntegrity
} = require('./packaged-runtime-integrity.cjs')

function writeFile(root, relativePath, contents) {
  const path = join(root, ...relativePath.split('/'))
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, contents)
}

// Mirrors the packaged layout: the Kun child resolves its own node_modules
// first and then the root-hoisted copies kept on disk next to it.
function createResourcesRoot() {
  const root = mkdtempSync(join(tmpdir(), 'kun-runtime-integrity-'))
  writeFile(root, 'app.asar.unpacked/kun/dist/cli/serve-entry.js', "export * from './serve.js'\n")
  writeFile(
    root,
    'app.asar.unpacked/kun/dist/cli/serve.js',
    "import { alpha } from 'alpha'\nexport * from './util.js'\n"
  )
  writeFile(root, 'app.asar.unpacked/kun/dist/cli/util.js', 'export const util = 2\n')
  writeFile(root, 'app.asar.unpacked/kun/dist/manager/manager-entry.js', "import { beta } from 'beta'\n")
  writeFile(
    root,
    'app.asar.unpacked/kun/dist/runtime-build.json',
    JSON.stringify({ version: 1, buildId: 'build-one' })
  )
  writeFile(root, 'app.asar.unpacked/kun/package.json', JSON.stringify({ name: 'kun', version: '1.0.0' }))
  writeFile(
    root,
    'app.asar.unpacked/kun/node_modules/alpha/package.json',
    JSON.stringify({ name: 'alpha', dependencies: { beta: '1.0.0' } })
  )
  writeFile(root, 'app.asar.unpacked/kun/node_modules/alpha/index.js', 'module.exports = 1\n')
  writeFile(root, 'app.asar.unpacked/kun/node_modules/beta/package.json', JSON.stringify({ name: 'beta' }))
  return root
}

function withResources(run) {
  const root = createResourcesRoot()
  try {
    return run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('records bootstrap files and the reachable dependency closure', () => {
  withResources((root) => {
    const manifest = buildPackagedRuntimeIntegrity({ resourcesDir: root, platform: 'win32', arch: 'x64' })

    assert.equal(manifest.schemaVersion, 1)
    assert.equal(manifest.runtimeBuildId, 'build-one')
    assert.equal(manifest.platform, 'win32')
    assert.deepEqual(
      manifest.modules.map((module) => module.name),
      ['alpha', 'beta']
    )
    assert.ok(manifest.files.some((file) => file.path.endsWith('kun/dist/cli/serve-entry.js')))
    assert.ok(manifest.files.some((file) => file.path.endsWith('kun/node_modules/alpha/package.json')))
    assert.equal(verifyPackagedRuntimeIntegrity({ resourcesDir: root, manifest, mode: 'hash' }).ok, true)
  })
})

test('rejects a payload whose runtime dependency is not packaged', () => {
  withResources((root) => {
    rmSync(join(root, 'app.asar.unpacked/kun/node_modules/beta'), { recursive: true, force: true })

    assert.throws(
      () => buildPackagedRuntimeIntegrity({ resourcesDir: root, platform: 'win32', arch: 'x64' }),
      /Runtime dependency is not packaged: beta|packages that are not packaged/
    )
  })
})

test('resolves a dependency nested under the package that requires it', () => {
  withResources((root) => {
    writeFile(
      root,
      'app.asar.unpacked/kun/node_modules/alpha/package.json',
      JSON.stringify({ name: 'alpha', version: '1.0.0', dependencies: { gamma: '1.0.0' } })
    )
    writeFile(
      root,
      'app.asar.unpacked/kun/node_modules/alpha/node_modules/gamma/package.json',
      JSON.stringify({ name: 'gamma', version: '1.0.0' })
    )

    const manifest = buildPackagedRuntimeIntegrity({ resourcesDir: root, platform: 'win32', arch: 'x64' })

    const gamma = manifest.modules.find((module) => module.name === 'gamma')
    assert.equal(gamma.dir, 'app.asar.unpacked/kun/node_modules/alpha/node_modules/gamma')
  })
})

test('rejects a payload whose compiled runtime imports a missing file', () => {
  withResources((root) => {
    rmSync(join(root, 'app.asar.unpacked/kun/dist/cli/util.js'))

    assert.throws(
      () => buildPackagedRuntimeIntegrity({ resourcesDir: root, platform: 'win32', arch: 'x64' }),
      /imports files that are not packaged/
    )
  })
})

test('reports a removed package, a resized file and a swapped file', () => {
  withResources((root) => {
    const manifest = buildPackagedRuntimeIntegrity({ resourcesDir: root, platform: 'win32', arch: 'x64' })

    const alphaManifest = 'app.asar.unpacked/kun/node_modules/alpha/package.json'
    rmSync(join(root, 'app.asar.unpacked/kun/node_modules/beta'), { recursive: true, force: true })
    const missingPackage = verifyPackagedRuntimeIntegrity({ resourcesDir: root, manifest, mode: 'presence' })
    assert.equal(missingPackage.ok, false)
    assert.match(missingPackage.problems.join('\n'), /missing package beta/)

    writeFileSync(join(root, ...alphaManifest.split('/')), JSON.stringify({ name: 'alpha', dependencies: {} }))
    const resized = verifyPackagedRuntimeIntegrity({ resourcesDir: root, manifest, mode: 'presence' })
    assert.match(resized.problems.join('\n'), /size mismatch/)

    const sameSize = 'x'.repeat(JSON.stringify({ name: 'alpha', dependencies: { beta: '1.0.0' } }).length - 1) + '}'
    writeFileSync(join(root, ...alphaManifest.split('/')), sameSize)
    const presence = verifyPackagedRuntimeIntegrity({ resourcesDir: root, manifest, mode: 'presence' })
    assert.equal(presence.problems.some((problem) => problem.includes('sha256 mismatch')), false)
    const hashed = verifyPackagedRuntimeIntegrity({ resourcesDir: root, manifest, mode: 'hash' })
    assert.match(hashed.problems.join('\n'), /sha256 mismatch/)
  })
})

test('rejects an incomplete package even when its manifest survived', () => {
  withResources((root) => {
    const manifest = buildPackagedRuntimeIntegrity({ resourcesDir: root, platform: 'win32', arch: 'x64' })
    rmSync(join(root, 'app.asar.unpacked/kun/node_modules/alpha/index.js'))

    const result = verifyPackagedRuntimeIntegrity({ resourcesDir: root, manifest, mode: 'hash' })
    assert.equal(result.ok, false)
    assert.match(result.problems.join('\n'), /incomplete package alpha/)
  })
})

test('rejects a stale runtime build id', () => {
  withResources((root) => {
    const manifest = buildPackagedRuntimeIntegrity({ resourcesDir: root, platform: 'win32', arch: 'x64' })
    writeFile(
      root,
      'app.asar.unpacked/kun/dist/runtime-build.json',
      JSON.stringify({ version: 1, buildId: 'build-two' })
    )

    const result = verifyPackagedRuntimeIntegrity({ resourcesDir: root, manifest, mode: 'presence' })
    assert.equal(result.ok, false)
    assert.ok(result.problems.some((problem) => problem.includes('build id mismatch')))
  })
})

test('rejects unsafe or ambiguous manifest paths', () => {
  withResources((root) => {
    const manifest = buildPackagedRuntimeIntegrity({ resourcesDir: root, platform: 'win32', arch: 'x64' })
    const good = manifest.files[1]

    for (const path of [
      '../escape.js',
      '/absolute.js',
      'C:/windows.js',
      'app.asar.unpacked\\kun\\dist\\cli\\serve.js',
      './app.asar.unpacked/kun/dist/cli/serve.js'
    ]) {
      const tampered = { ...manifest, files: [{ ...good, path }] }
      const result = verifyPackagedRuntimeIntegrity({ resourcesDir: root, manifest: tampered })
      assert.equal(result.ok, false, `expected ${path} to be rejected`)
    }

    const duplicated = { ...manifest, files: [good, { ...good }] }
    assert.match(
      verifyPackagedRuntimeIntegrity({ resourcesDir: root, manifest: duplicated }).problems.join('\n'),
      /duplicate manifest path/
    )
  })
})

test('round-trips the manifest through the resources directory', () => {
  withResources((root) => {
    const manifest = buildPackagedRuntimeIntegrity({ resourcesDir: root, platform: 'win32', arch: 'x64' })
    writePackagedRuntimeIntegrity(root, manifest)

    const stored = readPackagedRuntimeIntegrity(root)
    assert.equal(stored.runtimeBuildId, manifest.runtimeBuildId)
    assert.equal(
      readFileSync(join(root, MANIFEST_FILE_NAME), 'utf8').includes('app.asar.unpacked/kun/dist/cli/serve.js'),
      true
    )
    assert.equal(verifyPackagedRuntimeIntegrity({ resourcesDir: root, manifest: stored, mode: 'hash' }).ok, true)
  })
})

test('the CLI verifies an installed payload and rejects an incomplete one', () => {
  withResources((root) => {
    const { verifyPackagedRuntimeIntegrityCli } = require('./verify-packaged-runtime-integrity.cjs')
    writePackagedRuntimeIntegrity(
      root,
      buildPackagedRuntimeIntegrity({ resourcesDir: root, platform: 'win32', arch: 'x64' })
    )

    assert.equal(verifyPackagedRuntimeIntegrityCli(['--resources', root, '--mode', 'hash']), 0)

    rmSync(join(root, 'app.asar.unpacked/kun/node_modules/alpha/index.js'))
    assert.equal(verifyPackagedRuntimeIntegrityCli(['--resources', root, '--mode', 'hash']), 1)
  })
})

test('the CLI refuses a payload with no manifest', () => {
  withResources((root) => {
    const { verifyPackagedRuntimeIntegrityCli } = require('./verify-packaged-runtime-integrity.cjs')

    assert.throws(
      () => verifyPackagedRuntimeIntegrityCli(['--resources', root]),
      /integrity manifest is missing/u
    )
  })
})
