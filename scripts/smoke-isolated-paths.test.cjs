'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const { sameIsolatedDataDirectory, isVerifiedIsolatedKunCommand } = require('./smoke-isolated-paths.cjs')
const expected = 'C:\\Users\\runneradmin\\AppData\\Local\\Temp\\kun-smoke-MixedCase\\home\\.kun\\data'
const canonical = expected.toLowerCase()

test('isolated Windows directory equality handles canonical case and separators only within the same absolute path', () => {
  for (const actual of [canonical, canonical.replace(/\\/g, '/'), canonical + '\\', canonical + '\\.']) {
    assert.equal(sameIsolatedDataDirectory(actual, expected, 'win32'), true, actual)
  }
  for (const actual of [undefined, '', 'data', 'C:data', '\\Users\\runneradmin',
    canonical + '-other', canonical + '\\child', canonical.replace('kun-smoke-mixedcase', 'kun-smoke-other'),
    canonical.replace('c:', 'd:'), canonical + '\\..', canonical + '\n']) {
    assert.equal(sameIsolatedDataDirectory(actual, expected, 'win32'), false, String(actual))
  }
  assert.equal(sameIsolatedDataDirectory('\\\\host\\share\\data', '\\\\HOST\\SHARE\\DATA', 'win32'), true)
  assert.equal(sameIsolatedDataDirectory('\\\\host\\other\\data', '\\\\host\\share\\data', 'win32'), false)
})

test('isolated POSIX directory equality stays case-sensitive and rejects absent or relative authority', () => {
  assert.equal(sameIsolatedDataDirectory('/tmp/Smoke/data/', '/tmp/Smoke/data', 'linux'), true)
  for (const actual of ['/tmp/smoke/data', '/tmp/Smoke/data-other', '/tmp/Smoke/data/child', 'data', '', undefined]) {
    assert.equal(sameIsolatedDataDirectory(actual, '/tmp/Smoke/data', 'linux'), false)
  }
  assert.equal(sameIsolatedDataDirectory('', '', 'linux'), false)
  assert.equal(sameIsolatedDataDirectory('/tmp/smoke', '/tmp/Smoke', 'darwin'), false)
})

test('manager cleanup recognizes case-normalized Windows discovery without accepting another profile or process', () => {
  const input = { platform: 'win32', kind: 'manager', command: '"C:\\Kun\\Electron.exe" "C:\\Kun\\dist\\manager\\manager-entry.js"', expectedDataDir: expected }
  assert.equal(isVerifiedIsolatedKunCommand({ ...input, discoveryDataDir: canonical }), true)
  for (const discoveryDataDir of [undefined, '', canonical + '-other', canonical + '\\child']) {
    assert.equal(isVerifiedIsolatedKunCommand({ ...input, discoveryDataDir }), false)
  }
  for (const command of ['node arbitrary.js', 'node fake-manager-entry.js', 'node manager-entry.js.other']) {
    assert.equal(isVerifiedIsolatedKunCommand({ ...input, command, discoveryDataDir: canonical }), false)
  }
})

test('runtime cleanup requires one exact bounded data-dir argument even with spaces or Windows case differences', () => {
  const input = { platform: 'win32', kind: 'runtime', expectedDataDir: expected }
  for (const argument of [`--data-dir "${canonical}"`, `--data-dir=${canonical}`, `--data-dir ${canonical} --port 1234`]) {
    assert.equal(isVerifiedIsolatedKunCommand({ ...input, command: `"C:\\Kun\\serve-entry.js" serve ${argument}` }), true)
  }
  const spaced = 'C:\\Users\\test user\\smoke with spaces\\data'
  for (const argument of [`"${spaced.toLowerCase()}"`, spaced.toLowerCase()]) {
    assert.equal(isVerifiedIsolatedKunCommand({ ...input, expectedDataDir: spaced,
      command: `node C:\\Kun\\serve-entry.js serve --data-dir ${argument} --port 1234` }), true)
  }
  for (const tail of [`--data-dir ${canonical}-other`, `--data-dir ${canonical}\\child`,
    `--data-dir "${canonical} other"`, `--data-dir ${canonical} --data-dir C:\\foreign`,
    `--other ${canonical}`, `--data-dir C:\\foreign --comment ${canonical}`, `--data-dir ${canonical}Suffix`]) {
    assert.equal(isVerifiedIsolatedKunCommand({ ...input, command: `node C:\\Kun\\serve-entry.js serve ${tail}` }), false, tail)
  }
  assert.equal(isVerifiedIsolatedKunCommand({ ...input, command: `node serve-entry.js.other --data-dir ${canonical}` }), false)
  assert.equal(isVerifiedIsolatedKunCommand({ ...input, discoveryDataDir: 'C:\\foreign', command: `node serve-entry.js --data-dir ${canonical}` }), false)
  assert.equal(isVerifiedIsolatedKunCommand({ platform: 'linux', kind: 'runtime', expectedDataDir: '/tmp/smoke with spaces/data',
    command: 'node /app/serve-entry.js serve --data-dir /tmp/smoke with spaces/data --port 1234' }), true)
})
