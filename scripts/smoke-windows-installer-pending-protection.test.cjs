'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const { mkdtemp, writeFile, readFile, rm, rename, realpath } = require('node:fs/promises')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { EventEmitter } = require('node:events')
const { pendingFingerprint, samePending, reconcileDenial, captureRestartOutput, pendingProtectionOption,
  assertPendingProtection, classifyReconciliation } = require('./smoke-windows-installer-pending-protection.cjs')
const { observePreparedRestart } = require('./smoke-windows-installer-prepared-restart.cjs')

async function temporary(t) {
  // The owned-path reader rejects aliases; macOS /var is a symlink to /private/var.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'kun-pending-protection-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}
test('fingerprint detects mutation, removal and same-byte replacement without altering the pending file', async t => {
  const root = await temporary(t)
  const file = join(root, 'pending-update.json')
  await writeFile(file, '{"oldVersion":"0.4.3"}')
  const original = await pendingFingerprint(file)
  assert.ok(samePending(original, await pendingFingerprint(file)))
  await writeFile(file, '{"oldVersion":"0.4.2"}')
  assert.equal(samePending(original, await pendingFingerprint(file)), false)
  await rename(file, join(root, 'preserved-original'))
  await writeFile(file, '{"oldVersion":"0.4.3"}')
  const replacement = await pendingFingerprint(file)
  assert.equal(original.sha256, replacement.sha256)
  assert.equal(samePending(original, replacement), false)
  await rm(file)
  assert.equal(await pendingFingerprint(file), null)
})
test('pending fingerprint rejects oversized input before reading it and accepts the exact 64 KiB bound', async t => {
  const root = await temporary(t)
  const file = join(root, 'pending-update.json')
  await writeFile(file, 'x'.repeat(64 * 1024))
  assert.equal((await pendingFingerprint(file)).size, String(64 * 1024))
  await writeFile(file, 'x'.repeat(64 * 1024 + 1))
  await assert.rejects(pendingFingerprint(file), /64 KiB regular-file limit/)
  assert.equal((await readFile(file)).length, 64 * 1024 + 1)
})
const denial = "[kun-gui updater] could not reconcile a pending installer update: Error: EPERM: operation not permitted, unlink 'C:\\owned\\pending-update.json'"
test('real old-GUI reconciliation denial is classified without copying raw error text into reports', () => {
  assert.deepEqual(reconcileDenial(denial), { code: 'EPERM', operation: 'unlink', source: 'released-old-gui-stderr' })
  for (const value of ['EPERM', denial.replace('unlink', 'open'), denial.replace('pending-update.json', 'unrelated.json'),
    denial.replace('EPERM', 'ENOENT'), denial.replace('could not reconcile', 'could not launch')]) assert.equal(reconcileDenial(value), null)
})
test('old output is drained, bounded, sanitized and appended only to existing owned log names', async t => {
  const root = await temporary(t)
  const child = { stdout: new EventEmitter(), stderr: new EventEmitter() }
  const capture = captureRestartOutput(child, root, 1024)
  child.stderr.emit('data', Buffer.from(denial.slice(0, 40)))
  child.stderr.emit('data', Buffer.from(denial.slice(40) + '\nHealthToken="TOP SECRET"\n'))
  child.stdout.emit('data', Buffer.from('x'.repeat(2048)))
  assert.equal(capture.denial().code, 'EPERM')
  await capture.flush()
  await capture.flush()
  const error = await readFile(join(root, 'gui.stderr.log'), 'utf8')
  assert.ok(!error.includes('TOP SECRET'))
  assert.ok(error.includes('pending-update.json'))
  assert.equal((error.match(/prepared-restart old GUI stderr/g) || []).length, 1)
  assert.ok((await readFile(join(root, 'gui.stdout.log'), 'utf8')).includes('truncated=true'))
})
test('strict protection acceptance is explicit and cannot accidentally change released control expectations', () => {
  const context = { source: 'pull-request', platform: 'win32', baselineVersion: '0.4.3', scenarios: ['restart-prepared'] }
  assert.equal(pendingProtectionOption(new Map(), { ...context, source: 'published-release' }), false)
  const flags = new Map([['--require-pending-protection', 'true']])
  assert.equal(pendingProtectionOption(flags, context), true)
  for (const change of [{ source: 'published-release' }, { platform: 'darwin' }, { scenarios: ['normal'] }]) {
    assert.throws(() => pendingProtectionOption(flags, { ...context, ...change }))
  }
})
test('observed startup alone or an unchanged file without a real denied unlink is not strict acceptance', () => {
  const valid = { status: 'observed', pendingOriginal: { sha256: 'a', identity: 'b', size: '3' },
    reconcileDenied: { code: 'EPERM' }, retainedSamples: 2 }
  assert.doesNotThrow(() => assertPendingProtection(valid))
  for (const change of [{ status: 'inconclusive' }, { pendingOriginal: undefined }, { reconcileDenied: undefined },
    { pendingRemoval: {} }, { pendingProtectionFailure: {} }, { retainedSamples: 0 }]) {
    assert.throws(() => assertPendingProtection({ ...valid, ...change }))
  }
})
test('observer records same-file retention and rejects byte changes even while pending remains present', async () => {
  const fingerprint = { sha256: 'original', identity: 'same-file', size: '8' }
  for (const mutated of [false, true]) {
    const base = { oldExited: true, window: true, pendingPresent: true, installerVerified: true,
      pendingFingerprint: fingerprint, summary: { at: 'before' } }
    const samples = [base, base, { ...base, startedOldGui: true, reconcileDenied: { code: 'EPERM' },
      pendingFingerprint: mutated ? { ...fingerprint, sha256: 'changed' } : fingerprint },
    { ...base, window: false, stageStarted: true }]
    let index = 0
    const result = await observePreparedRestart({ now: () => 0, timeoutMs: 1000, stopped: () => false,
      sample: async () => samples[index++], launch: async () => ({ pid: 123 }), pause: async () => {},
      preserve: async () => {}, event: () => {} })
    if (mutated) assert.throws(() => assertPendingProtection(result), /identity or bytes/)
    else assert.doesNotThrow(() => assertPendingProtection(result))
  }
})
test('a removal observed at the final Stage-boundary sample is not hidden by ending observation', async () => {
  const fingerprint = { sha256: 'a', identity: 'same-file', size: '8' }
  const base = { oldExited: true, window: true, pendingPresent: true, installerVerified: true,
    pendingFingerprint: fingerprint, summary: { at: 'before' } }
  const samples = [base, base, { ...base, startedOldGui: true, reconcileDenied: { code: 'EPERM' } },
    { ...base, window: false, stageStarted: true, pendingPresent: false, pendingFingerprint: null }]
  let index = 0
  const result = await observePreparedRestart({ now: () => 0, timeoutMs: 1000, stopped: () => false,
    sample: async () => samples[index++], launch: async () => ({ pid: 123 }), pause: async () => {},
    preserve: async () => {}, event: () => {} })
  assert.equal(result.pendingProtectionFailure.kind, 'pending_missing')
  assert.throws(() => assertPendingProtection(result), /identity or bytes/)
})
const versions = { oldVersion: '0.4.3', newVersion: '0.4.4' }
test('final reconciliation requires confirmed finalization, not merely installed version or an orphaned result', () => {
  const absent = { pending: null, result: null, recovery: null, transactions: [], backups: [], finalizeMarker: true }
  assert.equal(classifyReconciliation(absent, versions), 'finalized')
  assert.equal(classifyReconciliation({ ...absent, finalizeMarker: false }, versions), 'awaiting-finalize-evidence')
  assert.equal(classifyReconciliation({ ...absent, result: { outcome: 'success', transactionState: 'committed' } }, versions), 'unconfirmed')
})
test('degraded-health grace is explicit and requires matching authoritative rollback context and live policy deadlines', () => {
  const now = Date.parse('2026-11-02T12:00:00Z')
  const transaction = { Phase: 'committed', OldVersion: '0.4.3', NewVersion: '0.4.4', BackupRoot: '/owned/backup', path: '/owned/update.json' }
  const environment = { KUN_INSTALLER_TRANSACTION: transaction.path }
  const state = { pending: { oldVersion: '0.4.3', newVersion: '0.4.4' },
    result: { outcome: 'success', transactionState: 'committed', backupDir: transaction.BackupRoot, recoveryEnvironment: environment },
    recovery: { oldVersion: '0.4.3', installedVersion: '0.4.4', healthAttempts: 1,
      nextHealthCheckAt: new Date(now + 3600_000).toISOString(), backupExpiresAt: new Date(now + 86400_000).toISOString(),
      backupDir: transaction.BackupRoot, recoveryEnvironment: environment },
    transactions: [transaction], backups: [transaction.BackupRoot], rollbackPayloadPresent: true }
  assert.equal(classifyReconciliation(state, versions, now), 'healthy-runtime-with-valid-recovery-grace')
  for (const change of [{ pending: null }, { backups: [] }, { rollbackPayloadPresent: false },
    { transactions: [{ ...transaction, Phase: 'prepared' }] },
    { recovery: { ...state.recovery, nextHealthCheckAt: new Date(now - 1).toISOString() } },
    { recovery: { ...state.recovery, healthAttempts: 0 } }]) {
    assert.equal(classifyReconciliation({ ...state, ...change }, versions, now), 'unconfirmed')
  }
})

const { parseGuiFinalizationMarker, readGuiFinalizationMarker, readReconciliationState } = require('./smoke-windows-installer-pending-protection.cjs')
const { mkdir, symlink } = require('node:fs/promises')
const expectedGui = { pid: 123, createdAt: '2026-11-02T13:21:33.0000000Z', version: '0.4.4', executablePath: 'C:\\owned\\Kun.exe' }
function markerLine(change = {}, at = '2026-11-02T13:21:45.000Z') {
  return `[${at}] [INFO] [kun-gui updater] Native update transaction finalized. - detail: ${JSON.stringify({
    event: 'native_update_finalized', pid: expectedGui.pid, version: expectedGui.version,
    executablePath: expectedGui.executablePath, ...change }, null, 2)}\n`
}
test('GUI finalization marker must be fresh, complete and from the original automatic GUI identity', () => {
  const now = Date.parse('2026-11-02T13:22:00Z')
  const good = parseGuiFinalizationMarker(markerLine(), expectedGui, now)
  assert.equal(good.pid, expectedGui.pid)
  assert.equal(good.source, 'owned-automatic-gui-log')
  for (const change of [{ pid: 456 }, { version: '0.4.3' }, { executablePath: 'C:\\other\\Kun.exe' },
    { event: 'already_finalized' }, { pid: '123' }]) {
    assert.equal(parseGuiFinalizationMarker(markerLine(change), expectedGui, now), null)
  }
  for (const text of [markerLine({}, '2026-11-02T13:21:32.000Z'), markerLine({}, '2026-11-02T14:00:00.000Z'),
    markerLine().slice(0, -1), markerLine().slice(0, -8), markerLine().replace('"pid": 123', '"pid": bad'),
    markerLine().replace('[INFO]', '[WARN]')]) assert.equal(parseGuiFinalizationMarker(text, expectedGui, now), null)
  assert.equal(parseGuiFinalizationMarker(markerLine(), { ...expectedGui, notAfter: '2026-11-02T13:21:40.000Z' }, now), null,
    'An inspection-era marker cannot replace the evidence from the original automatic launch')
  assert.ok(parseGuiFinalizationMarker(markerLine({ executablePath: 'c:\\OWNED\\kun.exe' }), expectedGui, now))
})
test('bounded owned-profile reader accepts the automatic GUI marker without installer diagnostic inheritance', async t => {
  const root = await temporary(t)
  const profile = join(root, 'profile')
  const recovery = join(root, 'recovery')
  await mkdir(join(profile, 'logs'), { recursive: true })
  await mkdir(recovery)
  await writeFile(join(profile, '.upgrade-acceptance-owner'), root)
  const expected = { ...expectedGui, ownerRoot: root }
  // Use a fresh timestamp relative to actual test clock for the production reader.
  expected.createdAt = new Date(Date.now() - 5000).toISOString()
  const marker = markerLine({}, new Date(Date.now() - 1000).toISOString())
  await writeFile(join(profile, 'logs', 'kun-2026-11-02.log'), 'x'.repeat(600 * 1024) + '\n' + marker)
  assert.ok(await readGuiFinalizationMarker(profile, expected))
  const state = await readReconciliationState(profile, recovery, join(root, 'missing-installer.log'), expected)
  assert.equal(classifyReconciliation(state, versions), 'finalized')
  assert.equal(state.guiFinalizeMarker.pid, expected.pid)
  assert.equal(await readGuiFinalizationMarker(profile, { ...expected, pid: 456 }), null, 'Later inspection PID cannot authenticate the automatic GUI')
  await writeFile(join(profile, 'pending-update.json'), '{"oldVersion":"0.4.3","newVersion":"0.4.4"}')
  const remaining = await readReconciliationState(profile, recovery, join(root, 'missing-installer.log'), expected)
  assert.equal(remaining.finalizeMarker, true)
  assert.notEqual(classifyReconciliation(remaining, versions), 'finalized', 'A valid marker never overrides residual recovery records')
  await writeFile(join(profile, '.upgrade-acceptance-owner'), join(root, 'wrong-owner'))
  assert.equal(await readGuiFinalizationMarker(profile, expected), null)
})
test('owned log reader rejects log-directory junctions instead of finding a marker in another profile', async t => {
  const root = await temporary(t)
  const profile = join(root, 'profile')
  const outside = join(root, 'outside')
  await mkdir(profile)
  await mkdir(outside)
  await writeFile(join(profile, '.upgrade-acceptance-owner'), root)
  await writeFile(join(outside, 'kun-2026-11-02.log'), markerLine())
  await symlink(outside, join(profile, 'logs'), 'junction')
  assert.equal(await readGuiFinalizationMarker(profile, { ...expectedGui, ownerRoot: root }), null)
})
