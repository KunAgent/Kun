'use strict'
const assert = require('node:assert/strict')
const { mkdtemp, writeFile, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')
const { stringify } = require('yaml')
const { digest, validateFeed, startCandidateFeed } = require('./gui-upgrade-feed.cjs')

test('candidate feed validates actual bytes and serves update ranges without touching latest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kun-candidate-feed-'))
  let feed
  try {
    const file = join(directory, 'Kun-0.3.8-win-x64.exe')
    await writeFile(file, 'candidate-binary')
    await writeFile(join(directory, 'latest.yml'), stringify({ version: '0.3.8', files: [{
      url: 'Kun-0.3.8-win-x64.exe', size: 16, sha512: await digest(file)
    }] }))
    feed = await startCandidateFeed(directory, 'latest.yml', '0.3.8')
    const response = await fetch(`${feed.url}Kun-0.3.8-win-x64.exe`, { headers: { range: 'bytes=0-8' } })
    assert.equal(response.status, 206)
    assert.equal(await response.text(), 'candidate')
    assert.equal((await fetch(`${feed.url}unknown.exe`)).status, 404)
    await writeFile(file, 'tampered-payload')
    await assert.rejects(validateFeed(directory, 'latest.yml', '0.3.8'), /SHA-512 mismatch/)
  } finally {
    await feed?.close()
    await rm(directory, { recursive: true, force: true })
  }
})
