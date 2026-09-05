'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { createRequire } = require('node:module')
const vm = require('node:vm')
const test = require('node:test')
const { patchSource } = require('./patch-electron-builder-keychain.cjs')

const signingFile = require.resolve('app-builder-lib/out/codeSign/macCodeSign.js')

function loadSigningHelper(calls) {
  const libraryRequire = createRequire(signingFile)
  const exports = {}
  let keychainPassword
  const exec = async (command, input) => {
    assert.equal(command, '/usr/bin/security')
    const args = Array.from(input)
    calls.push(args)
    if (args[0] === 'list-keychains') return '"/tmp/test-login.keychain"\n'
    if (args[0] === 'create-keychain') keychainPassword = args[args.indexOf('-p') + 1]
    if (args[0] === 'unlock-keychain') {
      assert.equal(args[args.indexOf('-p') + 1], keychainPassword)
    }
    if (args[0] === 'set-key-partition-list') {
      assert.equal(args[args.indexOf('-k') + 1], keychainPassword,
        'security set-key-partition-list must authenticate with the keychain password')
    }
    return ''
  }
  vm.runInNewContext(readFileSync(signingFile, 'utf8'), {
    exports,
    // Skip electron-builder's unrelated root-certificate keychain bootstrap.
    process: { ...process, env: { ...process.env, TRAVIS: 'true' } },
    require: (name) => {
      if (name === 'builder-util') return { ...libraryRequire(name), exec }
      if (name === './codesign') return { importCertificate: async (file) => file }
      return libraryRequire(name)
    }
  }, { filename: signingFile })
  return exports.createKeychain
}

for (const withInstaller of [false, true]) {
  test(`installed signing helper keeps certificate and keychain passwords separate (installer=${withInstaller})`, async () => {
    const calls = []
    const createKeychain = loadSigningHelper(calls)
    const options = {
      tmpDir: {},
      currentDir: '/tmp/kun-signing-test',
      cscLink: '/tmp/application.p12',
      cscKeyPassword: 'test-application-password',
      ...(withInstaller ? {
        cscILink: '/tmp/installer.p12',
        cscIKeyPassword: 'test-installer-password'
      } : {})
    }
    const result = await createKeychain(options)
    const imports = calls.filter(([command]) => command === 'import')
    const partitions = calls.filter(([command]) => command === 'set-key-partition-list')
    assert.deepEqual(imports.map(args => args[args.indexOf('-P') + 1]),
      withInstaller ? [options.cscKeyPassword, options.cscIKeyPassword] : [options.cscKeyPassword])
    assert.equal(partitions.length, imports.length)
    for (const args of partitions) {
      assert.equal(args.at(-1), result.keychainFile)
      assert.notEqual(args[args.indexOf('-k') + 1], options.cscKeyPassword)
    }
  })
}

test('keychain compatibility patch is idempotent and rejects unknown source', () => {
  const source = readFileSync(signingFile, 'utf8')
  const patched = patchSource(source)
  assert.equal(patchSource(patched), patched)
  assert.throws(() => patchSource('unexpected dependency implementation'), /Unexpected electron-builder/)
})
