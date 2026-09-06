'use strict'

const assert = require('node:assert/strict')
const { EventEmitter, once } = require('node:events')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const {
  NEGATIVE_SCENARIOS,
  POSITIVE_SCENARIOS,
  RECYCLED_PID_SCENARIOS,
  buildSmokeSettings,
  parseSmokeMarker,
  predecessorBuildId,
  processIsAlive,
  runtimeBuildIdForFlavor,
  spawnTracked,
  waitForPredecessorOwners
} = require('./smoke-packaged-update-handoff-support.cjs')
const {
  FAILED_PREFIX,
  READY_PREFIX,
  positiveIntegerArgument
} = require('./smoke-packaged-update-handoff.cjs')
const {
  platformDesktopArguments
} = require('./smoke-packaged-extension-desktop-runtime.cjs')

test('release matrix covers both update paths, active work, and auto-start off', () => {
  assert.deepEqual(POSITIVE_SCENARIOS.map((scenario) => scenario.name), [
    'external-auto-on-active',
    'in-app-auto-on',
    'external-auto-off'
  ])
  assert(POSITIVE_SCENARIOS.some((scenario) => scenario.path === 'external'))
  assert(POSITIVE_SCENARIOS.some((scenario) => scenario.path === 'in-app'))
  assert(POSITIVE_SCENARIOS.some((scenario) => scenario.activeWork))
  assert(POSITIVE_SCENARIOS.some((scenario) => scenario.autoStart === false))
})

test('negative release matrix names every fail-closed ownership case', () => {
  assert.deepEqual(NEGATIVE_SCENARIOS, [
    'changed-discovery-identity',
    'inspection-denied'
  ])
})

test('recycled PID release matrix proves exact stale coordination cleanup', () => {
  assert.deepEqual(RECYCLED_PID_SCENARIOS, [
    'runtime-discovery-and-manager-slot'
  ])
})

test('recycled PID helper does not advertise itself as a Runtime data-dir owner', () => {
  const source = readFileSync(
    join(process.cwd(), 'scripts/smoke-packaged-update-handoff-recycled.cjs'),
    'utf8'
  )
  assert.match(source, /'--fixture-data-dir', profile\.dataDir/u)
  assert.doesNotMatch(source, /'--data-dir', profile\.dataDir/u)
})

test('synthetic predecessor and development flavor use distinct stable build IDs', () => {
  const candidate = 'b'.repeat(64)
  const predecessor = predecessorBuildId(candidate)
  assert.match(predecessor, /^[a-f0-9]{64}$/u)
  assert.notEqual(predecessor, candidate)
  assert.equal(runtimeBuildIdForFlavor(predecessor, 'production'), predecessor)
  assert.match(runtimeBuildIdForFlavor(predecessor, 'development'), /^[a-f0-9]{64}$/u)
  assert.notEqual(runtimeBuildIdForFlavor(predecessor, 'development'), predecessor)
})

function predecessorOwners() {
  const owner = (flavor) => ({
    ...(flavor ? { flavor } : {}),
    discovery: { pid: process.pid },
    process: {
      child: Object.assign(new EventEmitter(), {
        pid: process.pid,
        exitCode: 0,
        signalCode: null,
        killed: false
      })
    }
  })
  return { manager: owner(), runtimes: [owner('production'), owner('development')] }
}

test('predecessor exit uses the original child even when its PID is occupied again', async () => {
  const owners = predecessorOwners()
  // Deterministically model PID reuse with the still-live test runner's PID.
  assert.equal(processIsAlive(owners.runtimes[1].discovery.pid), true)
  await waitForPredecessorOwners(owners, 1_000)
})

for (const role of ['manager', 'production', 'development']) {
  test(`handoff still rejects a live predecessor ${role}`, async () => {
    const owners = predecessorOwners()
    const owner = role === 'manager'
      ? owners.manager
      : owners.runtimes.find((entry) => entry.flavor === role)
    owner.process.child.exitCode = null
    // Sending a signal is not proof that the process has exited.
    owner.process.child.killed = true
    await assert.rejects(waitForPredecessorOwners(owners, 10), (error) => {
      assert.match(error.message, /Timed out waiting for the predecessor Manager and Runtimes to exit/u)
      assert(error.message.includes(`${role} PID ${process.pid}: running`))
      return true
    })
  })
}

test('handoff waits for a delayed original child exit without requiring stream closure', async () => {
  const owners = predecessorOwners()
  const child = owners.runtimes[1].process.child
  child.exitCode = null
  const result = waitForPredecessorOwners(owners, 1_000)
  queueMicrotask(() => {
    child.exitCode = 0
    child.emit('exit', 0, null)
  })
  await result
})

test('handoff accepts a recorded signal exit and nonzero exit as terminated', async () => {
  const owners = predecessorOwners()
  owners.manager.process.child.exitCode = 1
  owners.runtimes[1].process.child.exitCode = null
  owners.runtimes[1].process.child.signalCode = 'SIGTERM'
  await waitForPredecessorOwners(owners, 1_000)
})

test('handoff observes a real child exit without stopping it on behalf of the candidate', async (t) => {
  const tracked = spawnTracked(process.execPath, ['-e',
    "process.stdin.resume(); process.stdout.write('ready'); process.stdin.once('data', () => process.exit(0))"
  ], { stdio: ['pipe', 'pipe', 'pipe'] })
  const child = tracked.child
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit')
    child.kill()
    await exited
  })
  await once(child.stdout, 'data')
  const owners = predecessorOwners()
  owners.runtimes[1] = { flavor: 'development', discovery: { pid: child.pid }, process: tracked }
  let completed = false
  const result = waitForPredecessorOwners(owners, 5_000).then(() => { completed = true })
  await Promise.resolve()
  assert.equal(completed, false)
  child.stdin.end('stop')
  await result
  assert.equal(child.exitCode, 0)
  assert.equal(child.killed, false)
})

test('both update paths verify the exact predecessors instead of probing reusable PIDs', () => {
  const source = readFileSync(join(process.cwd(), 'scripts/smoke-packaged-update-handoff.cjs'), 'utf8')
  const positive = source.slice(
    source.indexOf('async function runPositiveScenario'),
    source.indexOf('async function runNegativeScenario')
  )
  const preflightCheck = positive.indexOf('await waitForPredecessorOwners(owners, input.timeoutMs)')
  assert(preflightCheck > positive.indexOf("marker?.postcondition !== 'drained'"))
  assert(preflightCheck < positive.indexOf('const candidateDesktop = launchCandidate'))
  assert.doesNotMatch(positive, /processIsAlive\(pid\)/u)
  const wait = source.slice(
    source.indexOf('async function waitForCurrentOwners'),
    source.indexOf('async function assertChatRoundTrip')
  )
  assert.match(wait, /await waitForPredecessorOwners\(input.oldOwners, input.timeoutMs\)/u)
  assert.doesNotMatch(wait, /processIsAlive/u)
})

test('profile settings preserve explicit auto-start policy and canonical data scope', () => {
  const settings = buildSmokeSettings({
    dataDir: '/profile/data',
    port: 18899,
    runtimeToken: 'token',
    workspaceRoot: '/workspace',
    baseUrl: 'http://127.0.0.1:4000',
    autoStart: false
  })
  assert.equal(settings.agents.kun.autoStart, false)
  assert.equal(settings.agents.kun.dataDir, '/profile/data')
  assert.equal(settings.agents.kun.port, 18899)
})

test('acceptance and recovery markers are machine-readable', () => {
  assert.deepEqual(parseSmokeMarker(
    `noise\n${READY_PREFIX}{"postcondition":"drained"}\n`,
    READY_PREFIX
  ), { postcondition: 'drained' })
  assert.deepEqual(parseSmokeMarker(
    `${FAILED_PREFIX}{"retryable":false,"phase":"stop-runtimes"}\n`,
    FAILED_PREFIX
  ), { retryable: false, phase: 'stop-runtimes' })
})

test('timeout parser rejects invalid release gate values', () => {
  const original = process.argv
  try {
    process.argv = ['node', 'smoke', '--timeout-ms', '0']
    assert.throws(() => positiveIntegerArgument('--timeout-ms', 100), /positive integer/)
    process.argv = ['node', 'smoke']
    assert.equal(positiveIntegerArgument('--timeout-ms', 100), 100)
  } finally {
    process.argv = original
  }
})

test('handoff child early exit writes buffered output to stderr immediately', () => {
  const source = readFileSync(join(process.cwd(), 'scripts/smoke-packaged-update-handoff.cjs'), 'utf8')
  assert.match(source, /child\.once\('exit'/u)
  assert.match(source, /process\.stderr\.write\([\s\S]*desktop\.output\(\)/u)
})

test('positive handoff uses a normal GUI quit before checking owned process lifecycles', () => {
  const source = readFileSync(join(process.cwd(), 'scripts/smoke-packaged-update-handoff.cjs'), 'utf8')
  const positiveScenario = source.slice(
    source.indexOf('async function runPositiveScenario'),
    source.indexOf('async function runNegativeScenario')
  )
  assert.match(positiveScenario, /await quitDesktopNormally\(candidateDesktop,/u)
  assert.doesNotMatch(positiveScenario, /terminateProcessTree/u)
  assert.match(source, /await sendToWorkbenchSession\(\{/u)
  assert.match(source, /window\.kunGui\.runDesktopCommand\('quit'\)/u)
  assert.match(source, /finally \{\s*processExit\.dispose\(\)\s*\}/u)
  assert.match(source, /managerJson\(current\.manager, '\/v1\/manager\/status'\)/u)
  assert.match(source, /waitForProcessExit\(current\.runtime\.pid/u)
})

test('Linux release handoff gates exercise the Chromium sandbox', () => {
  for (const workflow of [
    '.github/workflows/release.yml',
    '.github/workflows/pr-checks.yml',
    '.github/workflows/daily-dev-prerelease.yml'
  ]) {
    const source = readFileSync(join(process.cwd(), workflow), 'utf8')
    assert.match(source, /KUN_CI_ALLOW_NO_SANDBOX/u)
    assert.doesNotMatch(source, /KUN_CI_NO_SANDBOX_ACTIVE:\s*['"]?1|--no-sandbox/u)
    assert.match(source, /configure-linux-chrome-sandbox\.cjs/u)
    assert.match(source, /kernel\.apparmor_restrict_unprivileged_userns=0/u)
  }
})

test('linux desktop smoke keeps the sandbox on unless CI explicitly opts out', () => {
  assert.deepEqual(platformDesktopArguments('linux'), ['--disable-gpu', '--disable-dev-shm-usage'])
  assert.deepEqual(platformDesktopArguments('darwin'), [])
  assert.deepEqual(platformDesktopArguments('win32'), [])

  const previousCi = process.env.CI
  const previousAuthorization = process.env.KUN_CI_ALLOW_NO_SANDBOX
  const previousActive = process.env.KUN_CI_NO_SANDBOX_ACTIVE
  try {
    process.env.KUN_CI_ALLOW_NO_SANDBOX = '1'
    delete process.env.KUN_CI_NO_SANDBOX_ACTIVE
    delete process.env.CI
    assert.deepEqual(platformDesktopArguments('linux'), ['--disable-gpu', '--disable-dev-shm-usage'])
    process.env.CI = 'true'
    assert.deepEqual(platformDesktopArguments('linux'), ['--disable-gpu', '--disable-dev-shm-usage'])
    process.env.KUN_CI_NO_SANDBOX_ACTIVE = '1'
    assert.deepEqual(platformDesktopArguments('linux'), [
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-sandbox'
    ])
    assert.deepEqual(platformDesktopArguments('darwin'), [])
  } finally {
    if (previousCi === undefined) delete process.env.CI
    else process.env.CI = previousCi
    if (previousAuthorization === undefined) delete process.env.KUN_CI_ALLOW_NO_SANDBOX
    else process.env.KUN_CI_ALLOW_NO_SANDBOX = previousAuthorization
    if (previousActive === undefined) delete process.env.KUN_CI_NO_SANDBOX_ACTIVE
    else process.env.KUN_CI_NO_SANDBOX_ACTIVE = previousActive
  }
})
