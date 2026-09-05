'use strict'

const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { readFile, writeFile } = require('node:fs/promises')
const { join, resolve } = require('node:path')
const { promisify } = require('node:util')
const { digest, validateFeed } = require('./gui-upgrade-feed.cjs')

const MANIFEST = 'pr-candidate-source.json'
function identity(version, commit, environment) {
  assert.match(version ?? '', /^\d+\.\d+\.\d+$/)
  assert.match(commit ?? '', /^[a-f0-9]{40}$/)
  assert.equal(environment.GITHUB_ACTIONS, 'true')
  assert.equal(environment.GITHUB_EVENT_NAME, 'pull_request', 'PR artifacts require a pull_request run')
  assert.match(environment.GITHUB_REF ?? '', /^refs\/pull\/\d+\/merge$/)
  assert.equal(environment.GITHUB_SHA, commit, 'PR harness checkout differs from the tested merge commit')
  assert.match(environment.GITHUB_RUN_ID ?? '', /^\d+$/)
  assert.match(environment.GITHUB_REPOSITORY ?? '', /^[\w.-]+\/[\w.-]+$/)
  return { schemaVersion: 1, source: 'pull-request', version, commit,
    repository: environment.GITHUB_REPOSITORY, runId: environment.GITHUB_RUN_ID }
}
async function artifact(directory, version) {
  const { metadata } = await validateFeed(directory, 'latest.yml', version)
  const name = `Kun-${version}-win-x64.exe`
  assert.ok(metadata.files.some(file => file.url === name), 'Missing PR Windows installer')
  return { name, sha512: await digest(join(directory, name)),
    feedSha512: await digest(join(directory, 'latest.yml')) }
}
async function writePrCandidateSource(directory, version, commit, environment = process.env) {
  const expected = identity(version, commit, environment)
  const source = { ...expected, artifact: await artifact(directory, version) }
  await writeFile(join(directory, MANIFEST), `${JSON.stringify(source, null, 2)}\n`)
  return source
}
async function verifyPrCandidateSource(directory, version, commit, environment = process.env) {
  const expected = { ...identity(version, commit, environment), artifact: await artifact(directory, version) }
  const actual = JSON.parse(await readFile(join(directory, MANIFEST), 'utf8'))
  assert.deepEqual(actual, expected, 'PR candidate provenance differs from this run, commit, or artifact')
  return commit
}
if (require.main === module) {
  const flags = new Map()
  for (let index = 2; index < process.argv.length; index += 2) flags.set(process.argv[index], process.argv[index + 1])
  promisify(execFile)('git', ['rev-parse', 'HEAD']).then(({ stdout }) => writePrCandidateSource(
    resolve(flags.get('--directory') || 'dist'), flags.get('--version'), stdout.trim()
  )).catch(error => { console.error(error); process.exitCode = 1 })
}
module.exports = { MANIFEST, writePrCandidateSource, verifyPrCandidateSource }
