#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkMatrix } from './check-kun-npm-matrix.mjs'

export function checkRegistryMatrix(receipts, release, manifest, accepted, initialLatestAcknowledgement = null) {
  const result = checkMatrix(receipts, release, { complete: false })
  const errors = [...result.errors]
  const fail = (condition, message) => { if (!condition) errors.push(message) }
  fail(manifest.sourceCommit === accepted.sourceCommit && manifest.sourceDirty === false,
    'Candidate must retain its accepted committed source')
  fail(manifest.artifact.name === accepted.name && manifest.artifact.version === accepted.version &&
    manifest.artifact.sha256 === accepted.sha256, 'Main candidate identity differs from Gate A')
  fail(manifest.platformArtifacts.length === 1 && manifest.platformArtifacts[0].name === accepted.windowsPackage &&
    manifest.platformArtifacts[0].sha256 === accepted.windowsSha256, 'Windows candidate identity differs from Gate A')
  const artifacts = [...manifest.platformArtifacts, manifest.artifact]
  const expectedLatest = artifact => initialLatestAcknowledgement?.version === artifact.version &&
    initialLatestAcknowledgement.packages?.includes(artifact.name) ? artifact.version : null
  for (const receipt of receipts) {
    const slot = `${receipt.platform}-${receipt.arch}/${receipt.nodeVersion}`
    const registry = receipt.registry
    fail(receipt.kind === 'kun-npm-registry-install-receipt' && registry?.installSource === 'registry-exact-version' &&
      registry.reference === accepted.name + '@' + accepted.version, 'Not an exact registry installation: ' + slot)
    fail(receipt.sourceCommit === accepted.sourceCommit && receipt.buildId === accepted.buildId &&
      receipt.tarballSha256 === accepted.sha256 && receipt.sourceDirty === false, 'Wrong installed build: ' + slot)
    fail(registry?.artifacts?.length === artifacts.length, 'Missing registry artifact proof: ' + slot)
    for (const artifact of artifacts) {
      const proof = registry?.artifacts?.find(item => item.name === artifact.name)
      fail(proof?.version === artifact.version && proof.sha256 === artifact.sha256 &&
        proof.integrity === artifact.integrity && proof.observedTags?.next === artifact.version &&
        (proof.observedTags?.latest ?? null) === expectedLatest(artifact), 'Registry bytes or tags differ: ' + artifact.name + ' ' + slot)
    }
    for (const id of ['REG-03.project-registry-install', 'REG-03.global-registry-install']) {
      const check = receipt.checks?.find(item => item.id === id)
      const detail = check?.detail
      fail(check?.status === 'pass' && detail?.exitCode === 0 && detail.freshCache === true &&
        detail.resolvedFromRegistry === true, 'Missing fresh registry install: ' + id + ' ' + slot)
      const args = detail?.command ?? []
      fail(args.includes(accepted.name + '@' + accepted.version) && !args.includes('--offline') &&
        !args.some(arg => arg.endsWith('.tgz')) && args.includes('https://registry.npmjs.org/'),
      'Installation did not use the public exact-version reference: ' + id + ' ' + slot)
      for (const artifact of artifacts.filter(item => item.name === accepted.name || receipt.platform === 'win32')) {
        const download = detail?.downloads?.find(item => item.name === artifact.name)
        const proof = registry?.artifacts?.find(item => item.name === artifact.name)
        fail(Boolean(download?.tarball?.startsWith('https://registry.npmjs.org/')) &&
          download?.tarball === proof?.tarball && download?.integrity === artifact.integrity,
        'npm did not fetch the published tarball: ' + artifact.name + ' ' + id + ' ' + slot)
      }
    }
  }
  return { schemaVersion: 1, kind: 'kun-npm-registry-readiness', registryReady: errors.length === 0,
    success: errors.length === 0, receipts: receipts.length, packageName: accepted.name, version: accepted.version,
    sourceCommit: accepted.sourceCommit, buildId: accepted.buildId, tarballSha256: accepted.sha256,
    tag: 'next', stableTagsVerified: errors.length === 0,
    initialLatestAcknowledged: artifacts.every(artifact => expectedLatest(artifact) === artifact.version),
    explicitLatestPromotion: false, errors }
}

async function readReceipts(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) result.push(...await readReceipts(path))
    else if (entry.name.endsWith('.json')) result.push(JSON.parse(await readFile(path, 'utf8')))
  }
  return result
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [directory, candidateManifest, output, ...extra] = process.argv.slice(2)
  assert(directory && candidateManifest && output && !extra.length,
    'Usage: check-kun-npm-registry.mjs RECEIPTS CANDIDATE_MANIFEST OUTPUT')
  const read = async path => JSON.parse(await readFile(path, 'utf8'))
  const release = await read(new URL('../kun/npm/release.json', import.meta.url))
  const { acceptedCandidate, initialLatestAcknowledgement } = await read(new URL('../kun/npm/publish.json', import.meta.url))
  const result = checkRegistryMatrix(await readReceipts(resolve(directory)), release,
    await read(candidateManifest), acceptedCandidate, initialLatestAcknowledgement)
  await writeFile(output, JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
  if (!result.success) process.exitCode = 1
}
