'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { isAbsolute, join } = require('node:path')
const test = require('node:test')
const { parse } = require('yaml')
const {
  installerHelperPaths,
  installerSmokePath
} = require('./check-windows-installer-syntax.cjs')

const workflowDirectory = join(__dirname, '..', '.github', 'workflows')

function readWorkflow(file) {
  return parse(readFileSync(join(workflowDirectory, file), 'utf8'))
}

function stepByName(job, name) {
  return job.steps.find((step) => step.name === name)
}

function normalizedExpression(value) {
  return value.replace(/\s+/gu, ' ').trim()
}

test('Windows release jobs outlive their installer smoke timeout', () => {
  for (const file of ['pr-checks.yml', 'release.yml', 'daily-dev-prerelease.yml']) {
    const workflow = readWorkflow(file)
    const jobName = file === 'pr-checks.yml' ? 'package-windows' : 'build-windows'
    const job = workflow.jobs[jobName]
    const smoke = stepByName(job, 'Smoke Windows installer')

    assert.equal(job['timeout-minutes'], 240, `${file} ${jobName}`)
    assert.equal(smoke['timeout-minutes'], 180, `${file} installer smoke`)
    assert.ok(job['timeout-minutes'] > smoke['timeout-minutes'], `${file} timeout headroom`)
  }
})

test('stable release reruns quality gates on the merge commit before preparation', () => {
  const workflow = readWorkflow('release.yml')
  const quality = workflow.jobs.quality
  const prepare = workflow.jobs.prepare

  assert.equal(quality.name, 'Release quality gates')
  assert.equal(quality['timeout-minutes'], 45)
  assert.equal(normalizedExpression(quality.if), normalizedExpression(prepare.if))
  assert.deepEqual(prepare.needs, ['quality'])

  const checkout = stepByName(quality, 'Check out merge commit')
  assert.equal(checkout.uses, 'actions/checkout@v4')
  assert.equal(checkout.with.ref, '${{ github.event.pull_request.merge_commit_sha }}')
  assert.equal(checkout.with['fetch-depth'], 0)

  const commands = quality.steps.filter((step) => step.run).map((step) => step.run)
  assert.deepEqual(commands, [
    'npm ci',
    'npm run typecheck',
    'npm run lint',
    'npm test',
    'npm run audit:production'
  ])
})

test('PR quality catches production advisories before the stable release merge', () => {
  const workflow = readWorkflow('pr-checks.yml')
  const audit = stepByName(workflow.jobs.quality, 'Production dependency audit')

  assert.equal(audit.run, 'npm run audit:production')
})

test('stable Linux ARM64 packaging retains the proven PR timeout budget', () => {
  const workflow = readWorkflow('release.yml')

  assert.equal(workflow.jobs['build-linux-arm64']['timeout-minutes'], 180)
})

test('Windows installer syntax checks include the smoke script by absolute path', () => {
  assert.ok(installerHelperPaths.includes(installerSmokePath))
  assert.ok(installerHelperPaths.every(isAbsolute))
})

test('stable latest can only advance after native GUI candidate acceptance', () => {
  const release = readWorkflow('release.yml')
  assert.deepEqual(release.jobs['accept-and-publish'].needs, ['prepare', 'publish'])
  assert.equal(release.jobs['accept-and-publish'].uses, './.github/workflows/release-gui-acceptance.yml')
  assert.ok(release.jobs.publish.steps.every((step) => !step.run?.includes('promote')))
  const acceptance = readWorkflow('release-gui-acceptance.yml')
  assert.equal(acceptance.jobs.promote.needs, 'accept')
  const steps = acceptance.jobs.promote.steps
  const verify = steps.findIndex((step) => step.run?.includes('verify-public-release.mjs candidate'))
  const promote = steps.findIndex((step) => step.run?.includes('publish-r2.mjs promote'))
  const readback = steps.findIndex((step) => step.run?.includes('verify-public-release.mjs latest'))
  const publish = steps.findIndex((step) => step.name === 'Publish GitHub Release')
  assert.ok(verify >= 0 && promote > verify && readback > promote && publish > readback)
  assert.ok(steps.every((step) => step['continue-on-error'] !== true))
})

test('standalone TUI distribution is removed while GUI upgrade gates stay required', () => {
  const workflow = readWorkflow('pr-checks.yml')
  assert.ok(workflow.jobs['pr-gate'].needs.includes('gui-upgrade-windows'))
  assert.ok(workflow.jobs['pr-gate'].steps[0].with.script.includes('needs.gui-upgrade-windows.result'))
  for (const file of ['pr-checks.yml', 'release.yml', 'daily-dev-prerelease.yml']) {
    const current = readWorkflow(file)
    assert.equal(current.jobs['build-tui'], undefined)
    assert.equal(current.jobs['tui-release'], undefined)
    assert.equal(current.jobs['test-windows-self-update'], undefined)
    for (const job of Object.values(current.jobs)) {
      for (const step of job.steps ?? []) {
        assert.doesNotMatch(step.run ?? '', /package:tui|assemble:tui-release|smoke:standalone-tui|upload-tui|--require-tui/)
      }
    }
  }
  const promotion = readWorkflow('release-gui-acceptance.yml').jobs.promote.steps
    .find((step) => step.run?.includes('publish-r2.mjs promote'))
  assert.match(promotion.run, /--require-all-platforms/)
})
