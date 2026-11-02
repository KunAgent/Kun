'use strict'

const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { mkdtemp, readFile, writeFile, cp, mkdir, readdir } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, win32 } = require('node:path')
const { parse } = require('yaml')
const { digest } = require('./gui-upgrade-feed.cjs')
const run = promisify(execFile)
const RELEASE_SHA256 = Object.freeze({
  '0.4.3': 'e71eb0851bf3c5b416709c49ce07090e9d2a9c05758c82326926522ec22333dd',
  '0.4.4': '49a8dd4945199f39ffe5ec4e5264dbc15c8a30593bc7c35a7d66aab0df365d16'
})

function upgradeOptions(flags, platform) {
  const version = flags.get('--version')
  const baselineVersion = flags.get('--baseline-version') || '0.3.7'
  for (const value of [version, baselineVersion]) assert.match(value || '', /^\d+\.\d+\.\d+$/)
  const scenarios = flags.has('--scenarios') ? flags.get('--scenarios').split(',')
    : platform === 'win32' ? ['normal', 'busy', 'rollback', 'manual'] : ['normal']
  assert.ok(scenarios.length && scenarios.every(name => ['normal', 'busy', 'rollback', 'manual', 'restart-prepared'].includes(name)),
    'Unknown GUI upgrade scenario')
  assert.equal(new Set(scenarios).size, scenarios.length, 'Duplicate GUI upgrade scenario')
  if (scenarios.includes('restart-prepared')) {
    assert.equal(platform, 'win32', 'Prepared restart requires native Windows')
    assert.equal(baselineVersion, '0.4.3', 'Prepared restart requires released 0.4.3')
    assert.equal(scenarios.length, 1, 'Prepared restart must run separately from required acceptance')
  }
  return { version, baselineVersion, scenarios }
}

// The published-release control must use the actual release bytes, never the
// locally built package with the same version. No publishing APIs are invoked.
async function verifyPublishedSource(version, directory, execute = run, platform = process.platform, arch = process.arch) {
  assert.match(version || '', /^\d+\.\d+\.\d+$/)
  const tag = `v${version}`
  const options = { timeout: 60_000, maxBuffer: 1024 * 1024 }
  const response = await execute('gh', ['release', 'view', tag, '-R', 'KunAgent/Kun',
    '--json', 'tagName,isDraft,isPrerelease'], options)
  const release = JSON.parse(response.stdout)
  assert.equal(release.tagName, tag)
  assert.equal(release.isDraft, false)
  assert.equal(release.isPrerelease, false)
  const ref = `refs/tags/${tag}`
  const target = await execute('git', ['ls-remote', '--exit-code', 'https://github.com/KunAgent/Kun.git', ref, `${ref}^{}`], options)
  const refs = new Map(target.stdout.trim().split(/\r?\n/).map(line => {
    const [sha, name] = line.split(/\s+/)
    return [name, sha]
  }))
  const commit = refs.get(`${ref}^{}`) || refs.get(ref)
  assert.match(commit || '', /^[a-f0-9]{40}$/)
  const manifestName = platform === 'win32' ? 'latest.yml' : 'latest-mac.yml'
  const name = platform === 'win32' ? `Kun-${version}-win-x64.exe` : `Kun-${version}-mac-${arch}.zip`
  const root = await mkdtemp(join(tmpdir(), 'kun-published-source-'))
  await execute('gh', ['release', 'download', tag, '-R', 'KunAgent/Kun', '-p', manifestName, '-D', root], options)
  const published = parse(await readFile(join(root, manifestName), 'utf8'))
  assert.equal(published.version, version)
  const file = published.files.find(file => file.url === name)
  assert.ok(file, 'Release manifest does not contain the expected installer')
  assert.equal(await digest(join(directory, name)), file.sha512, 'Candidate differs from the published release')
  if (platform === 'win32' && RELEASE_SHA256[version]) {
    assert.equal(await digest(join(directory, name), 'sha256', 'hex'), RELEASE_SHA256[version],
      'Published Windows installer differs from the pinned investigation artifact')
  }
  return commit
}

// Keep runner/bootstrap/other-account command lines out of uploaded artifacts.
// Process identity is PID + creation time + executable, not a mutable name.
function selectOwnedWindowsProcesses(rows, paths, limit = 128) {
  const normalize = value => typeof value === 'string' ? win32.normalize(value).toLowerCase() : ''
  const anchor = value => typeof value === 'string' && win32.isAbsolute(value) && /\.exe$/i.test(value) ? normalize(value) : ''
  const executable = anchor(paths.executable)
  const installRoot = executable ? win32.dirname(executable) + '\\' : ''
  const installers = new Set((paths.verifiedInstallerPaths || []).map(anchor).filter(Boolean))
  const owned = new Set(rows.filter(row => {
    const path = normalize(row.ExecutablePath)
    return path && (path === executable || (installRoot && path.startsWith(installRoot)) || installers.has(path))
  }).map(row => row.ProcessId))
  const createdAt = value => {
    const serialized = typeof value === 'string' && value.match(/^\/Date\((-?\d+)(?:[+-]\d+)?\)\/$/)
    return serialized ? Number(serialized[1]) : Date.parse(value)
  }
  const byPid = new Map(rows.map(row => [row.ProcessId, row]))
  let previousSize = -1
  while (previousSize !== owned.size) {
    previousSize = owned.size
    for (const row of rows) {
      const parent = byPid.get(row.ParentProcessId)
      // A recycled parent PID is not evidence of ownership. Missing or invalid
      // creation times fail closed; directly verified roots remain visible.
      if (owned.has(row.ParentProcessId) && parent &&
          createdAt(row.CreationDate) >= createdAt(parent.CreationDate)) owned.add(row.ProcessId)
    }
  }
  const selected = rows.filter(row => owned.has(row.ProcessId))
  const fields = ['ProcessId', 'ParentProcessId', 'Name', 'ExecutablePath', 'CreationDate', 'KernelModeTime', 'UserModeTime']
  return { truncated: selected.length > limit, processes: selected.slice(0, limit).map(row =>
    Object.fromEntries(fields.map(field => [field, row[field]]))) }
}

async function captureWindowsUpgrade(root, paths, execute = run) {
  if (process.platform !== 'win32') return
  // Capture before any cleanup: owned installer CPU, children, identity and the
  // transaction distinguish native extraction stalls from old-GUI recovery.
  const command = "$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process | " +
    'Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CreationDate,KernelModeTime,UserModeTime | ConvertTo-Json -Depth 4'
  const processes = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command],
    { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 })
  const parsed = JSON.parse(processes.stdout || '[]')
  const snapshot = selectOwnedWindowsProcesses(Array.isArray(parsed) ? parsed : [parsed], paths)
  await writeFile(join(root, 'windows-processes.json'), JSON.stringify(snapshot, null, 2))
  await writeFile(join(root, 'windows-paths.json'), JSON.stringify(paths, null, 2))
  for (const [name, path] of [['installer-recovery-snapshot', paths.installerRecovery], ['desktop-profile-snapshot', paths.userData]]) {
    const snapshot = join(root, name)
    await mkdir(snapshot)
    for (const entry of await readdir(path, { withFileTypes: true })) {
      // Payload backup trees remain in the owned recovery directory; snapshot
      // only diagnostic records while the installer could still be writing.
      const keep = name.startsWith('installer-')
        ? entry.isFile() && /\.(json|jsonl|log|txt)$/.test(entry.name)
        : entry.name === 'logs' || /^pending-update.*\.json$/.test(entry.name)
      if (keep) await cp(join(path, entry.name), join(snapshot, entry.name), { recursive: true, force: false })
    }
  }
}

function assertCandidateExtractionTrace(log) {
  let cursor = 0
  for (const step of ['archive-write-start', 'archive-write-returned', '7z-extract-start',
    '7z-extract-returned', 'shell-copy-start', 'shell-copy-returned', 'decompression-returned']) {
    const marker = `NSIS update-boundary=${step}`
    const found = log.indexOf(marker, cursor)
    assert.ok(found >= 0, `Missing or out-of-order compiled extraction marker: ${marker}`)
    cursor = found + marker.length
  }
}

async function stopVerifiedInstallers(paths, execute = run) {
  if (process.platform !== 'win32' || !paths.length) return
  const quoted = paths.map(path => `'${path.replace(/'/g, "''")}'`).join(',')
  // Only paths whose bytes matched the candidate SHA-512 above are authorized.
  // Stop their children too before preserving journals; never kill by name.
  await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `$owned=@(${quoted}); Get-CimInstance Win32_Process | Where-Object { $owned -contains $_.ExecutablePath } | ` +
    'ForEach-Object { & "$env:SystemRoot\\System32\\taskkill.exe" /PID $_.ProcessId /T /F | Out-Null }'],
  { timeout: 30_000, maxBuffer: 1024 * 1024 })
}

module.exports = { RELEASE_SHA256, upgradeOptions, verifyPublishedSource, captureWindowsUpgrade, stopVerifiedInstallers, assertCandidateExtractionTrace, selectOwnedWindowsProcesses }
