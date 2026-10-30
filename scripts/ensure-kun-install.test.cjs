const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { runInNewContext } = require('node:vm')
const test = require('node:test')

const source = readFileSync(path.join(__dirname, 'ensure-kun-install.cjs'), 'utf8')
function run({ installed = '1.2.3', locked = '1.2.3', declared = 'file:protocol.tgz',
  lockDeclared = declared, missing = '', corrupt = '', status = 0, legacy = false } = {}) {
  const calls = [], removed = []
  const files = {
    'kun/package.json': { dependencies: { '@kun/remote-protocol': declared } },
    'kun/package-lock.json': { packages: {
      '': { dependencies: { '@kun/remote-protocol': lockDeclared } },
      'node_modules/@kun/remote-protocol': { version: locked }
    } },
    'kun/node_modules/@kun/remote-protocol/package.json': { version: installed }
  }
  if (legacy) files['kun/package-lock.json'] = { dependencies: { '@kun/remote-protocol': { version: locked } } }
  runInNewContext(source, {
    require(name) {
      if (name === 'node:fs') return {
        existsSync: (file) => file !== missing,
        readFileSync: (file) => file === corrupt ? '{broken' : JSON.stringify(files[file]),
        rmSync: (file) => removed.push(file)
      }
      if (name === 'node:child_process') return { spawnSync(command, args) {
        calls.push({ command, args: Array.from(args) }); return { status }
      } }
      return require(name)
    },
    process: { platform: 'linux', env: {}, exit(code) { throw new Error('exit:' + code) } }
  }, { filename: 'ensure-kun-install.cjs' })
  return { calls, removed }
}

test('keeps a complete protocol installation matching the runtime lock without reinstalling', () => {
  const result = run()
  assert.deepEqual(result.calls, [])
  assert.deepEqual(result.removed, ['kun/node_modules/better-sqlite3'])
})

test('reinstalls a stale protocol even when every required dependency path exists', () => {
  assert.deepEqual(run({ installed: '1.2.2' }).calls, [{ command: 'npm', args: ['--prefix', 'kun', 'ci'] }])
  // Version expectations come from the lock, never a hardcoded release.
  assert.deepEqual(run({ installed: '9.0.1', locked: '9.0.1' }).calls, [])
})

test('retains the install path for absent protocol, lock or other required runtime dependencies', () => {
  for (const missing of ['kun/node_modules/@kun/remote-protocol/package.json', 'kun/package-lock.json', 'kun/node_modules/zod/package.json']) {
    assert.equal(run({ missing }).calls.length, 1, missing)
  }
})

test('does not trust corrupt or legacy metadata or a declaration differing from the lock', () => {
  for (const corrupt of ['kun/package.json', 'kun/package-lock.json', 'kun/node_modules/@kun/remote-protocol/package.json']) {
    assert.equal(run({ corrupt }).calls.length, 1, corrupt)
  }
  assert.equal(run({ legacy: true }).calls.length, 1)
  assert.equal(run({ locked: null }).calls.length, 1)
  assert.equal(run({ lockDeclared: 'file:older-protocol.tgz' }).calls.length, 1)
})

test('propagates npm ci failure rather than continuing with a stale protocol', () => {
  assert.throws(() => run({ installed: 'old', status: 7 }), /exit:7/)
})
