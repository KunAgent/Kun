'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { findRelaunchedGui, waitForBundleReplacement } = require('./mac-upgrade-observation.cjs')

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
