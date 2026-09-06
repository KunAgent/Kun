'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const { mkdtemp, rm, writeFile, readFile } = require('node:fs/promises')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { stringify } = require('yaml')
const { digest } = require('./gui-upgrade-feed.cjs')
const { MANIFEST, writePrCandidateSource, verifyPrCandidateSource } = require('./pr-gui-candidate-source.cjs')
const version = '0.3.8'
const commit = 'a'.repeat(40)
const environment = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request',
  GITHUB_REF: 'refs/pull/1266/merge', GITHUB_SHA: commit, GITHUB_RUN_ID: '123', GITHUB_REPOSITORY: 'KunAgent/Kun' }
async function fixture(action) {
  const root = await mkdtemp(join(tmpdir(), 'kun-pr-candidate-'))
  try {
    const name = `Kun-${version}-win-x64.exe`
    await writeFile(join(root, name), 'installer')
    await writeFile(join(root, 'latest.yml'), stringify({ version,
      files: [{ url: name, size: 9, sha512: await digest(join(root, name)) }] }))
    await action(root)
  } finally { await rm(root, { recursive: true, force: true }) }
}
test('PR upgrade acceptance binds same-run installer and metadata bytes to the merge commit', async () => {
  await fixture(async root => {
    await writePrCandidateSource(root, version, commit, environment)
    assert.equal(await verifyPrCandidateSource(root, version, commit, environment), commit)
  })
})
test('PR upgrade acceptance rejects a missing or stale provenance manifest', async () => {
  await fixture(async root => {
    await assert.rejects(verifyPrCandidateSource(root, version, commit, environment), /ENOENT/)
    await writePrCandidateSource(root, version, commit, environment)
    for (const change of [{ commit: 'b'.repeat(40) }, { runId: '456' }, { repository: 'other/repo' }]) {
      const source = JSON.parse(await readFile(join(root, MANIFEST), 'utf8'))
      await writeFile(join(root, MANIFEST), JSON.stringify({ ...source, ...change }))
      await assert.rejects(verifyPrCandidateSource(root, version, commit, environment), /provenance/)
      await writePrCandidateSource(root, version, commit, environment)
    }
  })
})
test('PR mode cannot be used by release workflows or a different checkout', async () => {
  await fixture(async root => {
    for (const change of [{ GITHUB_EVENT_NAME: 'workflow_dispatch' }, { GITHUB_SHA: 'b'.repeat(40) },
      { GITHUB_REF: 'refs/tags/v0.3.8' }, { GITHUB_ACTIONS: 'false' }]) {
      await assert.rejects(writePrCandidateSource(root, version, commit, { ...environment, ...change }))
    }
  })
})
test('PR upgrade acceptance rejects changed installer bytes and changed update metadata', async () => {
  await fixture(async root => {
    await writePrCandidateSource(root, version, commit, environment)
    await writeFile(join(root, 'latest.yml'), '\n', { flag: 'a' })
    await assert.rejects(verifyPrCandidateSource(root, version, commit, environment), /provenance/)
    await writePrCandidateSource(root, version, commit, environment)
    await writeFile(join(root, `Kun-${version}-win-x64.exe`), 'tampered!')
    await assert.rejects(verifyPrCandidateSource(root, version, commit, environment), /mismatch/)
  })
})
