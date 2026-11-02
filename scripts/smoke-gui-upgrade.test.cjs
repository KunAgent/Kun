'use strict'
const assert = require('node:assert/strict')
const { resolve } = require('node:path')
const test = require('node:test')
const { startGui, prepareReleasedGuiUpdate, parseInstallerJson, createGuiUpgradeEnvironment } = require('./smoke-gui-upgrade.cjs')

function fixture(profile, phases = ['ready']) {
  const state = { closed: false, options: undefined, startupReads: 0 }
  let bridgeRead = false
  const page = { evaluate: async () => {
    if (!bridgeRead) { bridgeRead = true; return true }
    state.startupReads++
    return { phase: phases.shift() || 'ready' }
  } }
  const app = {
    evaluate: async (operation) => operation({ app: { getPath: () => profile } }),
    windows: () => [page],
    close: async () => { state.closed = true }
  }
  const launch = async (options) => { state.options = options; return app }
  return { state, launch, app, page }
}

test('GUI acceptance uses the default profile preserved by argument-free installer relaunch', async () => {
  const profile = resolve('fixture-default-profile')
  const stub = fixture(profile)
  const environment = { HOME: 'disposable-ci-account' }
  const opened = await startGui('fixture-executable', environment, profile, stub.launch)
  assert.deepEqual(stub.state.options.args, [])
  assert.equal(stub.state.options.env, environment)
  assert.equal(opened.page, stub.page)
  assert.equal(stub.state.closed, false)
})

test('GUI acceptance rejects and closes an app using another profile', async () => {
  const stub = fixture(resolve('unexpected-profile'))
  await assert.rejects(startGui('fixture-executable', {}, resolve('expected-profile'), stub.launch),
    /same default profile/)
  assert.equal(stub.state.closed, true)
})

test('GUI acceptance waits for Runtime startup after the preload bridge appears', async () => {
  const profile = resolve('fixture-default-profile')
  const stub = fixture(profile, ['runtime_starting', 'ready'])
  await startGui('fixture-executable', {}, profile, stub.launch)
  assert.equal(stub.state.startupReads, 2)
})

test('startup recovery is reported immediately and the launched fixture is closed', async () => {
  const profile = resolve('fixture-default-profile')
  const stub = fixture(profile, ['recovery_required'])
  await assert.rejects(startGui('fixture-executable', {}, profile, stub.launch), /startup requires recovery/)
  assert.equal(stub.state.closed, true)
  assert.equal(stub.state.startupReads, 1)
})


test('released 0.3.7 uses the real Providers view before requesting an upgrade', async () => {
  const calls = []
  const record = {}
  const page = {
    getByRole: (role, options) => ({ click: async () => calls.push([role, options.name]) }),
    locator: selector => ({ click: async () => calls.push(['click', selector]) }),
    getByTestId: id => ({ waitFor: async options => calls.push(['visible', id, options.state]) }),
    evaluate: async operation => {
      const { runInNewContext } = require('node:vm')
      let frames = 0
      await runInNewContext(`(${operation.toString()})()`, {
        requestAnimationFrame: callback => { frames++; callback() }
      })
      assert.equal(frames, 2)
      calls.push(['effects-settled'])
    }
  }
  assert.equal(await prepareReleasedGuiUpdate(page, '0.3.7', record), true)
  assert.deepEqual(calls, [['button', 'Settings'], ['click', '[data-settings-category="providers"]'],
    ['visible', 'provider-workspace-meta', 'visible'], ['effects-settled']])
  assert.deepEqual(record.legacyUpdatePreparation, { sourceVersion: '0.3.7', settingsCategory: 'providers' })
})

test('new GUI versions do not acquire a legacy settings-view prerequisite', async () => {
  const record = {}
  assert.equal(await prepareReleasedGuiUpdate({}, '0.3.8', record), false)
  assert.deepEqual(record, {})
})

test('failure to open the legacy Providers view fails the upgrade preparation', async () => {
  const record = {}
  const page = { getByRole: () => ({ click: async () => { throw new Error('Settings is unavailable') } }) }
  await assert.rejects(prepareReleasedGuiUpdate(page, '0.3.7', record), /Settings is unavailable/)
  assert.deepEqual(record, {})
})


test('installer JSON accepts the UTF-8 BOM emitted by Windows PowerShell', () => {
  const result = { schemaVersion: 2, outcome: 'success', transactionState: 'committed' }
  assert.deepEqual(parseInstallerJson(`\uFEFF${JSON.stringify(result)}`), result)
  assert.deepEqual(parseInstallerJson(JSON.stringify(result)), result)
  assert.deepEqual(parseInstallerJson('\uFEFF[]'), [])
  assert.throws(() => parseInstallerJson('\uFEFF{broken'), SyntaxError)
})


test('native upgrade launches preserve the same OS credential policy as installer relaunches', () => {
  const input = { KUN_DISABLE_OS_CREDENTIAL_STORE: '1', ELECTRON_RUN_AS_NODE: '1', MARKER: 'fixture' }
  const environment = createGuiUpgradeEnvironment(input, {
    home: '/fixture/home', appData: '/fixture/appdata', localAppData: '/fixture/cache',
    temporaryDirectory: '/fixture/tmp'
  })
  assert.equal(environment.KUN_DISABLE_OS_CREDENTIAL_STORE, undefined)
  assert.equal(environment.KUN_PACKAGED_EXTENSION_DESKTOP_SMOKE, undefined)
  assert.equal(environment.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(environment.MARKER, 'fixture')
  assert.equal(environment.HOME, '/fixture/home')
  assert.equal(environment.APPDATA, '/fixture/appdata')
  assert.equal(input.KUN_DISABLE_OS_CREDENTIAL_STORE, '1')
})

const { mkdtemp, readFile, writeFile, rm } = require('node:fs/promises')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { parse } = require('yaml')
const { digest } = require('./gui-upgrade-feed.cjs')
const { RELEASE_SHA256, upgradeOptions, verifyPublishedSource, assertCandidateExtractionTrace } = require('./smoke-windows-installer-cross-version.cjs')

test('cross-version options preserve legacy defaults but permit explicit released baseline and scenarios', () => {
  assert.deepEqual(upgradeOptions(new Map([['--version', '0.4.4']]), 'win32'), {
    version: '0.4.4', baselineVersion: '0.3.7', scenarios: ['normal', 'busy', 'rollback', 'manual']
  })
  assert.deepEqual(upgradeOptions(new Map([['--version', '0.4.4'], ['--baseline-version', '0.4.3'],
    ['--scenarios', 'normal,rollback']]), 'win32'), {
    version: '0.4.4', baselineVersion: '0.4.3', scenarios: ['normal', 'rollback']
  })
  for (const [flag, value] of [['--baseline-version', '../0.4.3'], ['--scenarios', 'normal,normal'],
    ['--scenarios', 'fake-success']]) {
    assert.throws(() => upgradeOptions(new Map([['--version', '0.4.4'], [flag, value]]), 'win32'))
  }
})

test('published control verifies stable metadata, tag commit and actual released installer bytes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'kun-control-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const version = '0.9.0'
  const name = `Kun-${version}-win-x64.exe`
  await writeFile(join(directory, name), 'released-control')
  const sha512 = await digest(join(directory, name))
  const commit = 'a'.repeat(40)
  const state = { isDraft: false, isPrerelease: false, hash: sha512 }
  const execute = async (binary, args) => {
    if (binary === 'git') return { stdout: `${commit}\trefs/tags/v${version}\n` }
    assert.equal(binary, 'gh')
    if (args[1] === 'view') return { stdout: JSON.stringify({ tagName: `v${version}`, ...state }) }
    assert.equal(args[1], 'download')
    const root = args[args.indexOf('-D') + 1]
    t.after(() => rm(root, { recursive: true, force: true }))
    await writeFile(join(root, 'latest.yml'), JSON.stringify({ version, files: [{ url: name, sha512: state.hash }] }))
    return { stdout: '' }
  }
  assert.equal(await verifyPublishedSource(version, directory, execute, 'win32'), commit)
  state.isDraft = true
  await assert.rejects(verifyPublishedSource(version, directory, execute, 'win32'))
  state.isDraft = false
  state.isPrerelease = true
  await assert.rejects(verifyPublishedSource(version, directory, execute, 'win32'))
  state.isPrerelease = false
  state.hash = 'tampered'
  await assert.rejects(verifyPublishedSource(version, directory, execute, 'win32'), /differs from the published release/)
})

test('investigation release hashes are pinned independently of mutable feed metadata', () => {
  assert.equal(RELEASE_SHA256['0.4.3'], 'e71eb0851bf3c5b416709c49ce07090e9d2a9c05758c82326926522ec22333dd')
  assert.equal(RELEASE_SHA256['0.4.4'], '49a8dd4945199f39ffe5ec4e5264dbc15c8a30593bc7c35a7d66aab0df365d16')
})

test('Windows CI compares published control and required same-run PR candidate with real GUI baseline', async () => {
  const workflow = parse(await readFile(join(__dirname, '../.github/workflows/pr-checks.yml'), 'utf8'))
  const job = workflow.jobs['windows-cross-version']
  assert.equal(job['runs-on'], 'windows-latest')
  assert.deepEqual(job.strategy.matrix.source, ['published-release', 'pull-request'])
  assert.equal(job['continue-on-error'], "${{ matrix.source == 'published-release' }}")
  const commands = job.steps.map(step => step.run || '').join('\n')
  assert.match(commands, /--baseline-version 0\.4\.3/)
  assert.match(commands, /'normal,busy,rollback'/)
  assert.doesNotMatch(commands, /release (create|edit|upload)|publish-r2/)
  const stage = job.steps.findIndex(step => step.id === 'stage_windows_evidence')
  const upload = job.steps.findIndex(step => step.uses === 'actions/upload-artifact@v4')
  assert.ok(stage >= 0 && upload > stage)
  assert.equal(job.steps[stage].if, 'always()')
  assert.equal(job.steps[upload].if, "${{ always() && steps.stage_windows_evidence.outcome == 'success' }}")
  assert.equal(job.steps[upload].with.path, 'artifacts/windows-cross-version')
  assert.ok(workflow.jobs['pr-gate'].needs.includes('windows-cross-version'))
})

test('failed native updates capture evidence before cleanup and never uninstall rollback state', async () => {
  const script = await readFile(join(__dirname, 'smoke-gui-upgrade.cjs'), 'utf8')
  assert.ok(script.indexOf('await captureWindowsUpgrade') < script.indexOf("['stop-failed-installer'"))
  assert.match(script, /if \(process\.platform !== 'win32' \|\| failure\) return/)
  assert.match(script, /downloadedDigests\[index\] === expectedDigest/)
  assert.match(script, /input\.baselineVersion/)
  assert.doesNotMatch(script, /getAppVersion\(\)\), '0\.3\.7'/)
})


test('candidate native run must demonstrate the compiled extraction tracing override', () => {
  const markers = ['archive-write-start', 'archive-write-returned', '7z-extract-start',
    '7z-extract-returned', 'shell-copy-start', 'shell-copy-returned', 'decompression-returned']
  const log = markers.map(step => `NSIS update-boundary=${step}`).join('\n')
  assert.doesNotThrow(() => assertCandidateExtractionTrace(log))
  assert.throws(() => assertCandidateExtractionTrace(log.replace('7z-extract-returned', 'missing')), /compiled extraction marker/)
  assert.throws(() => assertCandidateExtractionTrace(markers.reverse().map(step => `NSIS update-boundary=${step}`).join('\n')))
})


test('Windows failure evidence excludes unrelated processes and all command lines', () => {
  const { selectOwnedWindowsProcesses } = require('./smoke-windows-installer-cross-version.cjs')
  const rows = [
    { ProcessId: 1, ParentProcessId: 0, ExecutablePath: 'C:\\runner\\worker.exe', CommandLine: 'SECRET' },
    { ProcessId: 2, ParentProcessId: 1, ExecutablePath: 'C:\\fixture\\Kun\\Kun.exe', CreationDate: '2026-11-02T00:00:00Z', CommandLine: 'PRIVATE' },
    { ProcessId: 3, ParentProcessId: 1, ExecutablePath: 'C:\\cache\\candidate.exe', CreationDate: '/Date(1793577600000)/' },
    { ProcessId: 4, ParentProcessId: 3, ExecutablePath: 'C:\\temp\\installer-child.exe', CreationDate: '2026-11-02T00:00:01Z', CommandLine: 'PRIVATE' },
    { ProcessId: 6, ParentProcessId: 3, ExecutablePath: 'C:\\unrelated.exe', CreationDate: '2026-11-01T00:00:00Z' },
    { ProcessId: 5, ParentProcessId: 1, ExecutablePath: 'C:\\fixture\\Kun-other\\unrelated.exe' }
  ]
  const paths = { executable: 'c:\\fixture\\Kun\\Kun.exe', verifiedInstallerPaths: ['C:\\cache\\candidate.exe'] }
  const result = selectOwnedWindowsProcesses(rows, paths)
  assert.deepEqual(result.processes.map(row => row.ProcessId), [2, 3, 4])
  assert.equal(result.processes[0].CreationDate, '2026-11-02T00:00:00Z')
  assert.equal(result.truncated, false)
  assert.doesNotMatch(JSON.stringify(result), /CommandLine|SECRET|PRIVATE|runner|unrelated/)
  assert.equal(selectOwnedWindowsProcesses(rows, paths, 2).truncated, true)
  assert.equal(selectOwnedWindowsProcesses(rows, paths, 2).processes.length, 2)
  assert.deepEqual(selectOwnedWindowsProcesses(rows, {}).processes, [])
  assert.deepEqual(selectOwnedWindowsProcesses(rows, { executable: 'Kun.exe', verifiedInstallerPaths: ['candidate.exe'] }).processes, [])
})

test('terminal dialogue failures fail immediately with bounded redacted runtime evidence', async () => {
  const { settle } = require('./smoke-gui-upgrade.cjs')
  const records = []
  let reads = 0
  const page = { evaluate: async () => { reads++; return {
    status: 'failed', error: 'Provider rejected Bearer sk-private-secret packaged-handoff-smoke-key'
  } } }
  await assert.rejects(settle(page, { thread: { id: 'thread' }, turn: { turnId: 'turn' } }, {
    modelRequests: () => 0, record: summary => records.push(summary)
  }), /Test dialogue failed: Provider rejected Bearer \[REDACTED\] \[REDACTED\]; modelRequests=0/)
  assert.equal(reads, 1)
  assert.equal(records[0].status, 'failed')
  assert.doesNotMatch(JSON.stringify(records), /sk-private|packaged-handoff-smoke-key/)
})


test('terminal dialogue console errors share artifact credential sanitization', async () => {
  const { settle } = require('./smoke-gui-upgrade.cjs')
  const page = { evaluate: async () => ({ status: 'failed',
    error: 'Authorization: Basic YWJj\nhttps://user:password@example.test?access_token=secret' }) }
  await assert.rejects(settle(page, { thread: { id: 'thread' }, turn: { turnId: 'turn' } }), error => {
    assert.doesNotMatch(error.message, /YWJj|user:password|access_token=secret/)
    return true
  })
})

const { preparedWindow, hasOldStartup, observePreparedRestart } = require('./smoke-windows-installer-prepared-restart.cjs')

function restartFixture(samples) {
  let time = 0
  let index = 0
  const events = []
  const saved = []
  const launched = { pid: 99, atMs: 1, version: '0.4.3', arguments: [] }
  const operations = { now: () => time, timeoutMs: 1000, stopped: () => false,
    sample: async () => samples[Math.min(index++, samples.length - 1)],
    pause: async ms => { time += ms }, preserve: async label => { saved.push(label) },
    event: (name, detail) => events.push({ name, detail }), launch: async () => launched }
  return { operations, events, saved, launched }
}
const preparedSample = { oldExited: true, window: true, pendingPresent: true, installerVerified: true,
  stageStarted: false, summary: { at: 'prepared' } }
const stagedSample = { ...preparedSample, window: false, stageStarted: true, summary: { at: 'staged' } }

test('prepared restart launches normal old GUI only inside a rechecked authenticated prepared window', async () => {
  const fixture = restartFixture([preparedSample, preparedSample,
    { ...preparedSample, startedOldGui: true, pendingPresent: false, summary: { at: 'pending-removed' } }, stagedSample])
  const result = await observePreparedRestart(fixture.operations)
  assert.equal(result.status, 'observed')
  assert.equal(result.reason, 'pending_removed_during_prepared_overlap')
  assert.deepEqual(result.launch.arguments, [])
  assert.deepEqual(fixture.saved, ['before-launch', 'pending-removed', 'observation-end'])
})

test('missed prepared overlap is inconclusive, including Stage winning the launch-preflight race', async () => {
  for (const samples of [[stagedSample], [preparedSample, stagedSample],
    [preparedSample, preparedSample, stagedSample]]) {
    const fixture = restartFixture(samples)
    const result = await observePreparedRestart(fixture.operations)
    assert.equal(result.status, 'inconclusive')
    assert.equal(result.pendingRemoval, undefined)
  }
})

test('pending disappearance is not attributed to a restart without old startup and installer ownership', async () => {
  for (const change of [{ startedOldGui: false }, { installerVerified: false }]) {
    const fixture = restartFixture([preparedSample, preparedSample,
      { ...preparedSample, startedOldGui: true, pendingPresent: false, ...change }, stagedSample])
    const result = await observePreparedRestart(fixture.operations)
    assert.equal(result.status, 'inconclusive')
    assert.equal(result.pendingRemoval, undefined)
  }
  for (const change of [{ oldExited: false }, { installerVerified: false }, { pendingPresent: false }]) {
    const fixture = restartFixture([{ ...preparedSample, ...change }, stagedSample])
    assert.equal((await observePreparedRestart(fixture.operations)).launch, undefined)
  }
})

test('normal startup evidence requires fresh timestamp, actual old version and exact executable', () => {
  const executable = 'C:\\fixture\\Kun.exe'
  const launch = { atMs: Date.parse('2026-11-02T07:00:00Z') }
  const line = (time, version, path = executable) => `[${time}] [INFO] [startup] Desktop startup entered. - detail: ${JSON.stringify({ appVersion: version, executablePath: path }, null, 2)}\n`
  assert.equal(hasOldStartup(line('2026-11-02T07:00:01Z', '0.4.3'), launch, executable), true)
  assert.equal(hasOldStartup(line('2026-11-02T06:59:59Z', '0.4.3'), launch, executable), false)
  assert.equal(hasOldStartup(line('2026-11-02T07:00:01Z', '0.4.4'), launch, executable), false)
  assert.equal(hasOldStartup(line('2026-11-02T07:00:01Z', '0.4.3', 'C:\\other\\Kun.exe'), launch, executable), false)
  assert.equal(preparedWindow('NSIS update-boundary=prepared'), true)
  assert.equal(preparedWindow('NSIS update-boundary=prepared\nSTART action=StageExtractedUpdatePayload'), false)
})

test('prepared restart requires candidate overlap and cleanup while keeping released control observational', async () => {
  const flags = new Map([['--version', '0.4.4'], ['--baseline-version', '0.4.3'], ['--scenarios', 'restart-prepared']])
  assert.equal(upgradeOptions(flags, 'win32').scenarios[0], 'restart-prepared')
  assert.throws(() => upgradeOptions(flags, 'darwin'))
  assert.throws(() => upgradeOptions(new Map([...flags, ['--scenarios', 'normal,restart-prepared']]), 'win32'))
  const workflow = parse(await readFile(join(__dirname, '../.github/workflows/pr-checks.yml'), 'utf8'))
  assert.equal(workflow.jobs['windows-prepared-restart']['continue-on-error'], "${{ matrix.source == 'published-release' }}")
  assert.ok(workflow.jobs['pr-gate'].needs.includes('windows-prepared-restart'))
  assert.ok(workflow.jobs['report-pr-check-feedback'].needs.includes('windows-prepared-restart'))
  const steps = workflow.jobs['windows-prepared-restart'].steps
  const stage = steps.findIndex(step => step.id === 'stage_windows_evidence')
  const upload = steps.findIndex(step => step.uses === 'actions/upload-artifact@v4')
  assert.ok(stage >= 0 && upload > stage)
  assert.equal(steps[stage].if, 'always()')
  assert.match(steps[stage].run, /stage-windows-upgrade-evidence\.cjs.*--output artifacts\/windows-prepared-restart/)
  assert.equal(steps[upload].if, "${{ always() && steps.stage_windows_evidence.outcome == 'success' }}")
  assert.equal(steps[upload].with.path, 'artifacts/windows-prepared-restart')
  assert.doesNotMatch(steps[upload].with.path, /GUI_UPGRADE_EVIDENCE|APPDATA|\*/)

  const script = await readFile(join(__dirname, 'smoke-gui-upgrade.cjs'), 'utf8')
  assert.match(script, /entry\.pid !== record\.preparedRestart\?\.launch\?\.pid/)
  assert.match(script, /report\.status === 'inconclusive'\) process\.exitCode = 2/)
  assert.match(script, /return classification === 'finalized' \? classification : undefined/)
  assert.doesNotMatch(script, /\['finalized', 'healthy-runtime-with-valid-recovery-grace'\]\.includes/)
  assert.match(steps.map(step => step.run || '').join('\n'), /--require-pending-protection/)
})

const { creationIdentity, selectTransactionInstaller, parseWindowsJson } = require('./smoke-windows-installer-prepared-restart.cjs')

test('native prepared-restart adapter authenticates raw PascalCase transaction against precise CIM creation identity', () => {
  const executable = 'C:\\fixture\\Kun\\Kun.exe'
  const installer = 'C:\\fixture\\downloaded-installer.exe'
  const time = '2026-11-02T07:51:01.1234560Z'
  const transaction = { Phase: 'prepared', OldVersion: '0.4.3', NewVersion: '0.4.4',
    Source: 'C:\\fixture\\Kun', InstallerPid: 3512, InstallerProcessIdentity: `win32-v1:${time}` }
  const row = { ProcessId: 3512, ParentProcessId: 1200, ExecutablePath: installer, CreationDate: time }
  const expected = { executable, verifiedInstallerPaths: [installer], newVersion: '0.4.4' }
  assert.equal(selectTransactionInstaller('\uFEFF' + JSON.stringify(transaction), [row], expected), row)
  for (const changed of [
    { CreationDate: '2026-11-02T07:51:01.1234570Z' }, // Recycled within the same millisecond.
    { CreationDate: '/Date(1793605861123)/' }, // Native precision was lost.
    { ProcessId: 3513 }, { ExecutablePath: 'C:\\other\\installer.exe' }, { CreationDate: null }
  ]) assert.equal(selectTransactionInstaller(JSON.stringify(transaction), [{ ...row, ...changed }], expected), null)
  for (const changed of [{ InstallerPid: undefined, installerPid: 3512 },
    { InstallerProcessIdentity: 'win32-v1:invalid' }, { Phase: 'payload_switched' },
    { Source: 'C:\\other' }, { OldVersion: '0.4.2' }, { NewVersion: '0.4.5' }]) {
    assert.equal(selectTransactionInstaller(JSON.stringify({ ...transaction, ...changed }), [row], expected), null)
  }
  assert.equal(creationIdentity('2026-11-02T07:51:01.123456Z'), `win32-v1:${time}`)
  assert.equal(creationIdentity('2026-11-02T07:51:01.1234561Z'), null)
  assert.deepEqual(parseWindowsJson('\uFEFF{"pid":123}'), { pid: 123 })
  assert.throws(() => parseWindowsJson('\uFEFF{bad'))
})

const { createPreparedOwnerVerifier } = require('./smoke-windows-installer-prepared-restart.cjs')
test('only post-launch continuity may use a previously authenticated prepared owner', () => {
  const installer = 'C:\\fixture\\installer.exe'
  const time = '2026-11-02T07:51:01.1234560Z'
  const transaction = { Phase: 'prepared', OldVersion: '0.4.3', NewVersion: '0.4.4',
    Source: 'C:\\fixture\\Kun', InstallerPid: 3512, InstallerProcessIdentity: `win32-v1:${time}` }
  const raw = JSON.stringify(transaction)
  const row = { ProcessId: 3512, ExecutablePath: installer, CreationDate: time }
  const expected = { executable: 'C:\\fixture\\Kun\\Kun.exe', verifiedInstallerPaths: [installer], newVersion: '0.4.4' }
  const verify = createPreparedOwnerVerifier(expected)
  assert.equal(verify(null, [row], true), null, 'No authenticated owner exists yet')
  assert.equal(verify(raw, [row]), row)
  assert.equal(verify(null, [row]), null, 'Deleted journal cannot authorize a launch')
  const changed = JSON.stringify({ ...transaction, Phase: 'rolled_back' })
  assert.equal(verify(changed, [row]), null, 'Changed journal cannot authorize a launch')
  assert.equal(verify(null, [row], true), row, 'Post-launch deletion does not imply owner exit')
  assert.equal(verify(changed, [row], true), row, 'Post-launch mutation does not imply owner exit')
  assert.equal(verify(null, [{ ...row, CreationDate: '2026-11-02T07:51:01.1234570Z' }], true), null,
    'Recycled PID cannot inherit the cached owner')
  assert.equal(verify(raw, [], true), null, 'An exited owner is not revived by its journal')
})


test('prepared observation failures never copy malformed JSON or credential fragments into reports', () => {
  const { observationFailure } = require('./smoke-windows-installer-prepared-restart.cjs')
  const failure = observationFailure(new SyntaxError('Unexpected token PRIVATE_CREDENTIAL in JSON'), 123)
  assert.deepEqual(failure, { status: 'inconclusive', reason: 'observation_error', startedAt: 123, errorName: 'SyntaxError' })
  assert.doesNotMatch(JSON.stringify(failure), /PRIVATE_CREDENTIAL/)
  assert.deepEqual(observationFailure({ name: 'PRIVATE_CREDENTIAL', code: 'PRIVATE_CREDENTIAL' }, 123), {
    status: 'inconclusive', reason: 'observation_error', startedAt: 123, errorName: 'Error'
  })
  assert.equal(observationFailure({ name: 'Error', code: 'EACCES' }, 123).errorCode, 'EACCES')
})
