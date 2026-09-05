'use strict'

const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

async function verifyCandidateSource(version, tag, commit, run = promisify(execFile)) {
  assert.match(version ?? '', /^\d+\.\d+\.\d+$/)
  assert.equal(tag, `v${version}`)
  assert.match(commit ?? '', /^[a-f0-9]{40}$/)
  const options = { timeout: 60_000, maxBuffer: 1024 * 1024 }
  const ref = `refs/tags/${tag}`
  const target = await run('git', ['ls-remote', '--exit-code', 'https://github.com/KunAgent/Kun.git', ref, `${ref}^{}`], options)
  const refs = new Map(target.stdout.trim().split(/\r?\n/).map(line => {
    const [sha, name] = line.split(/\s+/)
    return [name, sha]
  }))
  assert.equal(refs.get(`${ref}^{}`) || refs.get(ref), commit, 'Candidate tag points to another commit')
  const response = await run('gh', ['release', 'view', tag, '-R', 'KunAgent/Kun',
    '--json', 'tagName,isDraft'], options)
  const release = JSON.parse(response.stdout)
  assert.equal(release.tagName, tag)
  assert.equal(release.isDraft, true, 'Only an unpublished candidate may be promoted')
  return commit
}

if (require.main === module) {
  verifyCandidateSource(process.env.RELEASE_VERSION || process.env.CANDIDATE_VERSION,
    process.env.TAG_NAME || process.env.CANDIDATE_TAG, process.env.CANDIDATE_COMMIT)
    .then(commit => console.log(`Verified unpublished candidate source ${commit}`))
    .catch(error => { console.error(error); process.exitCode = 1 })
}

module.exports = { verifyCandidateSource }
