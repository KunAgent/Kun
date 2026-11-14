import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

function archive(value) {
  const data = Buffer.from(JSON.stringify(value))
  const header = Buffer.alloc(512)
  header.write('package/package.json')
  header.write(data.length.toString(8).padStart(11, '0') + '\0', 124)
  header.write('0', 156)
  return gzipSync(Buffer.concat([header, data, Buffer.alloc((512 - data.length % 512) % 512 + 1024)]))
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

export async function publishFixture(root, version = '0.4.6-rc.1') {
  const directory = join(root, 'candidate'), receipts = join(root, 'receipts')
  await mkdir(directory); await mkdir(receipts)
  const release = { name: '@fixture/agent', windowsPackage: '@fixture/agent-win32-x64',
    targets: ['darwin-arm64', 'win32-x64'], testNodeVersions: ['26.4.0', '26.12.0'] }
  const sourceCommit = 'a'.repeat(40), buildId = 'b'.repeat(64)
  const platform = { name: release.windowsPackage, version }
  const main = { name: release.name, version, kunNpm: { sourceCommit, sourceDirty: false, buildId },
    optionalDependencies: { [platform.name]: version }, bundleDependencies: [platform.name] }
  const artifacts = []
  for (const [i, pkg] of [main, platform].entries()) {
    const bytes = archive(pkg), filename = i ? 'windows.tgz' : 'main.tgz'
    await writeFile(join(directory, filename), bytes)
    artifacts.push({ name: pkg.name, version, filename, sha256: hash(bytes),
      integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') })
  }
  const manifest = { kind: 'kun-npm-local-candidate', published: false, sourceDirty: false,
    sourceCommit, version, artifact: artifacts[0], platformArtifacts: [artifacts[1]] }
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest))
  const combinations = []
  for (const target of release.targets) {
    for (const nodeVersion of release.testNodeVersions) {
      const [platform, arch] = target.split('-')
      const receipt = { kind: 'kun-npm-native-install-receipt', platform, arch, nodeVersion, success: true,
        tarballSha256: artifacts[0].sha256, sourceCommit, buildId,
        isolation: { sourceCheckoutRemoved: true, gitHistoryAvailable: false, exportedDriverVerified: true } }
      const bytes = JSON.stringify(receipt)
      await writeFile(join(receipts, target + '-' + nodeVersion + '.json'), bytes)
      combinations.push({ platform, arch, node: nodeVersion, sha256: hash(bytes) })
    }
  }
  const gate = { kind: 'kun-npm-artifact-readiness', artifactReady: true, registryReady: false,
    published: false, distTagsChanged: false, gate: { complete: true, success: true, receipts: combinations.length },
    errors: [], sourceCommit, buildId, candidate: artifacts[0], platformArtifacts: [artifacts[1]], combinations }
  const bytes = JSON.stringify(gate), gateA = join(root, 'gate-a.json')
  await writeFile(gateA, bytes)
  const policy = { schemaVersion: 1, enabled: true, registry: 'https://registry.npmjs.org/',
    repository: 'fixture/project', workflow: 'kun-npm-publish.yml', releaseRef: 'refs/heads/master',
    prereleaseTag: 'next', expectedMaintainer: 'fixture-owner', namespaceConfirmed: true, trustedPublisherConfigured: true,
    acceptedCandidate: { name: release.name, version, sha256: artifacts[0].sha256,
      windowsPackage: platform.name, windowsSha256: artifacts[1].sha256, sourceCommit, buildId, gateAReceiptSha256: hash(bytes) } }
  const audit = { kind: 'kun-npm-namespace-audit', registry: policy.registry, checkedAt: new Date().toISOString(),
    readOnly: true, registryWrites: false, rightsVerified: true,
    identity: { authenticated: true, username: policy.expectedMaintainer },
    packages: artifacts.map(({ name }) => ({ name, accountPublishAuthorityVerified: true })) }
  const state = new Map(artifacts.map(({ name }) => [name, { name, versions: {}, distTags: { latest: '0.4.0' } }]))
  return { directory, receipts, gateA, policy, audit, release,
    metadata: async name => structuredClone(state.get(name)), state }
}
