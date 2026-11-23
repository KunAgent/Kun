import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

export function archivePackage(bytes) {
  const tar = gunzipSync(bytes)
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const field = (start, length) => header.subarray(start, start + length).toString().replace(/\0.*$/s, '')
    const name = [field(345, 155), field(0, 100)].filter(Boolean).join('/')
    const size = parseInt(field(124, 12).trim() || '0', 8)
    assert(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= tar.length, 'Invalid tar entry')
    assert(!name.startsWith('/') && !name.split('/').includes('..'), 'Unsafe archive path')
    if (name === 'package/package.json') return JSON.parse(tar.subarray(offset + 512, offset + 512 + size))
    offset += 512 + Math.ceil(size / 512) * 512
  }
  throw Error('Archive package.json is missing')
}

export async function readCandidate(directory, release, approved) {
  const root = resolve(directory)
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'))
  assert.equal(manifest.kind, 'kun-npm-local-candidate')
  assert.equal(manifest.sourceDirty, false)
  assert.equal(manifest.published, false)
  assert.equal(manifest.sourceCommit, approved.sourceCommit)
  assert.equal(manifest.artifact.name, release.name)
  assert.equal(manifest.artifact.version, approved.version)
  assert.equal(manifest.artifact.sha256, approved.sha256)
  assert.equal(manifest.platformArtifacts.length, 1, 'Only the declared Windows platform package is expected')
  const platform = manifest.platformArtifacts[0]
  assert.equal(platform.name, release.windowsPackage)
  assert.equal(platform.name, approved.windowsPackage)
  assert.equal(platform.sha256, approved.windowsSha256)
  const artifacts = []
  for (const item of [platform, manifest.artifact]) {
    assert.equal(item.filename, basename(item.filename), 'Artifact filename must stay within its input directory')
    const path = resolve(root, item.filename)
    assert((await lstat(path)).isFile(), 'Artifact cannot be a symlink or directory')
    const bytes = await readFile(path)
    assert.equal(sha256(bytes), item.sha256, 'Candidate tarball bytes changed')
    assert.equal('sha512-' + createHash('sha512').update(bytes).digest('base64'), item.integrity)
    const pkg = archivePackage(bytes)
    assert.equal(pkg.name, item.name)
    assert.equal(pkg.version, item.version)
    artifacts.push({ name: item.name, version: item.version, filename: item.filename, path,
      sha256: item.sha256, integrity: item.integrity, package: pkg })
  }
  const main = artifacts[1].package
  assert.equal(main.name, approved.name)
  assert.equal(main.kunNpm.sourceCommit, manifest.sourceCommit)
  assert.equal(main.kunNpm.sourceDirty, false)
  assert.equal(main.kunNpm.buildId, approved.buildId)
  assert.equal(main.optionalDependencies[platform.name], platform.version)
  assert(main.bundleDependencies.includes(platform.name))
  assert.equal(platform.version, main.version, 'Main and Windows package versions must match exactly')
  return { manifest, artifacts }
}

export async function nativeReceipts(root) {
  const values = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name)
    if (entry.isDirectory()) values.push(...await nativeReceipts(path))
    else if (entry.isFile() && entry.name.endsWith('.json')) {
      const bytes = await readFile(path)
      const value = JSON.parse(bytes)
      if (value.kind === 'kun-npm-native-install-receipt') values.push({ value, sha256: sha256(bytes) })
    } else assert(!entry.isSymbolicLink(), 'Evidence cannot contain symlinks')
  }
  return values
}

export async function verifyGateA(path, receipts, candidate, approved, release) {
  const bytes = await readFile(path)
  assert.equal(sha256(bytes), approved.gateAReceiptSha256, 'Gate A approval receipt does not match the reviewed policy')
  const gate = JSON.parse(bytes)
  assert.equal(gate.kind, 'kun-npm-artifact-readiness')
  assert.equal(gate.artifactReady, true)
  assert.equal(gate.gate.complete, true)
  assert.equal(gate.gate.success, true)
  assert.deepEqual(gate.errors, [])
  assert.equal(gate.registryReady, false)
  assert.equal(gate.published, false)
  assert.equal(gate.distTagsChanged, false)
  assert.equal(gate.sourceCommit, candidate.manifest.sourceCommit)
  assert.equal(gate.buildId, approved.buildId)
  assert.equal(gate.candidate.sha256, candidate.manifest.artifact.sha256)
  assert.equal(gate.candidate.name, approved.name)
  assert.equal(gate.candidate.version, approved.version)
  assert.equal(gate.platformArtifacts[0].sha256, approved.windowsSha256)
  const expected = new Set(release.targets.flatMap(target => release.testNodeVersions.map(version => target + '/' + version)))
  const actual = new Set()
  for (const receipt of await nativeReceipts(receipts)) {
    const value = receipt.value
    const slot = value.platform + '-' + value.arch + '/' + value.nodeVersion
    assert(expected.has(slot) && !actual.has(slot), 'Unexpected or duplicate native receipt: ' + slot)
    actual.add(slot)
    assert.equal(value.success, true)
    assert.equal(value.tarballSha256, approved.sha256)
    assert.equal(value.sourceCommit, approved.sourceCommit)
    assert.equal(value.buildId, approved.buildId)
    assert.equal(value.isolation.sourceCheckoutRemoved, true)
    assert.equal(value.isolation.gitHistoryAvailable, false)
    assert.equal(value.isolation.exportedDriverVerified, true)
    const proof = gate.combinations.find(combination =>
      combination.platform + '-' + combination.arch + '/' + combination.node === slot)
    assert.equal(proof?.sha256, receipt.sha256, 'Native receipt differs from the approved complete Gate A proof')
  }
  assert.equal(actual.size, expected.size, 'Every platform/Node receipt is required')
  assert.equal(gate.combinations.length, expected.size)
  return gate
}
