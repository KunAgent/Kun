'use strict'

const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const { dirname, join } = require('node:path')
const test = require('node:test')
const {
  isUniversalMachO,
  lipoArchitecture,
  thinPackedUniversalMachOFiles,
  validatePackedMachOArchitecture
} = require('./after-pack-thin-macho.cjs')

function header(...words) {
  const buffer = Buffer.alloc(words.length * 4)
  words.forEach((word, index) => buffer.writeUInt32BE(word, index * 4))
  return buffer
}

function resourcesFixture(t, platform = 'darwin', arch = 'arm64') {
  const resources = mkdtempSync(join(tmpdir(), 'kun-thin-macho-test-'))
  t.after(() => rmSync(resources, { recursive: true, force: true }))
  const context = { electronPlatformName: platform, arch }
  const helpers = {
    packedResourcesDir: () => resources,
    normalizePlatform: (value) => value,
    normalizeArch: (value) => value
  }
  return { resources, context, helpers }
}

function writeFixture(path, contents) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

test('recognizes universal Mach-O headers but not Java classes or thin binaries', (t) => {
  const { resources } = resourcesFixture(t)
  const cases = {
    'fat.dylib': [header(0xcafebabe, 2, 0, 0), true],
    'fat64.node': [header(0xcafebabf, 3, 0, 0), true],
    'Main.class': [header(0xcafebabe, 0x00000034), false],
    'thin.dylib': [Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 0x01]), false],
    'short.bin': [Buffer.from([0xca, 0xfe, 0xba, 0xbe]), false]
  }
  for (const [name, [contents, expected]] of Object.entries(cases)) {
    writeFixture(join(resources, name), contents)
    assert.equal(isUniversalMachO(join(resources, name)), expected, name)
  }
  assert.equal(lipoArchitecture('arm64'), 'arm64')
  assert.equal(lipoArchitecture('x64'), 'x86_64')
})

test('thins every universal Mach-O in the packaged resources to the target slice', (t) => {
  const { resources, context, helpers } = resourcesFixture(t)
  const universal = join(resources, 'app.asar.unpacked', 'node_modules', 'driver', 'lib.dylib')
  const unrelated = join(resources, 'app.asar.unpacked', 'node_modules', 'java', 'Main.class')
  writeFixture(universal, header(0xcafebabe, 2, 0, 0))
  chmodSync(universal, 0o755)
  writeFixture(unrelated, header(0xcafebabe, 0x00000034))
  const calls = []
  const lipo = (args) => {
    calls.push(args)
    if (args[0] === '-archs') return 'x86_64 arm64\n'
    writeFileSync(args[4], 'thin arm64 slice')
    return ''
  }

  assert.throws(
    () => validatePackedMachOArchitecture(context, helpers),
    /Unexpected packaged universal Mach-O files: app.asar.unpacked\/node_modules\/driver\/lib.dylib/
  )
  thinPackedUniversalMachOFiles(context, { ...helpers, lipo })

  assert.deepEqual(calls, [
    ['-archs', universal],
    [universal, '-thin', 'arm64', '-output', `${universal}.thin-arm64`]
  ])
  assert.equal(readFileSync(universal, 'utf8'), 'thin arm64 slice')
  assert.equal(statSync(universal).mode & 0o777, 0o755)
  assert.equal(existsSync(`${universal}.thin-arm64`), false)
  assert.deepEqual(readFileSync(unrelated), header(0xcafebabe, 0x00000034))
  assert.doesNotThrow(() => validatePackedMachOArchitecture(context, helpers))
})

test('fails closed when a universal Mach-O lacks the target slice', (t) => {
  const { resources, context, helpers } = resourcesFixture(t, 'darwin', 'x64')
  writeFixture(join(resources, 'lib.dylib'), header(0xcafebabe, 2, 0, 0))
  const lipo = (args) => (args[0] === '-archs' ? 'arm64 arm64e\n' : assert.fail('must not thin'))
  assert.throws(
    () => thinPackedUniversalMachOFiles(context, { ...helpers, lipo }),
    /Universal Mach-O has no x86_64 slice \(arm64, arm64e\)/
  )
})

test('leaves non-macOS packages untouched', (t) => {
  for (const platform of ['win32', 'linux']) {
    const { resources, context, helpers } = resourcesFixture(t, platform, 'x64')
    const universal = join(resources, 'lib.dylib')
    writeFixture(universal, header(0xcafebabe, 2, 0, 0))
    const lipo = () => assert.fail('lipo must not run for non-macOS packages')
    thinPackedUniversalMachOFiles(context, { ...helpers, lipo })
    assert.doesNotThrow(() => validatePackedMachOArchitecture(context, helpers))
    assert.deepEqual(readFileSync(universal), header(0xcafebabe, 2, 0, 0))
  }
})

test('extracts a real slice with its embedded code signature intact', {
  skip: process.platform !== 'darwin' && 'lipo and codesign are macOS tools'
}, (t) => {
  // /usr/bin/true ships as a signed x86_64 + arm64e universal binary.
  const { resources, context, helpers } = resourcesFixture(t, 'darwin', 'x64')
  const binary = join(resources, 'app.asar.unpacked', 'bin', 'true')
  mkdirSync(dirname(binary), { recursive: true })
  copyFileSync('/usr/bin/true', binary)
  thinPackedUniversalMachOFiles(context, helpers)
  assert.equal(execFileSync('lipo', ['-archs', binary], { encoding: 'utf8' }).trim(), 'x86_64')
  assert.doesNotThrow(() => execFileSync('codesign', ['--verify', binary], { stdio: 'pipe' }))
  assert.doesNotThrow(() => validatePackedMachOArchitecture(context, helpers))
})
