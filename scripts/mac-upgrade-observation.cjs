'use strict'

const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { mkdir, realpath, rm, writeFile } = require('node:fs/promises')
const { join } = require('node:path')
const { promisify } = require('node:util')

const run = promisify(execFile)

async function inspectSignedBundle(bundle) {
  await run('codesign', ['--verify', '--deep', '--strict', bundle])
  const details = await run('codesign', ['--display', '--verbose=4', bundle])
  const identity = details.stdout + details.stderr
  assert.match(identity, /Authority=Developer ID Application:/, 'A Developer ID signature is required')
  const teamId = identity.match(/TeamIdentifier=([A-Z0-9]{10})\b/)?.[1]
  assert.ok(teamId, 'Missing Developer ID team')
  const cdHash = identity.match(/^CDHash=([a-f0-9]{40})\b/m)?.[1]
  assert.ok(cdHash, 'Missing signed code directory hash')
  const plist = name => run('/usr/libexec/PlistBuddy', ['-c', `Print ${name}`, join(bundle, 'Contents', 'Info.plist')])
  const bundleId = (await plist('CFBundleIdentifier')).stdout.trim()
  const version = (await plist('CFBundleShortVersionString')).stdout.trim()
  const requirements = await run('codesign', ['--display', '--requirements', '-', bundle])
  const requirement = (requirements.stdout + requirements.stderr).match(/^designated => (.+)$/m)?.[1]
  assert.ok(requirement, 'Missing designated code-signing requirement')
  return { bundleId, version, teamId, cdHash, requirement }
}

async function verifyMacCandidate(baselineBundle, candidateZip, version, root) {
  const directory = join(root, 'installed', 'signature-inspection')
  await mkdir(directory, { recursive: true })
  try {
    const baseline = await inspectSignedBundle(baselineBundle)
    await run('ditto', ['-x', '-k', candidateZip, directory])
    const candidateBundle = join(directory, 'Kun.app')
    const candidate = await inspectSignedBundle(candidateBundle)
    const result = { baseline, candidate, designatedRequirementAccepted: false }
    await writeFile(join(root, 'signatures.json'), JSON.stringify(result, null, 2))
    assert.equal(baseline.version, '0.3.7')
    assert.equal(candidate.version, version)
    assert.equal(candidate.bundleId, baseline.bundleId, 'Candidate Bundle ID differs from the released baseline')
    assert.equal(candidate.teamId, baseline.teamId, 'Candidate Team ID differs from the released baseline')
    await run('codesign', ['--verify', '--deep', '--strict', '-R', `=${baseline.requirement}`, candidateBundle])
    result.designatedRequirementAccepted = true
    await writeFile(join(root, 'signatures.json'), JSON.stringify(result, null, 2))
    return result
  } finally {
    // This extraction is only for signature inspection. It is never copied
    // over the installed baseline or used as the running application.
    await rm(directory, { recursive: true, force: true })
  }
}

async function waitForBundleReplacement(readVersion, target, poll, journal, timeout = 10 * 60_000) {
  const observation = { lastVersion: null, lastReadError: null }
  journal.record.bundleObservation = observation
  journal.phase('bundle_replacement')
  try {
    await poll(async () => {
      observation.lastReadAt = new Date().toISOString()
      try {
        observation.lastVersion = await readVersion()
        observation.lastVersionAt = observation.lastReadAt
        observation.lastReadSucceeded = true
        return observation.lastVersion === target
      } catch (error) {
        observation.lastReadSucceeded = false
        observation.lastReadError = { time: observation.lastReadAt, error: error.message }
        return false
      }
    }, timeout, 'macOS application replacement')
    journal.phase('bundle_replaced', { version: observation.lastVersion })
  } finally {
    journal.event('bundle_observation', observation)
  }
}

function findRelaunchedGui(applications, expected) {
  return applications.find(app => Number.isInteger(app.pid) && app.pid > 0 && app.pid !== expected.oldPid &&
    app.bundlePath === expected.bundlePath && app.executablePath === expected.executablePath &&
    app.bundleId === expected.bundleId && app.finishedLaunching === true && app.guiWindowObserved === true)
}

async function waitForMacRelaunch(bundle, executable, oldPid, bundleId, poll, journal) {
  const observer = join(journal.record.evidence, 'installed', 'observe-macos-gui')
  await run('swiftc', [join(__dirname, 'observe-macos-gui.swift'), '-o', observer], { timeout: 60_000 })
  const expected = { bundlePath: await realpath(bundle), executablePath: await realpath(executable), oldPid, bundleId }
  journal.phase('automatic_relaunch')
  const found = await poll(async () => {
    const result = await run(observer, [expected.bundlePath, expected.executablePath], { timeout: 10_000 })
    const applications = JSON.parse(result.stdout)
    journal.record.lastRelaunchObservation = applications
    return findRelaunchedGui(applications, expected)
  }, 10 * 60_000, 'native macOS GUI relaunch with a visible window')
  journal.record.automaticRelaunch = { ...found, source: 'NSWorkspace/CGWindowList',
    observedAt: new Date().toISOString(), beforeHarnessLaunch: true }
  journal.phase('new_gui_started', journal.record.automaticRelaunch)
}

module.exports = { inspectSignedBundle, verifyMacCandidate, waitForBundleReplacement,
  findRelaunchedGui, waitForMacRelaunch }
