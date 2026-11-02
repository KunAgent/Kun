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
  assert.ok(job.steps.some(step => step.uses === 'actions/upload-artifact@v4' && step.if === 'always()'))
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
