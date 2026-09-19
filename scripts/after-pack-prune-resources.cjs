'use strict'

const { existsSync, readdirSync, rmSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const TESSERACT_NODE_LSTM_ALIASES = new Map([
  ['tesseract-core.js', './tesseract-core-lstm'],
  ['tesseract-core-simd.js', './tesseract-core-simd-lstm'],
  ['tesseract-core-relaxedsimd.js', './tesseract-core-relaxedsimd-lstm']
])
const TESSERACT_LSTM_CORE_FILES = new Set([
  'LICENSE',
  'package.json',
  ...TESSERACT_NODE_LSTM_ALIASES.keys(),
  'tesseract-core-lstm.js',
  'tesseract-core-lstm.wasm',
  'tesseract-core-simd-lstm.js',
  'tesseract-core-simd-lstm.wasm',
  'tesseract-core-relaxedsimd-lstm.js',
  'tesseract-core-relaxedsimd-lstm.wasm'
])
const BETTER_SQLITE_BUILD_PATHS = [
  'binding.gyp',
  'deps',
  'src',
  'build/Makefile',
  'build/binding.Makefile',
  'build/better_sqlite3.target.mk',
  'build/config.gypi',
  'build/deps',
  'build/test_extension.target.mk',
  'build/Release/.deps',
  'build/Release/obj',
  'build/Release/obj.target',
  'build/Release/test_extension.node'
]

function prunePackedBetterSqliteBuildFiles(context, helpers) {
  const { unpackedAppRoot } = helpers
  const packageRoot = join(unpackedAppRoot(context), 'node_modules', 'better-sqlite3')
  if (!existsSync(packageRoot)) return
  for (const relativePath of BETTER_SQLITE_BUILD_PATHS) {
    rmSync(join(packageRoot, relativePath), { recursive: true, force: true })
  }
  console.log('[after-pack] Removed better-sqlite3 build sources and intermediates.')
}

function prunePackedTesseractResources(context, helpers) {
  const { unpackedAppRoot } = helpers
  const modules = join(unpackedAppRoot(context), 'node_modules')
  const coreRoot = join(modules, 'tesseract.js-core')
  if (existsSync(coreRoot)) {
    for (const entry of readdirSync(coreRoot)) {
      if (TESSERACT_LSTM_CORE_FILES.has(entry)) continue
      rmSync(join(coreRoot, entry), { recursive: true, force: true })
    }
    // Tesseract.js 7's Node loader asks for the legacy-named JS entry points even
    // when createWorker selected its LSTM-only core. Keep those tiny entry points
    // as aliases while omitting every non-LSTM WASM payload.
    for (const [entry, target] of TESSERACT_NODE_LSTM_ALIASES) {
      writeFileSync(
        join(coreRoot, entry),
        `'use strict'\nmodule.exports = require('${target}')\n`
      )
    }
  }
  rmSync(
    join(modules, '@tesseract.js-data', 'eng', '4.0.0_best_int'),
    { recursive: true, force: true }
  )
  console.log('[after-pack] Kept only Node LSTM Tesseract cores and the configured English model.')
}

module.exports = {
  BETTER_SQLITE_BUILD_PATHS,
  TESSERACT_LSTM_CORE_FILES,
  TESSERACT_NODE_LSTM_ALIASES,
  prunePackedBetterSqliteBuildFiles,
  prunePackedTesseractResources
}
