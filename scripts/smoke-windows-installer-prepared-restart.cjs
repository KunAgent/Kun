'use strict'

const { spawn, execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { readFile, readdir, writeFile } = require('node:fs/promises')
const { join, win32 } = require('node:path')
const { digest } = require('./gui-upgrade-feed.cjs')
const { selectOwnedWindowsProcesses } = require('./smoke-windows-installer-cross-version.cjs')
const execute = promisify(execFile)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const missing = error => { if (error.code === 'ENOENT') return null; throw error }

function parseWindowsJson(text) {
  return JSON.parse(text.replace(/^\uFEFF/u, ''))
}

// The installer rounds StartTime down to microseconds before writing its
// win32-v1 identity. Preserve those six digits in CIM rather than accepting
// PowerShell's default millisecond-only /Date(...)/ JSON representation.
function creationIdentity(value) {
  const match = typeof value === 'string' && value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{6})0?Z$/)
  return match && Number.isFinite(Date.parse(value)) ? `win32-v1:${match[1]}.${match[2]}0Z` : null
}

function selectTransactionInstaller(rawTransaction, rows, expected) {
  let transaction
  try { transaction = parseWindowsJson(rawTransaction) } catch { return null }
  if (!transaction || typeof transaction !== 'object' || transaction.Phase !== 'prepared' || transaction.OldVersion !== '0.4.3' ||
      transaction.NewVersion !== expected.newVersion || !Number.isSafeInteger(transaction.InstallerPid) ||
      transaction.InstallerPid <= 0 || typeof transaction.Source !== 'string' ||
      win32.normalize(transaction.Source).toLowerCase() !== win32.dirname(expected.executable).toLowerCase()) return null
  const identity = typeof transaction.InstallerProcessIdentity === 'string' &&
    creationIdentity(transaction.InstallerProcessIdentity.replace(/^win32-v1:/, ''))
  if (!identity || transaction.InstallerProcessIdentity !== identity) return null
  return rows.find(row => row.ProcessId === transaction.InstallerPid &&
    creationIdentity(row.CreationDate) === identity && expected.verifiedInstallerPaths.some(path =>
      win32.normalize(path).toLowerCase() === win32.normalize(String(row.ExecutablePath)).toLowerCase())) || null
}

function createPreparedOwnerVerifier(expected) {
  let authenticatedPreparedTransaction
  return (currentRawTransaction, rows, afterLaunch = false) => {
    // Cached evidence can only establish continuity after the deliberate launch,
    // never authorize a new launch after the prepared journal has disappeared.
    const raw = afterLaunch ? authenticatedPreparedTransaction : currentRawTransaction
    const installer = raw ? selectTransactionInstaller(raw, rows, expected) : null
    if (installer && !afterLaunch) authenticatedPreparedTransaction = raw
    return installer
  }
}

function hasOldStartup(text, launch, executable) {
  return text.split(/(?=^\[)/m).some(entry => {
    const stamp = entry.match(/^\[([^\]]+)\]/)?.[1]
    if (!Number.isFinite(Date.parse(stamp)) || Date.parse(stamp) < launch.atMs || !entry.includes('Desktop startup entered.')) return false
    const offset = entry.indexOf('detail: ')
    if (offset < 0) return false
    try {
      const detail = JSON.parse(entry.slice(offset + 'detail: '.length).trim())
      return detail.appVersion === '0.4.3' && detail.executablePath?.toLowerCase() === executable.toLowerCase()
    } catch { return false }
  })
}

function preparedWindow(log) {
  return log.includes('NSIS update-boundary=prepared') &&
    !log.includes('START action=StageExtractedUpdatePayload') &&
    !log.includes('NSIS update-boundary=cutover')
}

// Dependency-injected state machine: timing races must not become passing tests.
async function observePreparedRestart(operations) {
  const record = { status: 'inconclusive', reason: 'prepared_window_not_observed', samples: 0 }
  const deadline = operations.now() + operations.timeoutMs
  let launch
  let overlap = false
  while (!operations.stopped() && operations.now() < deadline) {
    const sample = await operations.sample(launch)
    record.samples++
    record.lastObservation = sample.summary
    if (!launch && sample.oldExited && sample.window && sample.pendingPresent && sample.installerVerified) {
      await operations.preserve('before-launch')
      // Snapshotting can take time. Recheck the boundary immediately before spawn.
      const recheck = await operations.sample()
      if (!recheck.window || !recheck.oldExited || !recheck.pendingPresent || !recheck.installerVerified) {
        record.reason = 'prepared_window_closed_before_launch'
        break
      }
      launch = await operations.launch()
      record.launch = launch
      operations.event('prepared_restart_launched', launch)
    } else if (launch && sample.window && sample.startedOldGui && sample.installerVerified) {
      overlap = true
      record.overlap = sample.summary
      if (!sample.pendingPresent && !record.pendingRemoval) {
        record.pendingRemoval = sample.summary
        await operations.preserve('pending-removed')
        operations.event('prepared_restart_pending_removed', sample.summary)
      }
    }
    if (sample.stageStarted) {
      record.reason = overlap ? 'old_gui_started_before_stage' : 'stage_started_before_proven_overlap'
      break
    }
    await operations.pause(50)
  }
  if (overlap) {
    record.status = 'observed'
    record.reason = record.pendingRemoval ? 'pending_removed_during_prepared_overlap' : 'old_gui_started_during_prepared_overlap'
  } else if (launch && record.reason === 'prepared_window_not_observed') {
    record.reason = 'normal_launch_not_proven_before_stage'
  }
  await operations.preserve('observation-end')
  operations.event('prepared_restart_observation', record)
  return record
}

function observationFailure(error, startedAt) {
  // JSON.parse diagnostics may embed the malformed input, including credentials.
  // Keep a bounded classification, not error.message or a source-data excerpt.
  const names = ['Error', 'SyntaxError', 'TypeError', 'RangeError']
  const codes = ['ENOENT', 'EACCES', 'EPERM', 'ETIMEDOUT', 'ERR_ASSERTION', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER']
  return { status: 'inconclusive', reason: 'observation_error', startedAt,
    errorName: names.includes(error?.name) ? error.name : 'Error',
    ...(codes.includes(error?.code) ? { errorCode: error.code } : {}) }
}

function startPreparedRestartObservation(options) {
  let stopped = false
  let launched
  let launchError
  let verifiedInstallerIdentity
  const verifyPreparedOwner = createPreparedOwnerVerifier(options)
  const launchTime = Date.now()
  const pendingPath = join(options.userData, 'pending-update.json')
  const installerLog = join(options.root, 'installer.log')
  const readText = path => readFile(path, 'utf8').catch(missing)
  const ownedProcesses = async () => {
    const result = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,@{Name="CreationDate";Expression={$_.CreationDate.ToUniversalTime().ToString("O")}},KernelModeTime,UserModeTime | ConvertTo-Json -Depth 4'],
    { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 })
    const rows = parseWindowsJson(result.stdout || '[]')
    return selectOwnedWindowsProcesses(Array.isArray(rows) ? rows : [rows], options)
  }
  const transactions = async () => {
    const entries = await readdir(options.installerRecovery).catch(error => missing(error) || [])
    const records = []
    for (const name of entries.filter(name => name.endsWith('-update.json'))) {
      const text = await readText(join(options.installerRecovery, name))
      if (text) records.push({ name, text })
    }
    return records
  }
  const preserve = async label => {
    const pending = await readText(pendingPath)
    const runtimeText = await readText(join(options.dataDir, 'runtime.json'))
    const runtimeData = runtimeText ? parseWindowsJson(runtimeText) : null
    const runtime = runtimeData ? Object.fromEntries(['pid', 'port', 'startedAt', 'version', 'buildId'].map(key => [key, runtimeData[key]])) : null
    const snapshot = { at: new Date().toISOString(), pending, runtime,
      transactions: await transactions(), processes: await ownedProcesses() }
    await writeFile(join(options.root, `prepared-restart-${label}.json`), JSON.stringify(snapshot, null, 2))
  }
  const sample = async () => {
    const log = await readText(installerLog) || ''
    const window = preparedWindow(log)
    let installerVerified = false
    let startedOldGui = false
    let currentTransaction = { observed: false }
    if (window && !options.processIsAlive(options.oldPid)) {
      const records = await transactions()
      const processes = await ownedProcesses()
      const raw = records.length === 1 ? records[0].text : null
      currentTransaction = { observed: true, present: records.length > 0, count: records.length }
      if (raw) {
        try { currentTransaction.phase = parseWindowsJson(raw).Phase }
        catch { currentTransaction.unreadable = true }
      }
      const installer = verifyPreparedOwner(raw, processes.processes, Boolean(launched))
      if (installer) {
        const identity = JSON.stringify([installer.ProcessId, installer.CreationDate, installer.ExecutablePath])
        verifiedInstallerIdentity ??= identity
        installerVerified = verifiedInstallerIdentity === identity
      }
      if (launched && !launchError) {
        const child = processes.processes.find(row => row.ProcessId === launched.pid &&
          String(row.ExecutablePath).toLowerCase() === options.executable.toLowerCase())
        const serialized = String(child?.CreationDate).match(/^\/Date\((-?\d+)(?:[+-]\d+)?\)\/$/)
        const createdAt = serialized ? Number(serialized[1]) : Date.parse(child?.CreationDate)
        const identity = child ? JSON.stringify([child.ProcessId, child.CreationDate, child.ExecutablePath]) : null
        const childVerified = !launched.exit && createdAt >= launched.atMs - 1000 && createdAt <= launched.atMs + 10000 &&
          (!launched.processIdentity || launched.processIdentity === identity)
        if (childVerified) launched.processIdentity = identity
        const entries = await readdir(join(options.userData, 'logs')).catch(error => missing(error) || [])
        for (const name of entries.filter(name => /^kun-.*\.log$/.test(name))) {
          const text = await readText(join(options.userData, 'logs', name)) || ''
          startedOldGui ||= Boolean(childVerified && hasOldStartup(text, launched, options.executable))
        }
      }
    }
    const pending = await readText(pendingPath)
    const finalLog = await readText(installerLog) || ''
    const stillWindow = window && preparedWindow(finalLog)
    const summary = { at: new Date().toISOString(), window: stillWindow, pendingPresent: pending !== null,
      installerVerified, startedOldGui, currentTransaction, launchError: launchError?.message }
    return { window: stillWindow, pendingPresent: pending !== null, installerVerified, startedOldGui,
      oldExited: !options.processIsAlive(options.oldPid), stageStarted: finalLog.includes('START action=StageExtractedUpdatePayload'), summary }
  }
  const done = observePreparedRestart({ now: Date.now, timeoutMs: 10 * 60_000,
    stopped: () => stopped, pause: delay, sample, preserve, event: options.event,
    launch: async () => {
      const archive = join(options.executable, '..', 'resources', 'app.asar')
      const version = await execute(process.execPath, [join(__dirname, 'smoke-windows-installer-version.cjs'), archive])
      if (version.stdout.trim() !== '0.4.3') throw new Error('Prepared restart must execute the actual installed 0.4.3 payload')
      const sha512 = await digest(archive)
      // Revalidate after hashing so a fast Stage/cutover cannot launch a new payload.
      const authorized = await sample()
      if (!authorized.window || !authorized.oldExited || !authorized.pendingPresent || !authorized.installerVerified) {
        throw new Error('Fresh prepared authorization disappeared during payload verification')
      }
      const atMs = Date.now()
      const child = spawn(options.executable, [], { env: options.environment, stdio: 'ignore' })
      child.on('error', error => { launchError = error })
      launched = { pid: child.pid, at: new Date(atMs).toISOString(), atMs, version: '0.4.3', archiveSha512: sha512,
        executable: options.executable, arguments: [] }
      child.on('exit', (code, signal) => { launched.exit = { at: new Date().toISOString(), code, signal } })
      options.record.launch = launched
      return launched
    }
  }).catch(error => observationFailure(error, launchTime))
  return { done, stop: async () => { stopped = true; const result = await done; Object.assign(options.record, result); return result } }
}

module.exports = { observationFailure, parseWindowsJson, creationIdentity, selectTransactionInstaller, createPreparedOwnerVerifier, hasOldStartup, preparedWindow, observePreparedRestart, startPreparedRestartObservation }
