import assert from 'node:assert/strict'
import { sha256, readCandidate, verifyGateA } from './kun-npm-release-artifacts.mjs'
import { NPM_REGISTRY, publicPackage } from './kun-npm-registry.mjs'

export function isPrerelease(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(version)
  return Boolean(match && match[4].split('.').every(part => !/^\d+$/.test(part) || part === '0' || !part.startsWith('0')))
}

export function namespaceBlockers(audit, policy, release, now = Date.now()) {
  if (!audit) return ['Authenticated npm namespace audit is missing']
  const errors = []
  if (audit.kind !== 'kun-npm-namespace-audit' || audit.registry !== NPM_REGISTRY ||
    audit.readOnly !== true || audit.registryWrites !== false || audit.rightsVerified !== true ||
    audit.identity?.authenticated !== true || audit.identity.username !== policy.expectedMaintainer)
    errors.push('Namespace/maintainer authority is not verified for the configured npm identity')
  const age = now - Date.parse(audit.checkedAt)
  if (!Number.isFinite(age) || age < -300_000 || age > 24 * 60 * 60 * 1000) errors.push('Namespace audit is stale or has an invalid timestamp')
  for (const name of [release.name, release.windowsPackage]) {
    if (!audit.packages?.some(item => item.name === name && item.accountPublishAuthorityVerified === true))
      errors.push('Package authority is missing: ' + name)
  }
  return errors
}

export async function preparePublishPlan({ directory, gateA, receipts, audit, policy, release,
  metadata = publicPackage, now = Date.now() }) {
  assert.equal(policy.schemaVersion, 1)
  assert.equal(policy.registry, NPM_REGISTRY)
  assert(/^[a-z][a-z0-9-]*$/.test(policy.prereleaseTag) &&
    !['latest', 'stable'].includes(policy.prereleaseTag), 'Only an explicit prerelease tag is allowed')
  // The previously accepted artifact can predate a final namespace decision.
  // Validate its exact old identity, then block publication until a newly named
  // candidate has its own complete Gate A evidence.
  const approvedRelease = { ...release, name: policy.acceptedCandidate.name,
    windowsPackage: policy.acceptedCandidate.windowsPackage }
  const candidate = await readCandidate(directory, approvedRelease, policy.acceptedCandidate)
  await verifyGateA(gateA, receipts, candidate, policy.acceptedCandidate, release)
  const blockers = namespaceBlockers(audit, policy, release, now)
  const namesMatch = approvedRelease.name === release.name && approvedRelease.windowsPackage === release.windowsPackage
  if (!namesMatch) blockers.push('The accepted artifact names differ from the confirmed namespace; create and accept a new candidate')
  if (!policy.enabled) blockers.push('Publication is disabled in the checked-in policy')
  if (!policy.namespaceConfirmed || !policy.expectedMaintainer) blockers.push('Final npm scope/maintainer has not been selected')
  if (!isPrerelease(candidate.manifest.version))
    blockers.push('The accepted candidate is not a SemVer prerelease; create and accept a new candidate instead of rewriting this tarball')
  const operations = []
  for (const [index, artifact] of candidate.artifacts.entries()) {
    if (!namesMatch) {
      operations.push({ name: artifact.name, intendedName: index === 0 ? release.windowsPackage : release.name,
        version: artifact.version, filename: artifact.filename, sha256: artifact.sha256,
        integrity: artifact.integrity, action: 'requires-new-candidate', arguments: [] })
      continue
    }
    const remote = await metadata(artifact.name)
    const existing = remote.versions[artifact.version]
    if (existing) {
      assert.equal(existing.dist?.integrity, artifact.integrity, 'Published version has different bytes; never overwrite or retag it')
      assert.equal(remote.distTags[policy.prereleaseTag], artifact.version,
        'Existing identical version has tag drift; no automatic tag repair is permitted')
    }
    operations.push({ name: artifact.name, version: artifact.version, filename: artifact.filename,
      sha256: artifact.sha256, integrity: artifact.integrity, action: existing ? 'skip-identical' : 'publish-prerelease',
      observedStableTag: remote.distTags.latest ?? null,
      arguments: ['publish', artifact.path, '--registry=' + NPM_REGISTRY,
        '--access=public', '--tag=' + policy.prereleaseTag, '--ignore-scripts', '--provenance=false', '--json'] })
  }
  const identity = { registry: policy.registry, tag: policy.prereleaseTag, sourceCommit: candidate.manifest.sourceCommit,
    gateAReceiptSha256: policy.acceptedCandidate.gateAReceiptSha256,
    artifacts: operations.map(({ name, version, sha256 }) => ({ name, version, sha256 })) }
  return { schemaVersion: 1, kind: 'kun-npm-publish-plan', planId: sha256(JSON.stringify(identity)),
    prepared: true, publishable: blockers.length === 0, state: blockers.length ? 'blocked-before-publication' : 'prepared-awaiting-explicit-publication',
    checkedAt: new Date(now).toISOString(), blockers, ...identity, operations,
    gateAVerified: true, registryReady: false, published: false, distTagsChanged: false,
    trustedPublisherConfigured: Boolean(policy.trustedPublisherConfigured) }
}
