'use strict'

const assert = require('node:assert/strict')
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const { patchInstalledModule, patchSource } = require('./patch-babel-glob-interop.cjs')

const original = 'var _glob = _interopRequireDefault(require("glob"));'
const fixture = `${original}\nmodule.exports = _glob.default.hasMagic('src/*') && _glob.default.sync('src/*');\n`

test('patches glob 14 namespace interop and preserves the plugin API', () => {
  const patched = patchSource(fixture)
  const glob = { __esModule: true, hasMagic: (pattern) => pattern.includes('*'), sync: () => ['src/a'] }
  const context = { module: { exports: null }, require: (name) => {
    assert.equal(name, 'glob')
    return glob
  } }
  vm.runInNewContext(patched, context)
  assert.deepEqual(context.module.exports, ['src/a'])
  assert.equal(patchSource(patched), patched)
})

test('fails closed if the upstream source changes or contains duplicate anchors', () => {
  assert.throws(() => patchSource('module.exports = {}'), /Unexpected/)
  assert.throws(() => patchSource(`${original}\n${original}`), /Unexpected/)
})

test('patches the pinned installed package and rejects unexpected versions', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'kun-babel-glob-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const plugin = join(root, 'node_modules', 'babel-plugin-module-resolver')
  const glob = join(root, 'node_modules', 'glob')
  mkdirSync(join(plugin, 'lib'), { recursive: true })
  mkdirSync(glob, { recursive: true })
  writeFileSync(join(plugin, 'package.json'), JSON.stringify({ version: '5.0.2' }))
  writeFileSync(join(glob, 'package.json'), JSON.stringify({ version: '14.0.3' }))
  const entry = join(plugin, 'lib', 'index.js')
  const target = join(plugin, 'lib', 'normalizeOptions.js')
  writeFileSync(entry, '')
  writeFileSync(target, fixture)
  patchInstalledModule(entry)
  assert.equal(readFileSync(target, 'utf8'), patchSource(fixture))
  patchInstalledModule(entry)
  writeFileSync(join(plugin, 'package.json'), JSON.stringify({ version: '5.0.3' }))
  assert.throws(() => patchInstalledModule(entry), /Unexpected module-resolver\/glob versions/)
})
