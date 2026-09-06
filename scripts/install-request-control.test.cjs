'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createInstallRequestControl } = require('./install-request-control.cjs')
const { poll } = require('./smoke-packaged-update-handoff-support.cjs')

function fixture() {
  const journal = { record: { phase: 'bundle_replacement' }, event: () => {} }
  return { journal, control: createInstallRequestControl(journal) }
}

test('an explicit rejected install ends polling before any replacement wait', async () => {
  const { journal, control } = fixture()
  control.recordResult({ ok: false, code: 'install_failed', message: 'Provider save failed' })
  let reads = 0
  await assert.rejects(poll(async () => { reads++; return false }, 600_000, 'replacement', control.check),
    error => error.code === 'install_failed' && error.phase === 'install_requested' && error.message === 'Provider save failed')
  assert.equal(reads, 0)
  assert.equal(journal.record.status, 'failed')
  assert.equal(journal.record.phase, 'install_requested')
})

test('a failure received during an exit observation takes precedence over a disappearing PID', async () => {
  const { control } = fixture()
  let reads = 0
  await assert.rejects(poll(async () => {
    reads++
    control.recordResult({ ok: false, code: 'install_failed', message: 'Preflight rejected' })
    return true
  }, 600_000, 'GUI exit', control.check), /Preflight rejected/)
  assert.equal(reads, 1)
})

test('handoff can continue without an IPC success response but an explicit failure stays terminal', async () => {
  const { control } = fixture()
  assert.equal(await poll(async () => 'replacement verified', 100, 'replacement', control.check), 'replacement verified')
  control.recordResult({ ok: false, message: 'Original rejection' })
  control.recordResult({ ok: true })
  assert.throws(control.check, /Original rejection/)
})
