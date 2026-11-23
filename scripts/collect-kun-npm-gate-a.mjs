#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkMatrix } from './check-kun-npm-matrix.mjs'
import { tarEntries } from './smoke-kun-npm.mjs'

export function parseGateEvidenceArguments(argv) {
  const options = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1]
    assert(['--candidate', '--receipts', '--global-evidence', '--desktop-receipt', '--desktop-data-receipt', '--output'].includes(key) &&
      value && !value.startsWith('--'), 'Provide candidate, receipts, global-evidence, desktop-receipt and output paths')
    assert(!options[key.slice(2)], 'Duplicate argument: ' + key)
    options[key.slice(2)] = resolve(value)
  }
  for (const key of ['candidate', 'receipts', 'global-evidence', 'desktop-receipt', 'output']) assert(options[key], 'Missing ' + key)
  return options
}

async function readNativeReceipts(root) {
  const receipts = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name)
    if (entry.isDirectory()) receipts.push(...await readNativeReceipts(path))
    else if (entry.name.endsWith('.json')) {
      const text = await readFile(path, 'utf8')
      const receipt = JSON.parse(text)
      if (receipt.kind === 'kun-npm-native-install-receipt') receipts.push({
        ...receipt, evidenceFile: path, evidenceSha256: createHash('sha256').update(text).digest('hex')
      })
    }
  }
  return receipts
}

export async function collectGateEvidence(options) {
  const result = { schemaVersion: 1, kind: 'kun-npm-artifact-readiness', state: 'incomplete',
    artifactReady: false, registryReady: false, published: false, distTagsChanged: false, errors: [] }
  await mkdir(dirname(options.output), { recursive: true })
  await writeFile(options.output, JSON.stringify(result, null, 2) + '\n')
  try {
    const manifest = JSON.parse(await readFile(resolve(options.candidate, 'manifest.json'), 'utf8'))
    const release = JSON.parse(await readFile(new URL('../kun/npm/release.json', import.meta.url), 'utf8'))
    assert.equal(manifest.artifact.name, release.name, 'Gate A must verify the selected namespace')
    if (release.version) assert.equal(manifest.artifact.version, release.version, 'Gate A must verify the selected rc version')
    assert.equal(manifest.platformArtifacts[0].name, release.windowsPackage)
    assert.equal(manifest.platformArtifacts[0].version, manifest.artifact.version)
    assert.equal(manifest.kind, 'kun-npm-local-candidate')
    assert.equal(manifest.sourceDirty, false)
    assert.equal(manifest.published, false)
    const bytes = await readFile(resolve(options.candidate, manifest.artifact.filename))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.artifact.sha256)
    const packed = JSON.parse(tarEntries(bytes).find(entry => entry.name === 'package/package.json').content)
    assert.equal(packed.kunNpm.sourceCommit, manifest.sourceCommit)
    const receipts = await readNativeReceipts(options.receipts)
    const global = JSON.parse(await readFile(options['global-evidence'], 'utf8'))
    const desktopText = await readFile(options['desktop-receipt'], 'utf8')
    const desktop = JSON.parse(desktopText)
    const data = options['desktop-data-receipt'] ? JSON.parse(await readFile(options['desktop-data-receipt'], 'utf8')) : desktop
    for (const proof of [global, desktop, data, ...receipts]) {
      assert.equal(proof.tarballSha256, manifest.artifact.sha256, 'Mixed candidate evidence')
      assert.equal(proof.buildId, packed.kunNpm.buildId, 'Mixed Runtime build evidence')
      assert.equal(proof.sourceCommit, manifest.sourceCommit, 'Mixed source provenance')
    }
    assert.equal(global.kind, 'kun-npm-global-artifact-evidence')
    for (const name of ['candidate-integrity', 'test-kun-npm', 'typecheck', 'build', 'runtime-fence-tests']) {
      const command = global.commands.find(command => command.name === name)
      assert.equal(command?.exitCode, 0, 'Missing successful validation command: ' + name)
      assert.equal(command.timedOut, false)
      assert.equal(createHash('sha256').update(await readFile(command.log)).digest('hex'), command.logSha256,
        'Validation log changed: ' + name)
    }
    const gui = global.checks.find(check => check.id === 'GUI-01')
    assert.equal(gui?.detail?.packagedReceiptSha256, createHash('sha256').update(desktopText).digest('hex'))
    assert.equal(desktop.checks.find(check => check.id === 'GUI-01.signed-packaged-cli-and-runtime')?.status, 'pass')
    assert.equal(data.success, true, 'Desktop/npm sequential data reuse must complete')
    const desktopReuse = data.checks.find(check => check.id === 'DATA-01.reopen-desktop')
    assert.equal(desktopReuse?.status, 'pass')
    assert.equal(desktopReuse.detail.desktopArtifact.build.buildId, packed.kunNpm.buildId)
    assert.equal(desktopReuse.detail.desktopArtifact.build.serviceVersion, packed.kunNpm.runtimeSourceVersion ?? packed.version)
    if (options['desktop-data-receipt'])
      assert.equal(data.checks.find(check => check.id === 'DATA-02.uninstall-after-history-upgrade')?.status, 'pass')
    for (const receipt of receipts) {
      const origin = receipt.checks.find(check => check.id === 'DATA-01.historical-artifact-origin')
      assert.equal(origin?.status, 'pass', 'Missing genuine historical producer')
      const source = origin.detail.source
      assert.equal(origin.detail.createdByHistoricalBinary, true)
      assert.equal(source.publishedSource?.officialPublishedAsset, true)
      assert.equal(source.publishedSource.target, receipt.platform + '-' + receipt.arch)
      assert.equal(source.appVersion, '0.4.4')
      assert.equal(source.build.serviceVersion, '0.4.4')
      assert.equal(receipt.checks.find(check => check.id === 'DATA-02.old-reader-refuses-unsupported-schema')
        ?.detail?.readerVersion, source.build.serviceVersion)
      assert.equal(receipt.checks.find(check => check.id === 'DATA-02.uninstall-preserves-history')
        ?.detail?.includesAuthenticHistoricalProfile, true)
    }
    const gate = checkMatrix(receipts, release, { supplements: [global, desktop, ...(data === desktop ? [] : [data])] })
    result.gate = gate
    result.errors = gate.errors
    result.candidate = { ...manifest.artifact, localPath: resolve(options.candidate, manifest.artifact.filename) }
    result.platformArtifacts = manifest.platformArtifacts.map(artifact => ({ ...artifact,
      localPath: resolve(options.candidate, artifact.filename) }))
    result.sourceCommit = manifest.sourceCommit
    result.buildId = packed.kunNpm.buildId
    result.combinations = receipts.map(receipt => ({ platform: receipt.platform, arch: receipt.arch,
      node: receipt.nodeVersion, npm: receipt.npmVersion, os: receipt.os,
      checksPassed: receipt.checks.filter(check => check.status === 'pass').length,
      testDriverSourceCommit: receipt.isolation.testDriverSourceCommit,
      receipt: receipt.evidenceFile, sha256: receipt.evidenceSha256 }))
    result.supplementaryEvidence = [options['global-evidence'], options['desktop-receipt'], ...(options['desktop-data-receipt'] ? [options['desktop-data-receipt']] : [])]
    result.artifactReady = gate.complete && gate.success
    result.state = result.artifactReady ? 'artifact-ready-awaiting-publication' : 'incomplete'
    result.deferred = ['Namespace/publisher verification', 'Registry publication and installation acceptance', 'dist-tag promotion']
  } catch (error) {
    result.errors.push(String(error.stack ?? error))
  }
  await writeFile(options.output, JSON.stringify(result, null, 2) + '\n')
  return result
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = await collectGateEvidence(parseGateEvidenceArguments(process.argv.slice(2)))
  console.log(JSON.stringify(result, null, 2))
  if (!result.artifactReady) process.exitCode = 1
}
