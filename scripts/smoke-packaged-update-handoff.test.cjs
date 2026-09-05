'use strict'

const assert = require('node:assert/strict')
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
  runtimeBuildIdForFlavor
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
