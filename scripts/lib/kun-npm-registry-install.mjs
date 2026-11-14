import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runProcess } from './kun-npm-smoke-process.mjs'

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

export async function exerciseWindowsRegistryPackage({ node, npm, root, env, manifest, proof, check }) {
  const published = proof.find(item => item.name === manifest.kunNpm.windowsPackage)
  assert(published, 'Published Windows component proof is required')
  const prefix = join(root, 'windows platform project'), cache = join(root, 'windows-platform-cache')
  await mkdir(prefix)
  try {
    await writeFile(join(prefix, 'package.json'), '{"name":"kun-windows-consumer","private":true}')
    await check('REG-03.windows-platform-registry-install', async () => {
      const args = registryInstallArguments({ reference: published.name + '@' + published.version,
        expectedName: published.name, expectedVersion: published.version, cache })
      const result = await runProcess(node, [npm, ...args], { cwd: prefix, env, timeout: 600_000 })
      const log = result.stdout + result.stderr
      assert(log.includes(published.tarball), 'npm must download the Windows component from registry')
      verifyProjectResolution(JSON.parse(await readFile(join(prefix, 'package-lock.json'), 'utf8')),
        published.name, published.integrity, published.tarball)
      const installed = join(prefix, 'node_modules', published.name)
      const pkg = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'))
      assert.equal(pkg.name, published.name); assert.equal(pkg.version, published.version)
      const payload = JSON.parse(await readFile(join(installed, 'manifest.json'), 'utf8'))
      assert.equal(payload.sourceCommit, manifest.kunNpm.sourceCommit)
      assert.equal(payload.serviceVersion, manifest.version)
      assert.deepEqual(Object.keys(payload.files).sort(), ['kun-owned-launcher.exe', 'kun_windows_startup.node'])
      for (const [name, digest] of Object.entries(payload.files))
        assert.equal(createHash('sha256').update(await readFile(join(installed, name))).digest('hex'), digest)
      await runProcess(node, ['--eval', 'require(process.argv[1])', join(installed, 'kun_windows_startup.node')], { cwd: prefix, env })
      return { command: [node, npm, ...args], exitCode: result.code, freshCache: true,
        resolvedFromRegistry: true, downloads: [published], sourceCommit: payload.sourceCommit,
        payloadDigestsVerified: 2, nativeAddonLoaded: true,
        httpFetches: log.split(/\r?\n/).filter(line => line.includes(published.tarball)) }
    })
  } finally {
    await rm(prefix, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true })
  }
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
