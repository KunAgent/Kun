'use strict'

const { readFileSync, writeFileSync } = require('node:fs')
const { createRequire } = require('node:module')
const { dirname, join } = require('node:path')

const ORIGINAL = 'var _glob = _interopRequireDefault(require("glob"));'
const PATCHED = 'var _glob = { default: require("glob") };'

function patchSource(source) {
  if (source.includes(PATCHED) && !source.includes(ORIGINAL)) return source
  const first = source.indexOf(ORIGINAL)
  if (first === -1 || source.indexOf(ORIGINAL, first + ORIGINAL.length) !== -1 || source.includes(PATCHED)) {
    throw new Error('Unexpected babel-plugin-module-resolver source; review the glob compatibility patch.')
  }
  return source.replace(ORIGINAL, PATCHED)
}

function patchInstalledModule(entry = require.resolve('babel-plugin-module-resolver')) {
  const packageRoot = dirname(dirname(entry))
  const plugin = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  const glob = createRequire(entry)('glob/package.json')
  if (plugin.version !== '5.0.2' || glob.version !== '14.0.3') {
    throw new Error(`Unexpected module-resolver/glob versions: ${plugin.version}/${glob.version}`)
  }

  // glob 14 is required for the production security fix. Unlike glob 9 it
  // marks its CommonJS namespace as __esModule but has no default export.
  const target = join(dirname(entry), 'normalizeOptions.js')
  const source = readFileSync(target, 'utf8')
  const patched = patchSource(source)
  if (patched !== source) writeFileSync(target, patched)
}

if (require.main === module) patchInstalledModule()

module.exports = { patchInstalledModule, patchSource }
