#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { appendFile, readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

const [directory, ...extra] = process.argv.slice(2)
assert(directory && !extra.length, 'Usage: verify-kun-npm-candidate.mjs ARTIFACT_DIRECTORY')
const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'))
const release = JSON.parse(await readFile(new URL('../kun/npm/release.json', import.meta.url), 'utf8'))
assert.equal(manifest.kind, 'kun-npm-local-candidate')
assert.equal(manifest.artifact.name, release.name, 'Candidate must use the selected npm namespace')
if (release.version) assert.equal(manifest.artifact.version, release.version, 'Candidate must use the selected release version')
assert.equal(manifest.version, manifest.artifact.version)
assert.equal(manifest.platformArtifacts.length, 1)
assert.equal(manifest.platformArtifacts[0].name, release.windowsPackage)
assert.equal(manifest.platformArtifacts[0].version, manifest.artifact.version)
assert.equal(manifest.published, false)
assert.equal(manifest.sourceDirty, false)
assert(/^[a-f0-9]{40}$/.test(manifest.sourceCommit))
for (const artifact of [manifest.artifact, ...manifest.platformArtifacts]) {
  assert.equal(artifact.filename, basename(artifact.filename))
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(resolve(directory, artifact.filename))) hash.update(chunk)
  assert.equal(hash.digest('hex'), artifact.sha256, 'Immutable candidate digest changed')
}
assert(manifest.platformArtifacts.some(artifact => artifact.name.endsWith('-win32-x64')))
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,
  'source_commit=' + manifest.sourceCommit + '\nsha256=' + manifest.artifact.sha256 + '\n')
console.log(JSON.stringify({ sourceCommit: manifest.sourceCommit, sha256: manifest.artifact.sha256, published: false }))
