'use strict'

const assert = require('node:assert/strict')
const { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const {
  _internals: { normalizeArch, normalizePlatform, prunePackedOnnxRuntimeBinaries, unpackedAppRoot }
} = require('./after-pack.cjs')

/** The helper trio is passed exactly as prunePackedApplicationPayload passes it. */
const HELPERS = { unpackedAppRoot, normalizePlatform, normalizeArch }

const TARGETS = [
  ['darwin', 'arm64'],
  ['darwin', 'x64'],
  ['linux', 'arm64'],
  ['linux', 'x64'],
  ['win32', 'arm64'],
  ['win32', 'x64']
]

/** electron-builder puts Resources inside the bundle on macOS and beside the app elsewhere. */
function packedResourcesPath(appOutDir, platform) {
  if (platform === 'darwin') return join(appOutDir, 'Kun.app', 'Contents', 'Resources')
  return join(appOutDir, 'resources')
}

function fixture(platform = 'darwin', targets = TARGETS) {
  const root = mkdtempSync(join(tmpdir(), 'kun-after-pack-ort-'))
  const appOutDir = join(root, 'out')
  const binRoot = join(
    packedResourcesPath(appOutDir, platform), 'app.asar.unpacked',
    'node_modules', 'onnxruntime-node', 'bin', 'napi-v6'
  )
  for (const [platform, arch] of targets) {
    const archRoot = join(binRoot, platform, arch)
    mkdirSync(archRoot, { recursive: true })
    writeFileSync(join(archRoot, 'onnxruntime_binding.node'), `${platform}-${arch}`)
    writeFileSync(join(archRoot, platform === 'win32' ? 'onnxruntime.dll' : platform === 'darwin' ? 'libonnxruntime.1.22.0.dylib' : 'libonnxruntime.so.1'), 'library')
  }
  const workerDir = join(packedResourcesPath(appOutDir, platform), 'app.asar.unpacked', 'out', 'main')
  mkdirSync(workerDir, { recursive: true })
  writeFileSync(join(workerDir, 'local-kokoro-worker-entry.js'), 'export {}')
  return { root, appOutDir, binRoot }
}

function context(appOutDir, electronPlatformName, arch) {
  return {
    appOutDir,
    electronPlatformName,
    arch,
    packager: { appInfo: { productFilename: 'Kun' } }
  }
}

test('keeps only the packaged platform and arch binary', (t) => {
  const value = fixture()
  t.after(() => rmSync(value.root, { recursive: true, force: true }))

  prunePackedOnnxRuntimeBinaries(context(value.appOutDir, 'darwin', 'arm64'), HELPERS)

  assert.deepEqual(readdirSync(value.binRoot), ['darwin'])
  assert.deepEqual(readdirSync(join(value.binRoot, 'darwin')), ['arm64'])
  assert.ok(existsSync(join(value.binRoot, 'darwin', 'arm64', 'onnxruntime_binding.node')))
})

test('maps electron-builder platform and arch names onto the published layout', (t) => {
  const value = fixture('win32')
  t.after(() => rmSync(value.root, { recursive: true, force: true }))

  // electron-builder reports Windows as 'win' and arch as the numeric enum.
  prunePackedOnnxRuntimeBinaries(context(value.appOutDir, 'win', 1), HELPERS)

  assert.deepEqual(readdirSync(value.binRoot), ['win32'])
  assert.deepEqual(readdirSync(join(value.binRoot, 'win32')), ['x64'])
})

test('fails the pack when the target has no prebuilt binary', (t) => {
  const value = fixture('darwin', [['darwin', 'x64'], ['linux', 'x64']])
  t.after(() => rmSync(value.root, { recursive: true, force: true }))

  assert.throws(
    () => prunePackedOnnxRuntimeBinaries(context(value.appOutDir, 'darwin', 'arm64'), HELPERS),
    /no prebuilt binary for darwin\/arm64/
  )
})

test('does nothing when the dependency is not packaged', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'kun-after-pack-ort-empty-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  assert.doesNotThrow(
    () => prunePackedOnnxRuntimeBinaries(context(join(root, 'out'), 'darwin', 'arm64'), HELPERS)
  )
})


test('rejects a platform directory without its runtime library', (t) => {
  const value = fixture()
  t.after(() => rmSync(value.root, { recursive: true, force: true }))
  rmSync(join(value.binRoot, 'darwin', 'arm64', 'libonnxruntime.1.22.0.dylib'))
  assert.throws(() => prunePackedOnnxRuntimeBinaries(context(value.appOutDir, 'darwin', 'arm64'), HELPERS), /Incomplete ONNX/)
})
