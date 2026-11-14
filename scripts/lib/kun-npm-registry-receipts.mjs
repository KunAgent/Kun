import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const slots = release => release.targets.flatMap(target => release.testNodeVersions.map(node => ({
  target, node, key: target + '/' + node, name: `kun-npm-registry-receipt-${target}-${node}`
})))

export function verifyRegistryJobs(jobs, release) {
  const actual = new Map()
  for (const job of jobs.filter(value => value.name.startsWith('registry-install ('))) {
    const match = /^registry-install \(([^,]+), ([^,]+), [^)]+\)$/.exec(job.name)
    assert(match, 'Unrecognized registry job: ' + job.name)
    const key = match[2] + '/' + match[1]
    assert(!actual.has(key), 'Duplicate latest registry job: ' + key)
    assert.equal(job.status, 'completed', 'Registry job has not completed: ' + key)
    assert.equal(job.conclusion, 'success', 'Registry job did not succeed: ' + key)
    actual.set(key, { id: job.id, key, name: job.name })
  }
  const expected = slots(release)
  assert.equal(actual.size, expected.length, 'Every native registry job is required')
  return expected.map(slot => {
    assert(actual.has(slot.key), 'Missing successful registry job: ' + slot.key)
    return actual.get(slot.key)
  })
}

export function selectRegistryReceiptArtifacts(artifacts, release, runId, sourceCommit) {
  const expected = slots(release), names = new Set(expected.map(slot => slot.name))
  for (const artifact of artifacts)
    if (artifact.name.startsWith('kun-npm-registry-receipt-')) assert(names.has(artifact.name), 'Unexpected registry receipt: ' + artifact.name)
  const selected = [], superseded = []
  for (const slot of expected) {
    const matches = artifacts.filter(artifact => artifact.name === slot.name)
    for (const artifact of matches) {
      assert(Number.isFinite(Date.parse(artifact.created_at)), 'Invalid artifact creation timestamp')
      assert.equal(String(artifact.workflow_run?.id), String(runId), 'Receipt must belong to the selected run')
      assert.equal(artifact.workflow_run?.head_sha, sourceCommit, 'Receipt must use the original test-driver commit')
    }
    // Artifact IDs are opaque. A newer run attempt can have a smaller ID.
    matches.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    const newest = matches[0]
    assert(newest, 'Missing registry receipt: ' + slot.key)
    assert(!matches[1] || Date.parse(newest.created_at) !== Date.parse(matches[1].created_at), 'Ambiguous latest registry receipt: ' + slot.key)
    assert.equal(newest.expired, false, 'Latest receipt expired; never fall back to an older attempt')
    assert(Number.isSafeInteger(newest.id) && newest.id > 0)
    assert(/^sha256:[a-f0-9]{64}$/.test(newest.digest), 'Receipt ZIP digest is required')
    selected.push({ ...slot, id: newest.id, createdAt: newest.created_at, digest: newest.digest })
    superseded.push(...matches.slice(1).map(item => ({ name: item.name, id: item.id,
      createdAt: item.created_at, digest: item.digest })))
  }
  assert.equal(new Set(selected.map(item => item.id)).size, expected.length)
  return { sourceRunId: String(runId), testDriverSourceCommit: sourceCommit, selected, superseded }
}

export async function materializeRegistryReceipt(bytes, artifact, directory) {
  assert.equal('sha256:' + createHash('sha256').update(bytes).digest('hex'), artifact.digest,
    'Receipt ZIP bytes differ from the selected immutable artifact')
  assert(Number.isSafeInteger(artifact.id) && artifact.id > 0)
  assert(/^kun-npm-registry-receipt-[a-z0-9.-]+$/.test(artifact.name))
  const archives = join(directory, '__archives__')
  await mkdir(archives, { recursive: true })
  const zip = join(archives, artifact.id + '.zip')
  await writeFile(zip, bytes, { flag: 'wx' })
  // Never extract arbitrary paths or run code from a receipt ZIP.
  const script = [
    'import pathlib, sys, zipfile',
    'with zipfile.ZipFile(sys.argv[1]) as z:',
    " assert z.namelist() == ['receipt.json'], 'Unexpected receipt ZIP entries'",
    " info = z.getinfo('receipt.json')",
    " assert info.file_size <= 2 * 1024 * 1024, 'Oversized receipt JSON'",
    " data = z.read('receipt.json')",
    ' target = pathlib.Path(sys.argv[2])',
    ' target.mkdir(parents=True, exist_ok=True)',
    " with (target / 'receipt.json').open('xb') as f: f.write(data)"
  ].join('\n')
  execFileSync('python3', ['-c', script, zip, join(directory, artifact.name)], { stdio: ['ignore', 'pipe', 'pipe'] })
}
