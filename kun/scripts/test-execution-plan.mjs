export const largeHistoryTest = 'src/manager/large-thread-mutations.test.ts'

// This regression intentionally moves >64 MiB through real HTTP and disk stores.
// Give it a dedicated process after the normal suite so parallel file workers do
// not compete for its memory/CPU budget. Keep every assertion and its 120s limit.
export function fullTestPlan(doctorFiles, electronSqlite = false) {
  if (!electronSqlite) return [
    { runtime: 'node', args: ['--exclude', largeHistoryTest] },
    { runtime: 'node', args: [largeHistoryTest, '--maxWorkers=1'] }
  ]
  return [
    { runtime: 'node', args: doctorFiles.flatMap(file => ['--exclude', file]) },
    { runtime: 'electron', args: doctorFiles.filter(file => file !== largeHistoryTest) },
    { runtime: 'electron', args: [largeHistoryTest, '--maxWorkers=1'] }
  ]
}
