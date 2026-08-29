'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const { parse } = require('yaml')

const root = join(__dirname, '..')
const workflows = [
  ['release', 'release.yml'],
  ['pr', 'pr-checks.yml'],
  ['daily', 'daily-dev-prerelease.yml']
]

function windowsJob(workflow) {
  return workflow.jobs['build-windows'] ?? workflow.jobs['package-windows']
}

test('release workflows preserve Windows transaction diagnostics immediately after the test', () => {
  for (const [label, file] of workflows) {
    const workflow = parse(readFileSync(join(root, '.github', 'workflows', file), 'utf8'))
    const steps = windowsJob(workflow).steps
    const testIndex = steps.findIndex((step) => step.name === 'Test Windows update rollback failpoints')
    assert.ok(testIndex >= 0, `${label} is missing the transaction test`)
    const testStep = steps[testIndex]
    assert.equal(
      testStep.env.KUN_INSTALLER_TEST_ARTIFACT_ROOT,
      '${{ github.workspace }}\\artifacts\\windows-installer-transaction'
    )
    const upload = steps[testIndex + 1]
    assert.equal(upload.name, 'Upload Windows transaction diagnostics')
    assert.equal(upload.if, 'always()')
    assert.equal(upload.uses, 'actions/upload-artifact@v4')
    const paths = String(upload.with.path)
    for (const evidence of [
      'diagnostic.log',
      'journal.json',
      'transaction.json',
      'result-*.txt',
      'fixture-summary.json'
    ]) assert.ok(paths.includes(evidence), `${label} upload omits ${evidence}`)
  }
})

test('release workflows prefer SUID sandbox and only authorize helper-controlled CI fallback', () => {
  for (const [label, file] of workflows) {
    const source = readFileSync(join(root, '.github', 'workflows', file), 'utf8')
    const workflow = parse(source)
    const linuxJobs = Object.values(workflow.jobs).filter((job) =>
      job.steps?.some((step) => String(step.name).startsWith('Smoke packaged update handoff (Linux'))
    )
    for (const job of linuxJobs) {
      for (const step of job.steps.filter((candidate) => String(candidate.name).startsWith('Smoke packaged update handoff (Linux'))) {
        assert.equal(step.env?.KUN_CI_ALLOW_NO_SANDBOX, '1', `${label} must explicitly authorize fallback`)
        assert.equal(step.env?.KUN_CI_NO_SANDBOX_ACTIVE, undefined, `${label} must not activate fallback directly`)
      }
    }
    for (const resources of ['dist/linux-unpacked/resources', 'dist/linux-arm64-unpacked/resources']) {
      const configure = `node ./scripts/configure-linux-chrome-sandbox.cjs --resources ${resources}`
      const smoke = `npm run smoke:packaged-update-handoff -- --resources ${resources}`
      const configureIndex = source.indexOf(configure)
      assert.ok(configureIndex >= 0, `${label} omits SUID setup for ${resources}`)
      assert.ok(source.indexOf(smoke, configureIndex) > configureIndex, `${label} is not SUID-first`)
    }
    assert.doesNotMatch(source, /KUN_CI_NO_SANDBOX_ACTIVE:\s*['"]?1|--no-sandbox/u)
  }
})
