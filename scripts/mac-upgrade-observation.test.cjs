'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { mkdtemp, mkdir, writeFile, symlink, realpath, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { findRelaunchedGui, findCanonicalRelaunchedGui, waitForBundleReplacement } = require('./mac-upgrade-observation.cjs')

const expected = { oldPid: 10, bundlePath: '/installed/Kun.app',
  executablePath: '/installed/Kun.app/Contents/MacOS/Kun', bundleId: 'app.kun' }
const application = { pid: 11, ...expected, finishedLaunching: true, guiWindowObserved: true }

test('automatic relaunch requires a new GUI window belonging to the exact installed bundle', () => {
  assert.equal(findRelaunchedGui([application], expected), application)
  for (const change of [{ pid: 10 }, { pid: -1 }, { bundlePath: '/elsewhere/Kun.app' },
    { executablePath: '/different/executable' }, { bundleId: 'another.app' },
    { finishedLaunching: false }, { guiWindowObserved: false }]) {
    assert.equal(findRelaunchedGui([{ ...application, ...change }], expected), undefined)
  }
  assert.equal(findRelaunchedGui([], expected), undefined)
})

test('native relaunch accepts filesystem aliases while preserving GUI identity checks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-relaunch-path-'))
  try {
    const bundle = join(root, 'installed', 'Kun.app')
    const executable = join(bundle, 'Contents', 'MacOS', 'Kun')
    await mkdir(join(bundle, 'Contents', 'MacOS'), { recursive: true })
    await writeFile(executable, 'fixture')
    const alias = join(root, 'alias')
    await symlink(join(root, 'installed'), alias, process.platform === 'win32' ? 'junction' : 'dir')
    const target = { ...expected, bundlePath: await realpath(bundle), executablePath: await realpath(executable) }
    const observed = { ...application, bundlePath: join(alias, 'Kun.app'),
      executablePath: join(alias, 'Kun.app', 'Contents', 'MacOS', 'Kun') }
    const found = await findCanonicalRelaunchedGui([observed], target)
    assert.equal(found.pid, 11)
    assert.equal(found.bundlePath, target.bundlePath)
    assert.equal(found.executablePath, target.executablePath)
    for (const change of [{ pid: 10 }, { guiWindowObserved: false }, { finishedLaunching: false },
      { bundleId: 'another.app' }, { bundlePath: root }, { executablePath: root },
      { bundlePath: join(root, 'missing') }, { executablePath: undefined }]) {
      assert.equal(await findCanonicalRelaunchedGui([{ ...observed, ...change }], target), undefined)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('replacement timeout preserves the last version and the last plist read error', async () => {
  const journal = { record: {}, phase: () => {}, event: () => {} }
  let calls = 0
  const read = async () => {
    if (++calls === 2) throw new Error('Info.plist temporarily missing')
    return '0.3.7'
  }
  const poll = async action => {
    for (let i = 0; i < 3; i++) assert.equal(await action(), false)
    throw new Error('Timed out waiting for replacement')
  }
  await assert.rejects(waitForBundleReplacement(read, '0.3.8', poll, journal), /Timed out/)
  assert.equal(journal.record.bundleObservation.lastVersion, '0.3.7')
  assert.equal(journal.record.bundleObservation.lastReadError.error, 'Info.plist temporarily missing')
  assert.equal(journal.record.bundleObservation.lastReadSucceeded, true)
})
