import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const REGISTRY = 'https://registry.npmjs.org/'

export function registryInstallArguments({ reference, expectedName, expectedVersion, prefix, global, cache }) {
  assert.equal(reference, expectedName + '@' + expectedVersion, 'Registry install must use the exact accepted version, never a tag')
  return ['install', ...(global ? ['--global', '--prefix', prefix] : []), '--cache', cache,
    '--omit=dev', '--engine-strict', '--no-audit', '--no-fund', '--loglevel=http', '--registry', REGISTRY, reference]
}

export function verifyProjectResolution(lock, name, integrity, tarballUrl) {
  const installed = lock.packages?.['node_modules/' + name]
  assert.equal(installed?.integrity, integrity, 'Consumer lockfile must pin the published original bytes')
  assert.equal(installed?.resolved, tarballUrl, 'Consumer must resolve the registry tarball, not a local file')
}

export async function verifyRegistryArtifacts(manifest, fetchImpl = fetch, stableTags = {}) {
  const proof = []
  for (const artifact of [...manifest.platformArtifacts, manifest.artifact]) {
    const response = await fetchImpl(REGISTRY + encodeURIComponent(artifact.name), {
      headers: { accept: 'application/json', 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(60_000)
    })
    assert(response.ok, 'Published package is not visible: ' + artifact.name + ' HTTP ' + response.status)
    const pkg = await response.json()
    assert.equal(pkg.name, artifact.name)
    assert.equal(pkg['dist-tags']?.next, artifact.version, 'Only the expected next prerelease is accepted')
    assert.equal(pkg['dist-tags']?.latest ?? null, stableTags[artifact.name] ?? null,
      'Stable tag changed from the publication baseline')
    const dist = pkg.versions?.[artifact.version]?.dist
    assert.equal(dist?.integrity, artifact.integrity)
    const url = new URL(dist.tarball)
    assert.equal(url.protocol, 'https:')
    assert.equal(url.hostname, 'registry.npmjs.org')
    assert(!url.username && !url.password)
    const download = await fetchImpl(url.href, { signal: AbortSignal.timeout(180_000) })
    assert(download.ok, 'Registry tarball download failed')
    const bytes = Buffer.from(await download.arrayBuffer())
    assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256,
      'Registry tarball differs from the accepted original')
    assert.equal('sha512-' + createHash('sha512').update(bytes).digest('base64'), artifact.integrity)
    proof.push({ name: artifact.name, version: artifact.version, tarball: url.href,
      sha256: artifact.sha256, integrity: dist.integrity, observedTags: pkg['dist-tags'] })
  }
  return proof
}
