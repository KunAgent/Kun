'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const { parse } = require('yaml')
const workflow = name => parse(readFileSync(join(__dirname, '../.github/workflows', name), 'utf8'))
const pr = workflow('pr-checks.yml')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

async function changes(files, count = files.length) {
  let output
  const script = pr.jobs.changes.steps[0].with.script
  await new AsyncFunction('context', 'github', 'core', script)(
    { repo: { owner: 'fixture', repo: 'fixture' }, payload: { pull_request: { number: 1, changed_files: count } } },
    { rest: { pulls: { listFiles() {} } }, paginate: async () => files },
    { setOutput: (_, value) => { output = value }, summary: { addRaw: () => ({ write() {} }) } }
  )
  return output
}

function gate(results, ci = 'true') {
  const script = pr.jobs['pr-gate'].steps[0].with.script.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, key) => {
    if (key === 'needs.changes.outputs.ci') return ci
    const match = /^needs(?:\.([\w-]+)|\['([\w-]+)'\])\.result$/.exec(key)
    assert.ok(match, key)
    return results[match[1] || match[2]]
  })
  let failure
  new Function('core', script)({ setFailed: message => { failure = message } })
  return failure
}

test('documentation filtering never leaves the stable PR gate absent', async () => {
  assert.equal(pr.on.pull_request['paths-ignore'], undefined)
  assert.equal(pr.on.pull_request.paths, undefined)
  assert.equal(pr.jobs['pr-gate'].name, 'PR gate')
  assert.equal(pr.jobs['pr-gate'].if, 'always()')
  assert.equal(await changes([{ filename: 'README.md' }, { filename: 'docs/architecture.md' }]), 'false')
  assert.equal(await changes([{ filename: 'README.zh-CN.md' }]), 'false')
  for (const filename of ['src/main/index.ts', 'README.ts', 'resources/bundled-skills/tool/SKILL.md', '.github/workflows/pr-checks.yml', 'package.json']) {
    assert.equal(await changes([{ filename }]), 'true', filename)
  }
  assert.equal(await changes([{ filename: 'docs/removed.ts', previous_filename: 'src/main/removed.ts' }]), 'true')
  assert.equal(await changes([{ filename: 'docs/readme.md' }], 3001), 'true')
  assert.equal(await changes([{ filename: 'docs/readme.md' }], 2), 'true')
  assert.equal(await changes([]), 'true')
})

test('PR gate accepts only verified docs skips and rejects every code-job failure or skip', () => {
  const jobs = pr.jobs['pr-gate'].needs
  const success = Object.fromEntries(jobs.map(name => [name, 'success']))
  assert.equal(gate(success), undefined)
  for (const name of jobs) {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      assert.ok(gate({ ...success, [name]: result }), `${name}: ${result}`)
    }
  }
  const docs = Object.fromEntries(jobs.map(name => [name, name === 'changes' ? 'success' : 'skipped']))
  assert.equal(gate(docs, 'false'), undefined)
  assert.ok(gate({ ...docs, changes: 'failure' }, 'false'))
  assert.ok(gate({ ...docs, tests: 'failure' }, 'false'))
})

test('independent packaging and platform safety tests remain required but do not wait on each other', () => {
  for (const name of ['quality', 'package', 'package-linux-arm64', 'package-macos', 'package-windows', 'windows-recovery', 'tests']) {
    assert.equal(pr.jobs[name].needs, 'changes', name)
    assert.equal(pr.jobs[name].if, "needs.changes.outputs.ci == 'true'", name)
    assert.ok(pr.jobs['pr-gate'].needs.includes(name))
  }
  assert.equal(pr.concurrency['cancel-in-progress'], "${{ github.event_name == 'pull_request' }}")
  assert.equal(workflow('release.yml').concurrency['cancel-in-progress'], false)
  assert.equal(workflow('release.yml').concurrency.queue, 'max')
  assert.equal(workflow('daily-dev-prerelease-schedule.yml').concurrency['cancel-in-progress'], false)
})

test('settings smoke retains failure evidence but releases runners on superseding cancellation', () => {
  const job = workflow('settings-ui-smoke.yml').jobs['native-settings']
  assert.deepEqual(job.strategy.matrix.os, ['windows-latest', 'macos-latest'])
  const final = job.steps.find(step => step.name === 'Verify real final source and capture screenshots')
  assert.equal(final.if, 'always() && !cancelled()')
  const evidence = job.steps.filter(step => step.if?.includes('always()'))
  assert.equal(evidence.length, 5)
  for (const step of evidence) assert.equal(step.if, final.if)
  const evaluate = new Function('always', 'cancelled', `return ${final.if}`)
  assert.equal(evaluate(() => true, () => false), true)
  assert.equal(evaluate(() => true, () => true), false)
})

test('shared Ubuntu test matrix covers every original npm test component with four GUI and Kun shards', () => {
  const shared = workflow('ci-tests.yml')
  assert.deepEqual(shared.jobs.vitest.strategy.matrix, { suite: ['gui', 'kun'], shard: [1, 2, 3, 4] })
  assert.equal(shared.jobs.vitest.strategy['fail-fast'], false)
  for (const job of Object.values(shared.jobs)) assert.equal(job['runs-on'], 'ubuntu-latest')
  const commands = shared.jobs.scripts.steps.map(step => step.run).filter(Boolean)
  assert.ok(commands.indexOf('npm run build:extensions') >= 0)
  assert.ok(commands.indexOf('npm run build:extensions') < commands.indexOf('npm run test:extensions'))
  for (const command of ['npm run test:extensions', 'npm run test:packaging', 'npm run test:release-workflows', 'npm --prefix kun run test:scripts']) {
    assert.ok(commands.includes(command), command)
  }
  const steps = shared.jobs.vitest.steps
  assert.equal(steps.find(step => step.name === 'GUI unit tests').run, 'npx vitest run --shard=${{ matrix.shard }}/4')
  const kun = steps.find(step => step.name === 'Kun unit tests with native ABI routing')
  assert.equal(kun.run, 'node scripts/run-tests.mjs')
  assert.equal(kun.env.KUN_TEST_SHARD, '${{ matrix.shard }}/4')
  assert.equal(pr.jobs.tests.uses, './.github/workflows/ci-tests.yml')
  const release = workflow('release.yml')
  assert.ok(release.jobs.prepare.needs.includes('tests'))
  assert.equal(release.jobs.tests.uses, pr.jobs.tests.uses)
  assert.equal(release.jobs.tests.if, release.jobs.quality.if)
})

test('parallel packaging preserves required cross-version and prepared-restart candidate gates', () => {
  for (const name of ['windows-cross-version', 'windows-prepared-restart']) {
    const job = pr.jobs[name]
    assert.deepEqual(job.needs, ['package-windows'])
    assert.equal(job.if, undefined)
    assert.equal(job['continue-on-error'], "${{ matrix.source == 'published-release' }}")
    assert.deepEqual(job.strategy.matrix.source, ['published-release', 'pull-request'])
    assert.equal(job.strategy['fail-fast'], false)
    for (const gateName of ['pr-gate', 'report-pr-check-feedback']) {
      assert.ok(pr.jobs[gateName].needs.includes(name))
      assert.ok(pr.jobs[gateName].steps[0].with.script.includes(`needs['${name}'].result`))
    }
    const download = job.steps.find(step => step.name === 'Download exact PR candidate from this run')
    assert.equal(download.with.name, 'pr-windows-nsis-package')
  }
  const restart = pr.jobs['windows-prepared-restart'].steps.find(step => step.run?.includes('$protection'))
  assert.match(restart.run, /--require-pending-protection', 'true'/)
  assert.match(restart.run, /@protection/)
  const scripts = require('../package.json').scripts
  assert.ok(scripts['test:packaging'].includes('./scripts/bundled-pets.test.cjs'))
  for (const name of ['build-app', 'ci-workflow-performance', 'smoke-windows-installer-pending-protection',
    'smoke-windows-installer-relaunch', 'stage-windows-upgrade-evidence']) {
    assert.ok(scripts['test:release-workflows'].includes(`./scripts/${name}.test.cjs`), name)
  }
})
