export const largeHistoryTest = 'src/manager/large-thread-mutations.test.ts'

// This regression intentionally moves >64 MiB through real HTTP and disk stores.
// Give it a dedicated process after the normal suite so parallel file workers do
// not compete for its memory/CPU budget. Keep every assertion and its 120s limit.
export function parseTestShard(value) {
  if (!value) return null
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(value)
  if (!match || Number(match[1]) > Number(match[2])) {
    throw new Error(`Invalid KUN_TEST_SHARD: ${value}; expected index/count`)
  }
  return { index: Number(match[1]), count: Number(match[2]) }
}

export function fullTestPlan(doctorFiles, electronSqlite = false, shard = null) {
  const shardArgs = shard ? [`--shard=${shard.index}/${shard.count}`] : []
  const largeHistory = !shard || shard.index === 1
    ? [{ runtime: electronSqlite ? 'electron' : 'node', args: [largeHistoryTest, '--maxWorkers=1'] }]
    : []
  if (!electronSqlite) return [
    { runtime: 'node', args: ['--exclude', largeHistoryTest, ...shardArgs] },
    ...largeHistory
  ]
  return [
    { runtime: 'node', args: [...doctorFiles.flatMap(file => ['--exclude', file]), ...shardArgs] },
    { runtime: 'electron', args: [...doctorFiles.filter(file => file !== largeHistoryTest), ...shardArgs] },
    ...largeHistory
  ]
}
