'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  MAX_LOG_BYTES,
  PACKAGING_FAILURE_KINDS,
  classifyPackagingFailure
} = require('./packaging-failure-classifier.cjs')

test('classifies runner service failures separately from code failures', () => {
  const result = classifyPackagingFailure({
    platform: 'windows',
    log: 'Failed to resolve action download info: Service Unavailable'
  })
  assert.equal(result.kind, 'infrastructure')
  assert.equal(result.platform, 'win32')
  assert.equal(result.isLikelyCodeFailure, false)
  assert.match(result.localReproductionCommand, /rerun/)
})

test('classifies renderer and runtime smoke failures with focused commands', () => {
  assert.equal(classifyPackagingFailure({
    platform: 'linux',
    log: 'Timed out waiting for kun-extension guest target'
  }).kind, 'renderer-smoke')
  assert.equal(classifyPackagingFailure({
    platform: 'linux',
    log: 'backend health check failed after launch'
  }).kind, 'runtime-smoke')
})

test('reports artifact state and a platform-specific package command', () => {
  const result = classifyPackagingFailure({
    platform: 'win32',
    log: 'Error: expected artifact was not found',
    artifactExists: false,
    artifactPath: 'dist/Kun-0.1.0-win-x64.exe',
    lastSuccessfulStep: 'Build Windows installer'
  })
  assert.equal(result.kind, 'artifact-layout')
  assert.equal(result.artifactExists, false)
  assert.equal(result.artifactPath, 'dist/Kun-0.1.0-win-x64.exe')
  assert.equal(result.localReproductionCommand, 'npm.cmd run dist')
  assert.equal(result.lastSuccessfulStep, 'Build Windows installer')
})

test('redacts secrets and bounds large log summaries', () => {
  const result = classifyPackagingFailure({
    platform: 'darwin',
    log: `${'x'.repeat(MAX_LOG_BYTES + 100)}\nError: token=super-secret-value`
  })
  assert.ok(result.keyLog.every((line) => !line.includes('super-secret-value')))
  assert.ok(result.keyLog.every((line) => line.length <= 512))
})

test('keeps the classifier vocabulary stable', () => {
  assert.deepEqual(PACKAGING_FAILURE_KINDS, [
    'dependency-install', 'native-rebuild', 'typescript', 'unit-test', 'bundle',
    'electron-package', 'artifact-layout', 'runtime-smoke', 'renderer-smoke',
    'signature', 'notarization', 'cleanup', 'infrastructure'
  ])
})
