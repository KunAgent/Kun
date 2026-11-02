'use strict'
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { open, readFile, appendFile, readdir, stat, lstat, realpath, opendir } = require('node:fs/promises')
const { join, resolve, relative, isAbsolute, sep } = require('node:path')
const { constants } = require('node:fs')
const { sameOwnedPath } = require('./smoke-windows-installer-relaunch.cjs')
const { sanitizeDiagnostic } = require('./stage-windows-upgrade-evidence.cjs')
const MAX_PENDING_BYTES = 64 * 1024

async function pendingFingerprint(path) {
  let file
  try {
    file = await open(path, 'r')
    const before = await file.stat({ bigint: true })
    if (!before.isFile() || before.size > BigInt(MAX_PENDING_BYTES)) throw new Error('Pending update exceeds the 64 KiB regular-file limit')
    const bytes = Buffer.alloc(Number(before.size))
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) throw new Error('Pending update changed during bounded read')
      offset += bytesRead
    }
    const after = await file.stat({ bigint: true })
    if (before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs) {
      throw new Error('Pending update changed during fingerprint read')
    }
    return { sha256: createHash('sha256').update(bytes).digest('hex'), size: after.size.toString(),
      identity: [after.dev, after.ino, after.birthtimeNs].map(String).join(':') }
  } catch (error) { if (error.code === 'ENOENT') return null; throw error }
  finally { await file?.close() }
}
function samePending(left, right) {
  return Boolean(left && right && left.sha256 === right.sha256 && left.size === right.size && left.identity === right.identity)
}
function reconcileDenial(stderr) {
  const marker = '[kun-gui updater] could not reconcile a pending installer update:'
  const offset = stderr.indexOf(marker)
  if (offset < 0) return null
  const message = stderr.slice(offset, offset + 4096)
  const code = message.match(/\b(EPERM|EACCES|EBUSY)\b/)?.[1]
  return code && /\bunlink\b/.test(message) && message.includes('pending-update.json')
    ? { code, operation: 'unlink', source: 'released-old-gui-stderr' } : null
}
function captureRestartOutput(child, root, limit = 128 * 1024) {
  const buffers = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
  const truncated = { stdout: false, stderr: false }
  let denied
  let flushed = false
  for (const name of ['stdout', 'stderr']) child[name]?.on('data', chunk => {
    const remaining = Math.max(0, limit - buffers[name].length)
    const bytes = Buffer.from(chunk)
    truncated[name] ||= bytes.length > remaining
    if (remaining) buffers[name] = Buffer.concat([buffers[name], bytes.subarray(0, remaining)])
    if (name === 'stderr' && !denied) {
      const value = reconcileDenial(buffers.stderr.toString('utf8'))
      if (value) denied = { ...value, at: new Date().toISOString() }
    }
  })
  return {
    denial: () => denied,
    flush: async () => {
      if (flushed) return
      flushed = true
      for (const name of ['stdout', 'stderr']) {
        const text = sanitizeDiagnostic(buffers[name].toString('utf8'), '.txt')
        await appendFile(join(root, `gui.${name}.log`), `\n[prepared-restart old GUI ${name}; truncated=${truncated[name]}]\n${text}\n`)
      }
    }
  }
}
function pendingProtectionOption(flags, { source, platform, baselineVersion, scenarios }) {
  if (!flags.has('--require-pending-protection')) return false
  assert.equal(flags.get('--require-pending-protection'), 'true', 'Pending protection accepts only explicit true')
  assert.equal(source, 'pull-request')
  assert.equal(platform, 'win32')
  assert.equal(baselineVersion, '0.4.3')
  assert.deepEqual(scenarios, ['restart-prepared'])
  return true
}
function assertPendingProtection(record) {
  assert.notEqual(record?.status, 'inconclusive', 'Prepared overlap was inconclusive, not an acceptance pass')
  assert.equal(record?.status, 'observed', 'Actual released old GUI startup was not observed')
  assert.ok(record.pendingOriginal, 'No original pending file fingerprint')
  assert.ok(record.reconcileDenied, 'Old GUI did not prove a real denied reconciliation unlink')
  assert.equal(record.pendingRemoval, undefined, 'Old GUI removed pending during extraction')
  assert.equal(record.pendingProtectionFailure, undefined, 'Pending identity or bytes changed during extraction')
  assert.ok(record.retainedSamples > 0, 'No authenticated retained-pending observation')
}
function classifyReconciliation(state, versions, now = Date.now()) {
  if (!state.pending && !state.result && !state.recovery && state.transactions.length === 0 && state.backups.length === 0) {
    return state.finalizeMarker ? 'finalized' : 'awaiting-finalize-evidence'
  }
  const recovery = state.recovery
  const transaction = state.transactions.length === 1 ? state.transactions[0] : null
  const grace = state.pending?.oldVersion === versions.oldVersion && state.pending?.newVersion === versions.newVersion &&
    state.result?.outcome === 'success' && state.result?.transactionState === 'committed' &&
    recovery?.oldVersion === versions.oldVersion && recovery?.installedVersion === versions.newVersion &&
    Number.isInteger(recovery.healthAttempts) && recovery.healthAttempts >= 1 && recovery.healthAttempts < 3 &&
    Date.parse(recovery.nextHealthCheckAt) > now && Date.parse(recovery.nextHealthCheckAt) <= now + 6 * 3600_000 &&
    Date.parse(recovery.backupExpiresAt) > now && Date.parse(recovery.backupExpiresAt) <= now + 7 * 86400_000 &&
    transaction?.Phase === 'committed' && transaction.OldVersion === versions.oldVersion && transaction.NewVersion === versions.newVersion &&
    recovery.backupDir === transaction.BackupRoot && state.result.backupDir === transaction.BackupRoot &&
    state.rollbackPayloadPresent && state.backups.includes(transaction.BackupRoot) &&
    state.result.recoveryEnvironment?.KUN_INSTALLER_TRANSACTION === transaction.path &&
    recovery.recoveryEnvironment?.KUN_INSTALLER_TRANSACTION === transaction.path
  return grace ? 'healthy-runtime-with-valid-recovery-grace' : 'unconfirmed'
}
function parseGuiFinalizationMarker(text, expected, now = Date.now()) {
  if (!expected || !Number.isSafeInteger(expected.pid) || expected.pid <= 0 ||
      !Number.isFinite(Date.parse(expected.createdAt)) || typeof expected.version !== 'string' || !expected.version ||
      !sameOwnedPath(expected.executablePath, expected.executablePath, 'win32')) return null
  for (const entry of text.split(/(?=^\[\d{4}-\d{2}-\d{2}T)/m)) {
    // Logger records end in a newline. A partial final append is not evidence.
    const match = entry.match(/^\[([^\]]+)\] \[INFO\] \[kun-gui updater\] Native update transaction finalized\. - detail: (\{[\s\S]*\})\r?\n$/)
    if (!match) continue
    const at = Date.parse(match[1])
    if (!Number.isFinite(at) || at <= Date.parse(expected.createdAt) || at > now + 1000 ||
        (expected.notAfter && (!Number.isFinite(Date.parse(expected.notAfter)) || at >= Date.parse(expected.notAfter)))) continue
    try {
      const value = JSON.parse(match[2])
      if (value.event === 'native_update_finalized' && value.pid === expected.pid && value.version === expected.version &&
          sameOwnedPath(value.executablePath, expected.executablePath, 'win32')) {
        return { source: 'owned-automatic-gui-log', event: value.event, pid: value.pid, version: value.version, at: match[1] }
      }
    } catch { /* Malformed or truncated records never authorize cleanup success. */ }
  }
  return null
}
async function readBoundedOwnedText(file, maximum, tail = false) {
  let handle
  try {
    const before = await lstat(file)
    if (!before.isFile() || before.isSymbolicLink() || !sameOwnedPath(await realpath(file), resolve(file))) return null
    if (!tail && before.size > maximum) return null
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    const info = await handle.stat()
    if (!info.isFile() || info.dev !== before.dev || info.ino !== before.ino || (!tail && info.size > maximum)) return null
    if (!sameOwnedPath(await realpath(file), resolve(file))) return null
    const start = tail ? Math.max(0, info.size - maximum) : 0
    const bytes = Buffer.alloc(Math.min(info.size, maximum))
    let offset = 0
    while (offset < bytes.length) {
      const part = await handle.read(bytes, offset, bytes.length - offset, start + offset)
      if (!part.bytesRead) break
      offset += part.bytesRead
    }
    let text = bytes.subarray(0, offset).toString('utf8')
    if (start > 0) text = text.includes('\n') ? text.slice(text.indexOf('\n') + 1) : ''
    return text
  } catch (error) { if (error.code === 'ENOENT') return null; throw error }
  finally { await handle?.close() }
}
async function readGuiFinalizationMarker(userData, expected) {
  if (!expected?.ownerRoot) return null
  const owner = await readBoundedOwnedText(join(userData, '.upgrade-acceptance-owner'), 4096)
  if (!owner || !sameOwnedPath(owner.trim(), expected.ownerRoot)) return null
  const directory = join(userData, 'logs')
  try {
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink() || !sameOwnedPath(await realpath(directory), resolve(directory))) return null
    const files = []
    let entries = 0
    for await (const entry of await opendir(directory)) {
      if (++entries > 64) return null
      if (entry.isFile() && /^kun-\d{4}-\d{2}-\d{2}\.log$/.test(entry.name)) files.push(entry.name)
    }
    for (const name of files.sort().reverse().slice(0, 4)) {
      const text = await readBoundedOwnedText(join(directory, name), 512 * 1024, true)
      const marker = text === null ? null : parseGuiFinalizationMarker(text, expected)
      if (marker) return marker
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  return null
}
async function readReconciliationState(userData, recoveryRoot, installerLog, expectedAutomaticGui) {
  const json = async path => {
    try { return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/u, '')) }
    catch (error) {
      if (error.code === 'ENOENT') return null
      if (error instanceof SyntaxError) throw new Error('Malformed reconciliation JSON; retaining recovery records')
      throw error
    }
  }
  const pending = await json(join(userData, 'pending-update.json'))
  const result = await json(join(userData, 'pending-update-result.json'))
  const recovery = await json(join(userData, 'gui-update-recovery.json'))
  const transactions = []
  const backups = []
  for (const name of await readdir(recoveryRoot)) {
    if (name.endsWith('-update.json')) transactions.push({ ...await json(join(recoveryRoot, name)), path: join(recoveryRoot, name) })
    if (/^update-backup-\d+$/.test(name) && (await stat(join(recoveryRoot, name))).isDirectory()) backups.push(join(recoveryRoot, name))
  }
  let rollbackPayloadPresent = false
  if (transactions.length === 1 && backups.includes(transactions[0].BackupRoot)) {
    const transaction = transactions[0]
    const inside = path => {
      if (typeof path !== 'string') return false
      const member = relative(resolve(transaction.BackupRoot), resolve(path))
      return member && member !== '..' && !member.startsWith('..' + sep) && !isAbsolute(member)
    }
    const payload = [transaction.RecoveryExecutable, transaction.RecoveryAppAsar]
    if (payload.every(inside)) rollbackPayloadPresent = (await Promise.all(payload.map(path => stat(path).then(info => info.isFile()).catch(() => false)))).every(Boolean)
  }
  // Read only the owned diagnostic log. No helper invocation or record mutation.
  const log = await readBoundedOwnedText(installerLog, 512 * 1024, true) || ''
  const guiFinalizeMarker = await readGuiFinalizationMarker(userData, expectedAutomaticGui)
  return { pending, result, recovery, transactions, backups, rollbackPayloadPresent,
    finalizeMarker: log.includes('SUCCESS action=FinalizeUpdateTransaction') || Boolean(guiFinalizeMarker), guiFinalizeMarker }
}
function reconciliationSummary(state, classification) {
  return { classification, pendingPresent: Boolean(state.pending), resultPresent: Boolean(state.result),
    recoveryPresent: Boolean(state.recovery), transactionPhases: state.transactions.map(value => value.Phase),
    backupCount: state.backups.length, rollbackPayloadPresent: state.rollbackPayloadPresent, finalizeMarker: state.finalizeMarker, guiFinalizeMarker: state.guiFinalizeMarker,
    healthAttempts: state.recovery?.healthAttempts, nextHealthCheckAt: state.recovery?.nextHealthCheckAt,
    backupExpiresAt: state.recovery?.backupExpiresAt }
}
module.exports = { pendingFingerprint, samePending, reconcileDenial, captureRestartOutput, pendingProtectionOption,
  assertPendingProtection, classifyReconciliation, parseGuiFinalizationMarker, readGuiFinalizationMarker, readReconciliationState, reconciliationSummary }
