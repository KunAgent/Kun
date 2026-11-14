#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runSmoke } from './smoke-kun-npm.mjs'

const [directory, output, ...extra] = process.argv.slice(2)
assert(directory && output && !extra.length,
  'Usage: node scripts/run-kun-npm-artifact-smoke.mjs ARTIFACT_DIRECTORY RECEIPT')
const artifactRoot = resolve(directory)
assert.equal(`${process.platform}-${process.arch}`, process.env.KUN_NPM_EXPECTED_TARGET, 'Runner must have the requested native architecture')
assert.equal(process.versions.node, process.env.KUN_NPM_EXPECTED_NODE, 'Runner must use the exact requested Node version')
const driverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspace = process.env.GITHUB_WORKSPACE
assert(workspace, 'CI source-isolation acceptance requires GITHUB_WORKSPACE')
for (const root of [driverRoot, resolve(workspace)]) {
  for (const path of ['.git', 'drivers-checkout', 'kun/src', 'src', 'packages', 'node_modules']) {
    assert(!existsSync(resolve(root, path)), 'Source checkout/Git history must be removed before artifact execution: ' + path)
  }
}
const driver = JSON.parse(await readFile(resolve(driverRoot, 'driver-manifest.json'), 'utf8'))
assert.equal(driver.sourceCommit, process.env.GITHUB_SHA)
for (const [name, digest] of Object.entries(driver.files))
  assert.equal(createHash('sha256').update(await readFile(resolve(driverRoot, name))).digest('hex'), digest)
const manifest = JSON.parse(await readFile(resolve(artifactRoot, 'manifest.json'), 'utf8'))
assert.equal(manifest.kind, 'kun-npm-local-candidate')
assert.equal(manifest.published, false)
assert.equal(manifest.sourceCommit, driver.sourceCommit)
assert.equal(manifest.sourceDirty, false, 'CI must build a committed immutable source snapshot')
assert.equal(manifest.artifact.filename, basename(manifest.artifact.filename), 'Artifact must be a basename')
const tarball = resolve(artifactRoot, manifest.artifact.filename)
assert.equal(createHash('sha256').update(await readFile(tarball)).digest('hex'), manifest.artifact.sha256)
const receipt = await runSmoke({ tarball, output: resolve(output), integrations: true, lifecycle: true })
receipt.isolation = { ...receipt.isolation, sourceCheckoutRemoved: true, gitHistoryAvailable: false,
  exportedDriverVerified: true, sourceCommit: driver.sourceCommit, provider: 'github-actions' }
const { writeFile } = await import('node:fs/promises')
await writeFile(resolve(output), JSON.stringify(receipt, null, 2) + '\n')
if (!receipt.success) process.exitCode = 1
