'use strict'

const assert = require('node:assert/strict')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')
const { createScenarioJournal, cleanupScenario, recordScenario } = require('./gui-upgrade-journal.cjs')

test('failure phase is persisted and cleanup errors never replace the original upgrade error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-journal-'))
  const report = { status: 'running', scenarios: [] }
  const snapshots = []
  const persist = () => snapshots.push(JSON.parse(JSON.stringify(report)))
  const original = new Error('Application replacement timed out')
  let laterCleanupRan = false
  try {
    await assert.rejects(recordScenario(report, 'normal', async record => {
      assert.equal(snapshots[0].scenarios[0].status, 'running')
      const journal = createScenarioJournal(record, root, persist)
      journal.phase('bundle_replacement')
      assert.equal(JSON.parse(await readFile(join(root, 'scenario.json'), 'utf8')).phase, 'bundle_replacement')
      journal.fail(original)
      await cleanupScenario(journal, [
        ['first', async () => { throw new Error('Cleanup failed') }],
        ['second', async () => { laterCleanupRan = true }]
      ])
      throw original
    }, persist), error => error === original)
    assert.equal(laterCleanupRan, true)
    assert.equal(report.status, 'failed')
    assert.equal(report.error, original.message)
    const record = JSON.parse(await readFile(join(root, 'scenario.json'), 'utf8'))
    assert.equal(record.status, 'failed')
    assert.equal(record.phase, 'bundle_replacement')
    assert.equal(record.cleanupErrors[0].error, 'Cleanup failed')
    const events = (await readFile(join(root, 'updater-events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
    assert.deepEqual(events.map(event => event.event), ['bundle_replacement', 'scenario_failed', 'cleanup_failed'])
    assert.ok(events.every(event => Number.isFinite(Date.parse(event.time))))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('cleanup-only failure cannot become a passed acceptance record', async () => {
  const report = { status: 'running', scenarios: [] }
  await assert.rejects(recordScenario(report, 'normal', async record => {
    record.phase = 'post_upgrade_verified'
    record.cleanupErrors.push({ name: 'manager', error: 'still running' })
  }, () => {}), /cleanup failed/)
  assert.equal(report.status, 'failed')
  assert.equal(report.scenarios[0].phase, 'cleanup')
})
