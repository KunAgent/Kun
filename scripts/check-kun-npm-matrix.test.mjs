import test from 'node:test'
import assert from 'node:assert/strict'
import { ARTIFACT_CHECKS, checkMatrix } from './check-kun-npm-matrix.mjs'

const release = { targets: ['darwin-arm64', 'linux-x64'], testNodeVersions: ['26.4.0', '26.12.0'] }
function receipts() {
  return release.targets.flatMap(target => release.testNodeVersions.map(nodeVersion => {
    const [platform, arch] = target.split('-')
    return { schemaVersion: 1, platform, arch, nodeVersion, success: true,
      packageName: '@kun/agent', packageVersion: '0.4.5', tarballSha256: 'a'.repeat(64),
      buildId: 'b'.repeat(64), sourceCommit: 'c'.repeat(40),
      isolation: { sourceCheckoutRemoved: true, gitHistoryAvailable: false, exportedDriverVerified: true },
      checks: [...ARTIFACT_CHECKS,
        'NPM-01.project-install', 'NPM-01.global-install', 'NPM-02.payload',
        'NPM-03.locked-bundle', 'NPM-04.sqlite-native', 'NPM-05.help-version-update',
        'RUN-01.run-jsonl', 'RUN-05.http-thread-lifecycle', 'LIFE-01.owned-serve-exit',
        'NPM-04.runtime-index', 'RUN-04.pty-tui', 'RUN-04.pty-bare', 'RUN-04.pty-cancel',
        'LIFE-01.serve-shutdown-order', 'LIFE-01.tui-shutdown-order', 'LIFE-01.attached-shutdown-order',
        'LIFE-02.owner-loss-shutdown-order', 'LIFE-02.manager-readiness-failure'
      ].map(id => ({ id, status: 'pass' })) }
  }))
}

test('requires every native target and both Node versions', () => {
  assert.equal(checkMatrix(receipts(), release).success, true)
  assert.match(checkMatrix(receipts().slice(1), release).errors.join('\n'), /Missing target/)
})

test('complete gate can consume granular proof without inventing a passing summary id', () => {
  const values = receipts()
  for (const value of values) value.checks = value.checks.filter(check => check.id !== 'NPM-01')
  assert.equal(checkMatrix(values, release).success, true)
  values[0].checks.find(check => check.id === 'NPM-01.global-install').status = 'not-run'
  assert.match(checkMatrix(values, release).errors.join('\n'), /Incomplete NPM-01/)
})
test('cannot treat not-run checks, duplicate receipts or different artifacts as complete', () => {
  const values = receipts()
  values[0].checks[0].status = 'not-run'
  values[1].tarballSha256 = 'b'.repeat(64)
  const result = checkMatrix([...values, values[2]], release)
  assert.equal(result.success, false)
  assert.match(result.errors.join('\n'), /Incomplete NPM-01/)
  assert.match(result.errors.join('\n'), /identical main tarball/)
  assert.match(result.errors.join('\n'), /Duplicate receipt/)
})
test('smoke-only mode requires native commands and both real TUI entry points', () => {
  const values = receipts()
  values[0].checks[0].status = 'not-run'
  assert.equal(checkMatrix(values, release, { complete: false }).success, true)
  values[0].checks.find(check => check.id === 'RUN-04.pty-bare').status = 'not-run'
  const missingTui = checkMatrix(values, release, { complete: false })
  assert.equal(missingTui.success, false)
  assert.match(missingTui.errors.join('\n'), /Incomplete RUN-04.pty-bare/)
  values[0].checks.find(check => check.id === 'RUN-04.pty-bare').status = 'pass'
  values[0].success = false
  assert.equal(checkMatrix(values, release, { complete: false }).success, false)
})

test('a sparse source checkout with accessible Git history is not isolated acceptance', () => {
  const values = receipts()
  values[0].isolation.gitHistoryAvailable = true
  assert.match(checkMatrix(values, release, { complete: false }).errors.join('\n'), /Source isolation/)
})

test('Windows receipts require native corruption tests and actual ConPTY results', () => {
  const values = receipts().slice(0, 1)
  values[0].platform = 'win32'; values[0].arch = 'x64'
  const windows = { targets: ['win32-x64'], testNodeVersions: ['26.4.0'] }
  assert.match(checkMatrix(values, windows, { complete: false }).errors.join('\n'), /windows-native-job|ConPTY/)
})

test('JSON proof must come from the installed run mode and cannot borrow exec or JSONL', () => {
  const values = receipts()
  values[0].checks = values[0].checks.filter(check => check.id !== 'RUN-01')
  for (const id of ['RUN-01.run-json', 'RUN-01.prompt-file', 'RUN-01.stdin-chat'])
    values[0].checks.push({ id, status: 'pass' })
  assert.equal(checkMatrix(values, release).success, true)
  values[0].checks.find(check => check.id === 'RUN-01.run-json').status = 'not-run'
  assert.match(checkMatrix(values, release).errors.join('\n'), /Incomplete RUN-01/)
})

test('global evidence can complete the gate only for the same candidate and Runtime', () => {
  const values = receipts()
  for (const value of values) value.checks = value.checks.filter(check => !['GUI-01', 'DOC-01'].includes(check.id))
  assert.equal(checkMatrix(values, release).success, false)
  const supplement = { ...values[0], kind: 'kun-npm-global-artifact-evidence',
    checks: ['GUI-01', 'DOC-01'].map(id => ({ id, status: 'pass' })) }
  assert.equal(checkMatrix(values, release, { supplements: [supplement] }).success, true)
  supplement.tarballSha256 = 'd'.repeat(64)
  assert.match(checkMatrix(values, release, { supplements: [supplement] }).errors.join('\n'), /Supplementary evidence/)
  supplement.tarballSha256 = values[0].tarballSha256
  supplement.buildId = 'e'.repeat(64)
  assert.match(checkMatrix(values, release, { supplements: [supplement] }).errors.join('\n'), /Supplementary evidence/)
})

test('an explicit not-run history criterion cannot become a derived pass', () => {
  const values = receipts()
  for (const value of values) {
    value.checks.find(check => check.id === 'DATA-02').status = 'not-run'
    value.checks.push({ id: 'DATA-02.old-reader-refuses-unsupported-schema', status: 'pass' },
      { id: 'DATA-02.uninstall-preserves-history', status: 'pass' })
  }
  assert.match(checkMatrix(values, release).errors.join('\n'), /Incomplete DATA-02/)
})

test('an old namespace or stable version cannot certify the selected rc candidate', () => {
  const selected = { ...release, name: '@kunagent/agent', version: '0.4.5-rc.1' }
  const values = receipts()
  assert.match(checkMatrix(values, selected).errors.join('\n'), /Unexpected package name/)
  for (const value of values) value.packageName = selected.name
  assert.match(checkMatrix(values, selected).errors.join('\n'), /Unexpected package version/)
  for (const value of values) value.packageVersion = selected.version
  assert.equal(checkMatrix(values, selected).success, true)
})
