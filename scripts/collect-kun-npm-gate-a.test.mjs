import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectGateEvidence, parseGateEvidenceArguments } from './collect-kun-npm-gate-a.mjs'

test('Gate A collection accepts evidence paths and has no publication option', () => {
  const args = ['--candidate', '/candidate', '--receipts', '/receipts', '--global-evidence', '/global',
    '--desktop-receipt', '/desktop', '--output', '/output']
  assert(parseGateEvidenceArguments(args).output)
  assert.throws(() => parseGateEvidenceArguments([...args, '--publish', 'yes']))
  assert.throws(() => parseGateEvidenceArguments(args.slice(0, -2)))
  assert.throws(() => parseGateEvidenceArguments([...args, '--output', '/other']))
})

test('a failed collection overwrites a previous ready receipt before reading inputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-gate-collection-'))
  try {
    const output = join(root, 'receipt.json')
    await writeFile(output, JSON.stringify({ artifactReady: true }))
    const result = await collectGateEvidence({ candidate: join(root, 'absent'), output })
    assert.equal(result.artifactReady, false)
    assert.equal(result.published, false)
    assert.equal(result.registryReady, false)
    assert(result.errors.length > 0)
    assert.equal(JSON.parse(await readFile(output, 'utf8')).artifactReady, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})
