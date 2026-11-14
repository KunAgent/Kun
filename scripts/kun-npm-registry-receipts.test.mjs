import assert from 'node:assert/strict'
import test from 'node:test'
import { selectRegistryReceiptArtifacts, verifyRegistryJobs } from './lib/kun-npm-registry-receipts.mjs'

const release = { targets: ['win32-x64'], testNodeVersions: ['26.4.0'] }
const source = 'a'.repeat(40)
const artifact = (id, created_at, extra = {}) => ({ id, created_at, name: 'kun-npm-registry-receipt-win32-x64-26.4.0',
  expired: false, digest: 'sha256:' + 'b'.repeat(64), workflow_run: { id: 123, head_sha: source }, ...extra })
const select = values => selectRegistryReceiptArtifacts(values, release, 123, source)

test('latest receipt uses creation time even when its artifact ID is smaller', () => {
  const selected = select([artifact(99, '2026-11-14T17:00:48Z'), artifact(88, '2026-11-14T17:17:49Z')])
  assert.equal(selected.selected[0].id, 88)
  assert.equal(selected.superseded[0].id, 99)
})

test('latest attempt is never replaced with an older passing or unexpired receipt', () => {
  const old = artifact(99, '2026-11-14T17:00:48Z', { success: true })
  const latest = artifact(88, '2026-11-14T17:17:49Z', { success: false })
  assert.equal(select([old, latest]).selected[0].id, latest.id)
  assert.throws(() => select([old, { ...latest, expired: true }]), /Latest receipt expired/)
})

test('missing, ambiguous, wrong-source and unsigned receipt selections fail', () => {
  const value = artifact(88, '2026-11-14T17:17:49Z')
  assert.throws(() => select([]), /Missing registry receipt/)
  assert.throws(() => select([value, { ...value, id: 99 }]), /Ambiguous/)
  assert.throws(() => select([{ ...value, workflow_run: { id: 124, head_sha: source } }]), /selected run/)
  assert.throws(() => select([{ ...value, workflow_run: { id: 123, head_sha: 'c'.repeat(40) } }]), /original test-driver/)
  assert.throws(() => select([{ ...value, digest: null }]), /ZIP digest/)
})

test('collection requires every latest native job to have actually succeeded', () => {
  const job = { id: 1, name: 'registry-install (26.4.0, win32-x64, windows-2025)', status: 'completed', conclusion: 'success' }
  assert.equal(verifyRegistryJobs([job], release).length, 1)
  assert.throws(() => verifyRegistryJobs([{ ...job, conclusion: 'failure' }], release), /did not succeed/)
  assert.throws(() => verifyRegistryJobs([{ ...job, status: 'in_progress' }], release), /not completed/)
  assert.throws(() => verifyRegistryJobs([], release), /Every native registry job/)
})
