import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

function currentNodeCanLoadSqlite() {
  try {
    const Database = require('better-sqlite3')
    const database = new Database(':memory:')
    database.close()
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/NODE_MODULE_VERSION|different Node\.js version/i.test(message)) return false
    throw error
  }
}

function resolveElectronExecutable() {
  try {
    const executable = require('electron')
    return typeof executable === 'string' && existsSync(executable) ? executable : null
  } catch {
    return null
  }
}

const vitest = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'vitest', 'vitest.mjs')
const doctorFiles = [
  'src/adapters/hybrid/hybrid-memory-store.test.ts',
  'src/adapters/hybrid/hybrid-thread-store.test.ts',
  'src/adapters/hybrid/hybrid-thread-index-write-failure.test.ts',
  'src/adapters/hybrid/hybrid-usage-backfill-sqlite.test.ts',
  'src/memory/memory-store-contract.test.ts',
  'tests/hybrid-store.test.ts',
  'tests/thread-store-doctor.test.ts',
  'tests/thread-store-doctor-race.test.ts',
  'src/manager/usage-query-runner.test.ts',
  'src/services/opencode-go-local-quota.test.ts'
]

function runVitest(executable, args, env = process.env) {
  const result = spawnSync(executable, [vitest, 'run', ...args], {
    cwd: process.cwd(),
    env,
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  if (result.signal) {
    process.stderr.write(`Kun tests terminated by ${result.signal}.\n`)
    return 1
  }
  return result.status ?? 1
}

const requested = process.argv.slice(2)
if (currentNodeCanLoadSqlite()) {
  process.exit(runVitest(process.execPath, requested))
}

// The desktop monorepo intentionally installs better-sqlite3 for Electron's
// ABI because Kun runs through ELECTRON_RUN_AS_NODE in production. Keep normal
// and child-process tests on system Node, and run only SQLite-backed doctor
// coverage on Electron Node. A standalone Kun checkout has a Node-ABI install
// and takes the simple path above.
const electron = resolveElectronExecutable()
if (!electron) {
  process.stderr.write(
    'Kun tests require a better-sqlite3 build matching Node, or the parent desktop Electron runtime.\n'
  )
  process.exit(1)
}
const electronEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }

if (requested.length === 0) {
  const nodeStatus = runVitest(process.execPath, doctorFiles.flatMap((file) => ['--exclude', file]))
  if (nodeStatus !== 0) process.exit(nodeStatus)
  process.exit(runVitest(electron, doctorFiles, electronEnv))
}

const requestedDoctorFiles = requested.filter((arg) => doctorFiles.some((file) => arg.endsWith(file)))
const requestedOptions = requested.filter((arg) => arg.startsWith('-'))
const requestedOtherFiles = requested.filter(
  (arg) => !arg.startsWith('-') && !doctorFiles.some((file) => arg.endsWith(file))
)

if (requestedDoctorFiles.length === 0) {
  process.exit(runVitest(process.execPath, requested))
}
if (requestedOtherFiles.length > 0) {
  const nodeStatus = runVitest(process.execPath, [...requestedOtherFiles, ...requestedOptions])
  if (nodeStatus !== 0) process.exit(nodeStatus)
}
process.exit(runVitest(electron, [...requestedDoctorFiles, ...requestedOptions], electronEnv))
