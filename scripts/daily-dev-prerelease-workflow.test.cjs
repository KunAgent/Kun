'use strict'

const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')
const { parse } = require('yaml')

const root = join(__dirname, '..')
const workflowDirectory = join(root, '.github', 'workflows')

function readWorkflow(file) {
  return parse(readFileSync(join(workflowDirectory, file), 'utf8'))
}

test('daily prerelease schedule delegates to the develop implementation', () => {
  const workflow = readWorkflow('daily-dev-prerelease-schedule.yml')

  assert.deepEqual(workflow.on, {
    workflow_dispatch: null,
    schedule: [{ cron: '0 4,16 * * *' }]
  })
  assert.deepEqual(workflow.permissions, { contents: 'write' })
  assert.deepEqual(workflow.concurrency, {
    group: 'daily-dev-prerelease',
    'cancel-in-progress': false
  })
  assert.deepEqual(Object.keys(workflow.jobs), ['release'])

  const release = workflow.jobs.release
  assert.equal(release.uses, 'KunAgent/Kun/.github/workflows/daily-dev-prerelease.yml@develop')
  assert.equal(release.secrets, 'inherit')
  assert.equal(release['runs-on'], undefined)
  assert.equal(release.steps, undefined)
})

test('daily prerelease implementation is callable and keeps version preparation dependency-free', (t) => {
  const workflow = readWorkflow('daily-dev-prerelease.yml')

  assert.deepEqual(workflow.on, { workflow_call: null })
  assert.equal(workflow.concurrency, undefined)
  assert.deepEqual(workflow.permissions, { contents: 'write' })

  const prepare = workflow.jobs.prepare
  const checkout = prepare.steps.find((step) => step.name === 'Check out develop')
  assert.equal(checkout.uses, 'actions/checkout@v4')
  assert.equal(checkout.with.ref, 'develop')
  assert.equal(checkout.with['fetch-depth'], 0)

  const compute = prepare.steps.find((step) => step.id === 'version')
  assert.equal(compute.name, 'Compute dev version')
  assert.doesNotMatch(compute.run, /\brequire\s*\(/u)
  assert.doesNotMatch(compute.run, /\bnpm\s+(?:ci|install)\b/u)

  const fixture = mkdtempSync(join(tmpdir(), 'kun-daily-prerelease-'))
  t.after(() => rmSync(fixture, { force: true, recursive: true }))
  execFileSync('git', ['init', '--quiet'], { cwd: fixture })
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Kun CI',
      '-c',
      'user.email=kun-ci@example.invalid',
      'commit',
      '--allow-empty',
      '--quiet',
      '-m',
      'fixture'
    ],
    { cwd: fixture }
  )

  const outputPath = join(fixture, 'github-output')
  execFileSync('bash', ['-c', compute.run], {
    cwd: fixture,
    env: {
      ...process.env,
      GITHUB_OUTPUT: outputPath,
      TZ: 'Asia/Shanghai'
    }
  })

  const outputs = Object.fromEntries(
    readFileSync(outputPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => {
        const separator = line.indexOf('=')
        return [line.slice(0, separator), line.slice(separator + 1)]
      })
  )
  const expectedHead = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: fixture,
    encoding: 'utf8'
  }).trim()

  assert.match(outputs.dev_version, /^\d{8}\.\d{4}$/u)
  assert.equal(outputs.app_version, `0.0.0-dev-${outputs.dev_version.replace('.', '-')}`)
  assert.equal(outputs.tag, `dev-${outputs.dev_version}`)
  assert.equal(outputs.release_name, `Kun Dev ${outputs.dev_version}`)
  assert.equal(outputs.head_sha, expectedHead)
})
