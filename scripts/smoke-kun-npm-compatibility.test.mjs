import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseGateArguments, runGateAcceptance } from './smoke-kun-npm-compatibility.mjs'

test('supplementary acceptance selects explicit stages and has no publication option', () => {
  assert.throws(() => parseGateArguments(['--publish']), /Unknown argument/)
  assert.throws(() => parseGateArguments(['--tarball', 'candidate.tgz', '--output', 'receipt.json', '--only', 'registry']), /Invalid acceptance stage/)
  const options = parseGateArguments(['--tarball', 'candidate.tgz', '--output', 'receipt.json', '--only', 'lifecycle,history'])
  assert.deepEqual(options.only, ['lifecycle', 'history'])
})

test('a failed supplementary preflight cannot leave a stale successful receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-gate-receipt-'))
  const output = join(root, 'receipt.json')
  try {
    await writeFile(output, '{"success":true,"runId":"previous"}')
    await assert.rejects(runGateAcceptance({ tarball: join(root, 'missing.tgz'), output, only: ['lifecycle'] }))
    const receipt = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(receipt.success, false)
    assert.equal(receipt.state, 'failed-preflight')
    assert.notEqual(receipt.runId, 'previous')
  } finally { await rm(root, { recursive: true, force: true }) }
})
