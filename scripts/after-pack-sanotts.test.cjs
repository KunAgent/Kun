'use strict'

const assert = require('node:assert/strict')
const { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const {
  _internals: { unpackedAppRoot, checkPackedSanottsRuntime }
} = require('./after-pack.cjs')

const HELPERS = { unpackedAppRoot }

function packedResourcesPath(appOutDir, platform) {
  if (platform === 'darwin') return join(appOutDir, 'Kun.app', 'Contents', 'Resources')
  return join(appOutDir, 'resources')
}

function fixture(platform = 'darwin') {
  const root = mkdtempSync(join(tmpdir(), 'kun-after-pack-sanotts-'))
  const appOutDir = join(root, 'out')
  const unpacked = join(packedResourcesPath(appOutDir, platform), 'app.asar.unpacked')
  const workerDir = join(unpacked, 'out', 'main')
  mkdirSync(workerDir, { recursive: true })
  writeFileSync(join(workerDir, 'local-sanotts-worker-entry.js'), 'export {}')
  return { root, appOutDir, unpacked }
}

function context(appOutDir, electronPlatformName = 'darwin', arch = 'arm64') {
  return {
    appOutDir,
    electronPlatformName,
    arch,
    packager: { appInfo: { productFilename: 'Kun' } }
  }
}

test('accepts a packed app that includes the sanoTTS worker', (t) => {
  const value = fixture()
  t.after(() => rmSync(value.root, { recursive: true, force: true }))
  assert.doesNotThrow(() => checkPackedSanottsRuntime(context(value.appOutDir), HELPERS))
})

test('rejects a packed app missing the sanoTTS worker', (t) => {
  const value = fixture()
  t.after(() => rmSync(value.root, { recursive: true, force: true }))
  rmSync(join(value.unpacked, 'out', 'main', 'local-sanotts-worker-entry.js'))
  assert.throws(
    () => checkPackedSanottsRuntime(context(value.appOutDir), HELPERS),
    /Missing sanoTTS speech worker/
  )
})

test('removes leftover Kokoro native packages when they are still packed', (t) => {
  const value = fixture()
  t.after(() => rmSync(value.root, { recursive: true, force: true }))
  const leftover = join(value.unpacked, 'node_modules', 'onnxruntime-node')
  mkdirSync(leftover, { recursive: true })
  writeFileSync(join(leftover, 'package.json'), '{"name":"onnxruntime-node"}')
  checkPackedSanottsRuntime(context(value.appOutDir), HELPERS)
  assert.equal(existsSync(leftover), false)
})
