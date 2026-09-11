'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const {
  prunePackedNodePtyPayload,
  validatePackedNodePtyPayload
} = require('./after-pack-node-pty.cjs')

function normalizePlatform(platform) {
  return platform === 'win' ? 'win32' : platform
}

function normalizeArch(arch) {
  if (arch === 'x64' || arch === 1) return 'x64'
  if (arch === 'arm64' || arch === 3) return 'arm64'
  throw new Error(`Unsupported arch: ${arch}`)
}

function writeFile(path, contents = 'x') {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, contents)
}

function buildFixture(root) {
  const pkg = join(root, 'node_modules', 'node-pty')
  writeFile(join(pkg, 'package.json'), JSON.stringify({ name: 'node-pty', version: '1.1.0' }))
  writeFile(join(pkg, 'lib', 'index.js'))
  writeFile(join(pkg, 'prebuilds', 'darwin-arm64', 'pty.node'))
  writeFile(join(pkg, 'prebuilds', 'darwin-arm64', 'spawn-helper'))
  writeFile(join(pkg, 'prebuilds', 'darwin-x64', 'pty.node'))
  writeFile(join(pkg, 'prebuilds', 'win32-x64', 'winpty.dll'))
  writeFile(join(pkg, 'build', 'Release', 'pty.node'))
  writeFile(join(pkg, 'build', 'Release', 'spawn-helper'))
  writeFile(join(pkg, 'build', 'Makefile'))
  writeFile(join(pkg, 'build', 'Release', 'obj.target', 'pty', 'pty.node.o'))
  writeFile(join(pkg, 'deps', 'winpty', 'README.md'))
  writeFile(join(pkg, 'src', 'unixTerminal.cc'))
  writeFile(join(pkg, 'binding.gyp'))
  return pkg
}

test('prunes foreign node-pty prebuilds and build sources, keeping the target binding', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'kun-node-pty-'))
  try {
    const unpacked = join(tmp, 'app.asar.unpacked')
    const pkg = buildFixture(unpacked)
    const context = { electronPlatformName: 'darwin', arch: 'arm64' }
    const helpers = {
      unpackedAppRoot: () => unpacked,
      normalizePlatform,
      normalizeArch
    }

    prunePackedNodePtyPayload(context, helpers)

    // Target prebuild and runtime JS survive.
    assert.ok(require('node:fs').existsSync(join(pkg, 'prebuilds', 'darwin-arm64', 'pty.node')))
    assert.ok(require('node:fs').existsSync(join(pkg, 'lib', 'index.js')))
    assert.ok(require('node:fs').existsSync(join(pkg, 'build', 'Release', 'pty.node')))
    // Foreign prebuilds and build sources are gone.
    assert.ok(!require('node:fs').existsSync(join(pkg, 'prebuilds', 'darwin-x64')))
    assert.ok(!require('node:fs').existsSync(join(pkg, 'prebuilds', 'win32-x64')))
    assert.ok(!require('node:fs').existsSync(join(pkg, 'deps')))
    assert.ok(!require('node:fs').existsSync(join(pkg, 'src')))
    assert.ok(!require('node:fs').existsSync(join(pkg, 'binding.gyp')))

    validatePackedNodePtyPayload(context, helpers)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('rejects a package whose target node-pty prebuild is missing', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'kun-node-pty-'))
  try {
    const unpacked = join(tmp, 'app.asar.unpacked')
    const pkg = buildFixture(unpacked)
    rmSync(join(pkg, 'prebuilds', 'darwin-arm64'), { recursive: true, force: true })
    const context = { electronPlatformName: 'darwin', arch: 'arm64' }
    const helpers = {
      unpackedAppRoot: () => unpacked,
      normalizePlatform,
      normalizeArch
    }

    prunePackedNodePtyPayload(context, helpers)
    assert.throws(
      () => validatePackedNodePtyPayload(context, helpers),
      /darwin-arm64 prebuild/
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
