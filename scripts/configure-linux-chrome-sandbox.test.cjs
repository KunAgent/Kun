'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  chromeSandboxPath,
  configureChromeSandbox,
  verifyChromeSandbox
} = require('./configure-linux-chrome-sandbox.cjs')

test('resolves chrome-sandbox beside the unpacked resources directory', () => {
  assert.equal(chromeSandboxPath('/tmp/linux-unpacked/resources'), '/tmp/linux-unpacked/chrome-sandbox')
})

test('configures root ownership and the 4755 SUID mode before verification', () => {
  const calls = []
  const fakeStat = { uid: 0, gid: 0, mode: 0o104755 }
  const result = configureChromeSandbox('/tmp/linux-unpacked/resources', {
    spawnSyncCommand(command, args) {
      calls.push([command, ...args])
      return { status: 0, signal: null, stdout: '', stderr: '' }
    },
    statSyncCommand() {
      return fakeStat
    }
  })
  assert.deepEqual(calls, [
    ['sudo', 'chown', 'root:root', '/tmp/linux-unpacked/chrome-sandbox'],
    ['sudo', 'chmod', '4755', '/tmp/linux-unpacked/chrome-sandbox']
  ])
  assert.equal(result.mode, 0o4755)
})

test('fails closed when SUID setup fails outside an explicitly authorized CI fallback', () => {
  assert.throws(() => configureChromeSandbox('/tmp/linux-unpacked/resources', {
    env: { CI: 'true', KUN_CI_ALLOW_NO_SANDBOX: '0', GITHUB_ENV: '/tmp/github-env' },
    spawnSyncCommand: () => ({ status: 1, signal: null, stdout: '', stderr: 'denied' })
  }), /Failed to configure chrome-sandbox/)
})

test('activates no-sandbox only after SUID setup fails in explicitly authorized CI', () => {
  const writes = []
  const result = configureChromeSandbox('/tmp/linux-unpacked/resources', {
    env: { CI: 'true', KUN_CI_ALLOW_NO_SANDBOX: '1', GITHUB_ENV: '/tmp/github-env' },
    spawnSyncCommand: () => ({ status: 1, signal: null, stdout: '', stderr: 'denied' }),
    appendFileSyncCommand: (...args) => writes.push(args)
  })
  assert.equal(result.fallback, true)
  assert.deepEqual(writes, [['/tmp/github-env', 'KUN_CI_NO_SANDBOX_ACTIVE=1\n', 'utf8']])
})

test('rejects a sandbox without root ownership and SUID 4755', () => {
  assert.throws(
    () => verifyChromeSandbox('/tmp/chrome-sandbox', { uid: 1000, gid: 1000, mode: 0o100755 }),
    /not root:root 4755/
  )
})
