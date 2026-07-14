'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { buildPlan, parseArgs, run } = require('./ci-reproduce.cjs')

test('parses one explicit package job and dry-run flag', () => {
  assert.deepEqual(parseArgs(['--job', 'linux-package', '--dry-run']), {
    job: 'linux-package',
    dryRun: true
  })
})

test('rejects missing and unknown jobs', () => {
  assert.throws(() => parseArgs([]), /Missing required --job/)
  assert.throws(() => parseArgs(['--job', 'storybook']), /Unknown job/)
  assert.throws(() => parseArgs(['--job', 'linux-package', '--unexpected']), /Unknown argument/)
})

test('builds a fixed command plan for each supported platform job', () => {
  assert.deepEqual(buildPlan('windows-package', 'C:/repo').args, ['run', 'dist:win'])
  assert.deepEqual(buildPlan('macos-package', 'C:/repo').args, ['run', 'dist:mac'])
  assert.equal(buildPlan('linux-package', 'C:/repo').root, 'C:/repo')
})

test('dry-run reports missing prerequisites without executing a package command', () => {
  const exitCode = run(['--job', 'linux-package', '--dry-run'], 'C:/definitely-missing-kun-root')
  assert.equal(exitCode, 0)
})

test('real execution fails explicitly when prerequisites are missing', () => {
  const exitCode = run(['--job', 'linux-package'], 'C:/definitely-missing-kun-root')
  assert.equal(exitCode, 2)
})
