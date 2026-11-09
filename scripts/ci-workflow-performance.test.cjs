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
    if (name === 'windows-prepared-restart') {
      assert.deepEqual(job.strategy.matrix.source, ['published-release', 'pull-request'])
    } else {
      assert.deepEqual(job.strategy.matrix.include, [
        { source: 'published-release', baseline: '0.4.3' },
        { source: 'pull-request', baseline: '0.4.3' },
        { source: 'pull-request', baseline: '0.4.4' }
      ])
    }
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

test('current Windows stable upgrades the exact PR candidate with distinct evidence for every baseline', () => {
  const job = pr.jobs['windows-cross-version']
  const guard = job.steps.find(step => step.name === 'Require PR candidate newer than released baseline')
  assert.equal(guard.if, "matrix.source == 'pull-request'")
  const guardSource = /^node -e "(.*)"$/.exec(guard.run)?.[1]
  assert.ok(guardSource, 'Version guard must be a standalone failing Node step')
  const checkVersion = (version, baseline) => new Function('require', 'process', guardSource)(
    name => name === './package.json' ? { version } : require(name),
    { env: { GUI_UPGRADE_BASELINE: baseline } }
  )
  for (const baseline of ['0.4.3', '0.4.4']) {
    for (const version of ['0.4.5', '0.4.10', '0.5.0', '1.0.0']) checkVersion(version, baseline)
    for (const version of ['0.4.0', baseline]) {
      assert.throws(() => checkVersion(version, baseline), /must be newer/)
    }
    checkVersion(require('../package.json').version, baseline)
  }
  const download = job.steps.find(step => step.uses === 'actions/download-artifact@v4')
  assert.equal(download.if, "matrix.source == 'pull-request'")
  assert.equal(download.with.name, 'pr-windows-nsis-package')
  assert.equal(download.with.path, 'cross-version-candidate')
  assert.equal(download.with['run-id'], undefined)
  const smoke = job.steps.find(step => step.run?.includes('node scripts/smoke-gui-upgrade.cjs'))
  assert.match(smoke.run, /--directory cross-version-candidate --version \$version --baseline-version \$env:GUI_UPGRADE_BASELINE/)
  assert.match(smoke.run, /'published-release'\) \{ '0\.4\.4' \} else \{ node -p "require\('\.\/package.json'\).version" \}/)
  assert.match(smoke.run, /'published-release'\) \{ 'normal' \} else \{ 'normal,busy,rollback' \}/)
  const report = 'windows-cross-version-${{ matrix.baseline }}-${{ matrix.source }}.json'
  assert.ok(smoke.run.includes(`--report ${report}`))
  const stage = job.steps.find(step => step.id === 'stage_windows_evidence')
  assert.ok(stage.run.includes(`--report ${report}`))
  const upload = job.steps.find(step => step.uses === 'actions/upload-artifact@v4')
  assert.equal(upload.with.name, 'windows-cross-version-${{ matrix.baseline }}-${{ matrix.source }}')
  assert.ok(stage.run.includes(`--output ${upload.with.path}`))
  const expand = (template, row) => template.replace('${{ matrix.baseline }}', row.baseline)
    .replace('${{ matrix.source }}', row.source)
  for (const template of [job.name, report, upload.with.name, upload.with.path]) {
    assert.equal(new Set(job.strategy.matrix.include.map(row => expand(template, row))).size, 3)
  }
})
