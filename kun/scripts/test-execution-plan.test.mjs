import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fullTestPlan, largeHistoryTest, parseTestShard } from './test-execution-plan.mjs'

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

test('four shards retain ABI routing and run the isolated history regression exactly once', () => {
  for (const electron of [false, true]) {
    const plans = [1, 2, 3, 4].map(index => fullTestPlan(doctorFiles, electron, { index, count: 4 }))
    const history = plans.flat().filter(step => step.args[0] === largeHistoryTest)
    assert.deepEqual(history, [{ runtime: electron ? 'electron' : 'node', args: [largeHistoryTest, '--maxWorkers=1'] }])
    for (const [index, plan] of plans.entries()) {
      const ordinary = plan.filter(step => step.args[0] !== largeHistoryTest)
      assert.equal(ordinary.length, electron ? 2 : 1)
      for (const step of ordinary) assert.ok(step.args.includes(`--shard=${index + 1}/4`))
      assert.equal(ordinary[0].runtime, 'node')
      assert.ok(ordinary[0].args.includes('--exclude'))
      if (electron) assert.equal(ordinary[1].runtime, 'electron')
    }
  }
})

test('shard configuration fails closed instead of silently omitting tests', () => {
  assert.equal(parseTestShard(undefined), null)
  assert.deepEqual(parseTestShard('2/4'), { index: 2, count: 4 })
  for (const value of ['0/4', '5/4', '1/0', '-1/4', '1', '1/4junk']) {
    assert.throws(() => parseTestShard(value), /Invalid KUN_TEST_SHARD/)
  }
})
