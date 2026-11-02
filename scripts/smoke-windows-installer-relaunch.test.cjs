'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const { readFile } = require('node:fs/promises')
const { join } = require('node:path')
const { sameOwnedPath, sameAutomaticGui, runtimeProbeEndpoint, probeAutomaticRuntime, waitForAutomaticReady } = require('./smoke-windows-installer-relaunch.cjs')

test('Windows manager ownership allows case/normalization equivalence but never a prefix, relative path or another scenario', () => {
  const expected = 'C:\\Users\\runneradmin\\AppData\\Roaming\\kun-gui-upgrade-normal-AbC\\runtime-data'
  assert.equal(sameOwnedPath(expected.toLowerCase(), expected, 'win32'), true)
  assert.equal(sameOwnedPath(expected + '\\.', expected, 'win32'), true)
  for (const value of [expected + '-other', expected + '\\child', 'runtime-data', 'C:runtime-data',
    expected.replace('normal-AbC', 'normal-DEF'), undefined]) assert.equal(sameOwnedPath(value, expected, 'win32'), false)
  assert.equal(sameOwnedPath('/fixture/A', '/fixture/a', 'linux'), false)
})
const gui = { pid: 123, executablePath: 'C:\\fixture\\Kun.exe', createdAt: '2026-11-02T13:21:33.1234560Z', mainWindowHandle: 99 }
const discovery = { pid: 456, instanceId: 'runtime-instance', buildId: 'candidate-build', serviceVersion: '0.4.4',
  startedAt: '2026-11-02T13:21:36.000Z', baseUrl: 'http://127.0.0.1:18899', runtimeToken: 'private-token' }
const expected = { oldRuntimePid: 55, version: '0.4.4', guiCreatedAt: gui.createdAt, dataDir: 'C:\\fixture\\runtime-data' }
function fetchFixture(change = {}) {
  const calls = []
  const fetch = async (url, options) => {
    calls.push({ url, options })
    return { ok: true, json: async () => url.endsWith('/health') ? { status: 'ok', service: 'kun', mode: 'serve' }
      : { pid: discovery.pid, instanceId: discovery.instanceId, buildId: discovery.buildId,
        startedAt: discovery.startedAt, dataDir: expected.dataDir.toLowerCase(), ...change } }
  }
  return { calls, fetch }
}
test('automatic readiness verifies fresh authenticated Runtime identity, not merely a live port or early GUI window', async () => {
  const fixture = fetchFixture()
  const ready = await probeAutomaticRuntime(discovery, expected, fixture.fetch)
  assert.equal(ready.identityAuthenticated, true)
  assert.equal(ready.pid, discovery.pid)
  assert.ok(!JSON.stringify(ready).includes('private-token'))
  assert.equal(fixture.calls.length, 2)
  assert.ok(fixture.calls.every(call => call.options.redirect === 'error'))
  assert.ok(fixture.calls.every(call => call.options.headers.authorization === 'Bearer private-token'))
  for (const change of [{ pid: 999 }, { instanceId: 'unrelated' }, { buildId: 'old' },
    { startedAt: gui.createdAt }, { dataDir: 'C:\\other\\runtime-data' }]) {
    assert.equal(await probeAutomaticRuntime(discovery, expected, fetchFixture(change).fetch), null)
  }
  for (const change of [{ serviceVersion: '0.4.3' }, { pid: expected.oldRuntimePid },
    { startedAt: '2026-11-02T13:00:00Z' }, { runtimeToken: '' }, { baseUrl: 'https://remote.example' }]) {
    assert.equal(await probeAutomaticRuntime({ ...discovery, ...change }, expected, fixture.fetch), null)
  }
})
test('runtime credentials never go to a non-loopback or credential-bearing discovery URL', () => {
  for (const baseUrl of ['https://127.0.0.1:18899', 'http://example.com', 'http://127.0.0.1:18899/path',
    'http://user:password@127.0.0.1:18899', 'http://127.0.0.1:18899?token=secret']) {
    assert.equal(runtimeProbeEndpoint({ ...discovery, baseUrl }), null)
  }
})
test('automatic first launch remains untouched while Runtime starts and normal updater finalization is pending', async () => {
  const sequence = []
  let sample = 0
  const ready = await waitForAutomaticReady({ gui, timeout: 1000, requireFinalized: true,
    readGui: async () => gui,
    readRuntime: async () => { sequence.push(`runtime-${sample}`); return sample > 0 ? { healthy: true } : null },
    readReconciliation: async () => { sequence.push(`reconcile-${sample}`); return sample > 1 ? 'finalized' : 'healthy-runtime-with-valid-recovery-grace' },
    poll: async operation => {
      for (sample = 0; sample < 3; sample++) {
        const result = await operation()
        if (result) return result
      }
      throw new Error('Timed out')
    }
  })
  assert.deepEqual(sequence, ['runtime-0', 'runtime-1', 'reconcile-1', 'runtime-2', 'reconcile-2'])
  assert.equal(ready.reconciliation, 'finalized')
  assert.equal(ready.beforeHarnessStop, true)
})
test('GUI PID reuse or exit cannot be accepted, while temporary window replacement is allowed to settle', async () => {
  assert.equal(sameAutomaticGui(gui, { ...gui, createdAt: '2026-11-02T13:30:00.0000000Z' }), false)
  assert.equal(sameAutomaticGui(gui, { ...gui, executablePath: 'C:\\other\\Kun.exe' }), false)
  let attempts = 0
  const ready = await waitForAutomaticReady({ gui, timeout: 1000,
    readGui: async () => ++attempts === 1 ? { ...gui, mainWindowHandle: 0 } : gui,
    readRuntime: async () => ({ healthy: true }),
    poll: async operation => { assert.equal(await operation(), undefined); return operation() } })
  assert.ok(ready.runtime.healthy)
  await assert.rejects(waitForAutomaticReady({ gui, timeout: 1000, readGui: async () => null,
    poll: operation => operation() }), /exited or its process identity changed/)
})
test('strict native driver waits before inspection stop and keeps cleanup ownership exact', async () => {
  const script = await readFile(join(__dirname, 'smoke-gui-upgrade.cjs'), 'utf8')
  const ready = script.indexOf('record.automaticReady = await waitForAutomaticReady')
  const inspect = script.indexOf("journal.phase('inspection_started')")
  const stop = script.indexOf('await stopInstalledGui(executable)', inspect)
  assert.ok(ready > 0 && inspect > ready && stop > inspect)
  assert.match(script, /requireFinalized: input\.requirePendingProtection/)
  assert.match(script, /assert\.ok\(sameOwnedPath\(manager\.dataDir, dataDir\)/)
})
