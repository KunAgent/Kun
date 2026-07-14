'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { evaluateNativeSmoke, normalizePath } = require('./native-smoke-path-gate.cjs')

test('normalizes Windows separators and duplicate paths', () => {
  assert.equal(normalizePath('.\\src\\main\\index.ts'), 'src/main/index.ts')
  assert.deepEqual(evaluateNativeSmoke([
    '.\\src\\main\\index.ts',
    'src/main/index.ts'
  ]).changedPaths, ['src/main/index.ts'])
})

test('requires native smoke for all high-risk path families', () => {
  for (const path of [
    'src/main/index.ts',
    'src/preload/index.ts',
    'electron-builder.config.cjs',
    'scripts/after-pack.cjs',
    'assets/icons/icon.png',
    'kun/src/config/provider.ts',
    'package-lock.json'
  ]) {
    const result = evaluateNativeSmoke([path])
    assert.equal(result.decision, 'native-smoke-required', path)
    assert.equal(result.required, true, path)
    assert.ok(result.matches.length > 0, path)
  }
})

test('skips native smoke for documentation-only changes with an explicit reason', () => {
  const result = evaluateNativeSmoke(['README.md', 'docs/architecture.md'])
  assert.equal(result.decision, 'native-smoke-skipped-with-reason')
  assert.equal(result.required, false)
  assert.match(result.reason, /do not affect/i)
  assert.deepEqual(result.matches, [])
})

test('manual dispatch and force always require smoke', () => {
  assert.equal(evaluateNativeSmoke(['README.md'], { event: 'workflow_dispatch' }).required, true)
  assert.equal(evaluateNativeSmoke(['README.md'], { force: true }).required, true)
})

test('reports every matched rule without duplicate entries', () => {
  const result = evaluateNativeSmoke(['src/main/runtime.ts', 'src/main/runtime.ts', 'kun/src/server.ts'])
  assert.equal(result.matches.length, 2)
  assert.deepEqual(result.matches.map((match) => match.ruleId), ['main', 'kun-runtime'])
})

test('empty or invalid input is a safe skip, never an accidental pass', () => {
  const result = evaluateNativeSmoke([null, '', undefined])
  assert.equal(result.required, false)
  assert.equal(result.decision, 'native-smoke-skipped-with-reason')
  assert.equal(result.reason, 'no changed paths were supplied')
})
