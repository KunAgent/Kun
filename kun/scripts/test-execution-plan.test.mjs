import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fullTestPlan, largeHistoryTest } from './test-execution-plan.mjs'

const doctorFiles = [largeHistoryTest, 'tests/hybrid-store.test.ts', 'tests/thread-store-doctor.test.ts']

test('runs the full Node suite then the unchanged large history regression exactly once', () => {
  assert.deepEqual(fullTestPlan(doctorFiles), [
    { runtime: 'node', args: ['--exclude', largeHistoryTest] },
    { runtime: 'node', args: [largeHistoryTest, '--maxWorkers=1'] }
  ])
})

test('retains all SQLite coverage on Electron and isolates only the large history regression', () => {
  const plan = fullTestPlan(doctorFiles, true)
  assert.deepEqual(plan[0], { runtime: 'node', args: doctorFiles.flatMap(file => ['--exclude', file]) })
  assert.deepEqual(plan[1], { runtime: 'electron', args: doctorFiles.slice(1) })
  assert.deepEqual(plan[2], { runtime: 'electron', args: [largeHistoryTest, '--maxWorkers=1'] })
  assert.deepEqual(plan.slice(1).flatMap(step => step.args.filter(arg => !arg.startsWith('--'))).sort(),
    [...doctorFiles].sort())
})
