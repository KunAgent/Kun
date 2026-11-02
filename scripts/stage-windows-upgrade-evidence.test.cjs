'use strict'
const assert = require('node:assert/strict')
const { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } = require('node:fs/promises')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const test = require('node:test')
const { stageEvidence, sanitizeDiagnostic, MAX_FILE_BYTES, MAX_TOTAL_BYTES, MAX_FILES } = require('./stage-windows-upgrade-evidence.cjs')

async function fixture(t) {
  // On Windows CI these deliberately reside on checkout D: and temporary C:.
  const workspace = await mkdtemp(join(process.cwd(), '.stage-evidence-test-'))
  const appData = await mkdtemp(join(tmpdir(), 'kun-evidence-appdata-'))
  t.after(async () => { await rm(workspace, { recursive: true, force: true }); await rm(appData, { recursive: true, force: true }) })
  const root = join(appData, 'kun-gui-upgrade-normal-owned123')
  await mkdir(root)
  const scenario = { name: 'normal', evidence: root, status: 'failed' }
  await writeFile(join(root, '.upgrade-acceptance-owner'), root)
  await writeFile(join(root, 'scenario.json'), JSON.stringify(scenario))
  const reportPath = join(workspace, 'report.json')
  await writeFile(reportPath, JSON.stringify({ scenarios: [scenario] }))
  return { root, workspace, appData, scenario, reportPath,
    outputDirectory: join(workspace, 'artifacts', 'evidence') }
}

test('stages owned cross-volume evidence beneath checkout without moving originals or scanning unrelated AppData', async t => {
  const f = await fixture(t)
  await mkdir(join(f.appData, 'unrelated'))
  await writeFile(join(f.appData, 'unrelated', 'secret.txt'), 'DO NOT COPY')
  await writeFile(join(f.root, 'installer.log'), 'Prepare\n')
  await writeFile(join(f.root, 'not-allowlisted.txt'), 'DO NOT COPY')
  await mkdir(join(f.root, 'installer-recovery'))
  const transaction = join(f.root, 'installer-recovery', 'guid-update.json')
  await writeFile(transaction, JSON.stringify({ Phase: 'prepared', HealthToken: 'private-health-token' }))
  const result = await stageEvidence(f)
  assert.equal(result.status, 'collected')
  assert.ok(result.files.some(file => file.path.endsWith('guid-update.json')))
  assert.ok(!JSON.stringify(result).includes('not-allowlisted'))
  const copied = await readFile(join(f.outputDirectory, 'scenario-1', 'installer-recovery', 'guid-update.json'), 'utf8')
  assert.ok(copied.includes('prepared'))
  assert.ok(!copied.includes('private-health-token'))
  assert.ok((await readFile(transaction, 'utf8')).includes('private-health-token'), 'Recovery source must remain unchanged')
  assert.deepEqual((await readdir(f.outputDirectory)).sort(), ['collection.json', 'report.json', 'scenario-1'])
})

test('early harness failure still produces a bounded collection report without directory discovery', async t => {
  const f = await fixture(t)
  await rm(f.reportPath)
  const result = await stageEvidence(f)
  assert.equal(result.status, 'report_unavailable')
  assert.equal(result.files.length, 0)
  assert.equal(result.roots.length, 0)
  assert.ok(await readFile(join(f.outputDirectory, 'collection.json'), 'utf8'))
})

test('missing ownership or mismatched journal cannot authorize scenario collection', async t => {
  for (const mutation of ['marker', 'journal', 'outside']) {
    await t.test(mutation, async t => {
      const f = await fixture(t)
      if (mutation === 'marker') await rm(join(f.root, '.upgrade-acceptance-owner'))
      if (mutation === 'journal') await writeFile(join(f.root, 'scenario.json'), '{"name":"other"}')
      if (mutation === 'outside') await writeFile(f.reportPath, JSON.stringify({ scenarios: [{ ...f.scenario, evidence: f.workspace }] }))
      const result = await stageEvidence(f)
      assert.equal(result.roots.length, 0)
      assert.ok(result.warnings.length)
    })
  }
})

test('junction/symlink diagnostic directory and output ancestors are rejected', async t => {
  const f = await fixture(t)
  const external = join(f.appData, 'outside')
  await mkdir(external)
  await writeFile(join(external, 'stolen-update.json'), '{"secret":"must-not-copy"}')
  await symlink(external, join(f.root, 'installer-recovery'), 'junction')
  const result = await stageEvidence(f)
  assert.ok(result.warnings.some(warning => /link|junction|redirection/.test(warning.error)))
  assert.ok(!result.files.some(file => file.path.includes('stolen')))
  const other = await fixture(t)
  await symlink(external, join(other.workspace, 'artifacts'), 'junction')
  await assert.rejects(stageEvidence(other), /link|junction|redirection/)
})

test('pre-existing output fails closed instead of uploading unrelated stale files', async t => {
  const f = await fixture(t)
  await mkdir(f.outputDirectory, { recursive: true })
  await writeFile(join(f.outputDirectory, 'unrelated.txt'), 'do not upload')
  await assert.rejects(stageEvidence(f), { code: 'EEXIST' })
})

test('file and total evidence budgets apply to oversized native logs', async t => {
  const f = await fixture(t)
  const logs = join(f.root, 'desktop-profile', 'logs')
  await mkdir(logs, { recursive: true })
  for (let i = 0; i < 20; i++) await writeFile(join(logs, `kun-${i}.log`), 'x'.repeat(MAX_FILE_BYTES + 10))
  const result = await stageEvidence(f)
  assert.ok(result.bytes <= MAX_TOTAL_BYTES)
  assert.ok(result.files.length <= MAX_FILES)
  assert.ok(result.files.every(file => file.bytes <= MAX_FILE_BYTES))
  assert.ok(result.files.some(file => file.truncated))
})

test('structured and partial text diagnostics redact credentials and command lines', () => {
  const json = sanitizeDiagnostic(JSON.stringify({ HealthToken: 'secret1', nested: { apiKey: 'secret2',
    CommandLine: 'secret3' }, message: 'Bearer secret4' }), '.json')
  for (const secret of ['secret1', 'secret2', 'secret3', 'secret4']) assert.ok(!json.includes(secret))
  const log = sanitizeDiagnostic('"apiKey": "a secret with spaces"\nAuthorization: Bearer abc\n' +
    'https://user:password@example.test?access_token=xyz\n"CommandLine": "runner --token private"', '.txt')
  for (const secret of ['a secret with spaces', 'Bearer abc', 'user:password', 'access_token=xyz', 'runner --token private']) {
    assert.ok(!log.includes(secret), log)
  }
})

test('malformed JSON and JSONL fail closed instead of attempting unsafe plaintext recovery', () => {
  for (const partial of ['{"CommandLine":"runner --credential SECRET VALUE',
    '{"HealthToken":"MULTI WORD SECRET', '{"sessionToken":"escaped\\nMULTI WORD SECRET',
    '{"message":"{\\"CommandLine\\":\\"runner --password SECRET VALUE']) {
    const json = sanitizeDiagnostic(partial, '.json')
    assert.match(json, /REDACTED.*malformed or truncated JSON/)
    assert.ok(!json.includes('SECRET'))
    assert.ok(!json.includes('runner'))
    const jsonl = sanitizeDiagnostic('{"safe":"retained"}\n' + partial, '.jsonl')
    assert.ok(jsonl.includes('retained'))
    assert.ok(jsonl.includes('malformed or truncated JSONL'))
    assert.ok(!jsonl.includes('SECRET'))
    assert.ok(!jsonl.includes('runner'))
  }
})

test('plain sensitive assignments redact the entire line and fail closed across unterminated quoted continuations', () => {
  for (const text of ['CommandLine: runner --password TOPSECRET', 'sessionToken=SECRET',
    'HealthToken=MULTI WORD SECRET', '"CommandLine":"runner --credential SECRET VALUE',
    'prefix "HealthToken":"MULTI WORD SECRET', 'healthToken="MULTI\\\nWORD SECRET',
    '\\"HealthToken\\":\\"MULTI\\nWORD SECRET']) {
    const clean = sanitizeDiagnostic(text, '.txt')
    for (const secret of ['TOPSECRET', 'SECRET', 'MULTI', 'WORD', 'runner']) assert.ok(!clean.includes(secret), clean)
    assert.ok(clean.includes('REDACTED'))
  }
  const multiline = sanitizeDiagnostic('healthToken="FIRST\nSECOND\nTHIRD', '.txt')
  for (const secret of ['FIRST', 'SECOND', 'THIRD']) assert.ok(!multiline.includes(secret), multiline)
})
