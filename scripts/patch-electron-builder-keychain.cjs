'use strict'

const { readFileSync, writeFileSync } = require('node:fs')

// Carry the upstream v26 fix until it is included in a published release:
// https://github.com/electron-userland/electron-builder/pull/10172
// The P12 import password and the temporary keychain password are distinct.
const replacements = [
  [
    'return await importCerts(keychainFile, certPaths, cscPasswords);',
    'return await importCerts(keychainFile, certPaths, cscPasswords, keychainPassword);'
  ],
  [
    'async function importCerts(keychainFile, paths, keyPasswords) {',
    'async function importCerts(keychainFile, paths, keyPasswords, keychainPassword) {'
  ],
  [
    '["set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", password, keychainFile]',
    '["set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", keychainPassword, keychainFile]'
  ]
]

function patchSource(source) {
  if (replacements.every(([before, after]) => !source.includes(before) && source.includes(after))) {
    return source
  }
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2 || source.includes(after)) {
      throw new Error('Unexpected electron-builder keychain implementation; review the upstream password fix before packaging.')
    }
  }
  return replacements.reduce((result, [before, after]) => result.replace(before, after), source)
}

function patchElectronBuilderKeychain() {
  const file = require.resolve('app-builder-lib/out/codeSign/macCodeSign.js')
  const source = readFileSync(file, 'utf8')
  const patched = patchSource(source)
  if (patched !== source) {
    writeFileSync(file, patched)
    console.log('[postinstall] Applied upstream electron-builder keychain password fix.')
  }
}

if (require.main === module) patchElectronBuilderKeychain()

module.exports = { patchSource, patchElectronBuilderKeychain }
