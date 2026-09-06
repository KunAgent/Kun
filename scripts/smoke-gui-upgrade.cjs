'use strict'

// Executes released GUI binaries. Run only on disposable native CI accounts.
const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { writeFileSync } = require('node:fs')
const { promisify } = require('node:util')
const { mkdir, mkdtemp, readFile, writeFile, copyFile, appendFile, rename } = require('node:fs/promises')
const { tmpdir, homedir } = require('node:os')
const { join, resolve } = require('node:path')
const { _electron: electron } = require('playwright-core')
const { parse } = require('yaml')
const { digest, startCandidateFeed, validateFeed } = require('./gui-upgrade-feed.cjs')
const { verifyCandidateSource } = require('./release-candidate-source.cjs')
const { verifyPrCandidateSource } = require('./pr-gui-candidate-source.cjs')
const { closeGuiWithExitEvidence, attachGuiDiagnostics, captureMacProcesses, captureMacUpdateDiagnostics } = require('./gui-upgrade-diagnostics.cjs')
const { createScenarioJournal, cleanupScenario, recordScenario,
  claimScenarioDirectory, preserveScenarioDirectory } = require('./gui-upgrade-journal.cjs')
const { createInstallRequestControl } = require('./install-request-control.cjs')
const { inspectSignedBundle, verifyMacCandidate, waitForBundleReplacement, waitForMacRelaunch } = require('./mac-upgrade-observation.cjs')
const {
  buildSmokeSettings, startModelFixture, MODEL_NAME, poll, processIsAlive
} = require('./smoke-packaged-update-handoff-support.cjs')
const {
  createIsolatedEnvironment
} = require('./smoke-packaged-extension-desktop-runtime.cjs')

const run = promisify(execFile)
const TIMEOUT = 180_000
const q = (value) => `'${value.replace(/'/g, "''")}'`
async function ps(command, env = process.env) {
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    env, timeout: 10 * 60_000, maxBuffer: 4 * 1024 * 1024
  })
}

async function install(executable, parent, env) {
  const args = ['/S', '/currentuser', `"/D=${parent}"`]
  await ps(`$p=Start-Process -FilePath ${q(executable)} -ArgumentList @(${args.map(q).join(',')}) -PassThru; ` +
    '$p.WaitForExit(); $p.Refresh(); if ($p.ExitCode -ne 0) { throw "Installer exit $($p.ExitCode)" }', env)
}

async function stopInstalledGui(executable) {
  // Exact install path inside this test's private temporary directory only.
  if (process.platform === 'win32') {
    await ps(`Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq ${q(executable)} } | ` +
      'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }')
  } else {
    await run('pkill', ['-f', `^${executable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`])
      .catch((error) => { if (error.code !== 1) throw error })
  }
}

async function request(page, path, method = 'GET', body) {
  return page.evaluate(async ({ path, method, body }) => {
    const result = await window.kunGui.runtimeRequest(path, method, body === undefined ? undefined : JSON.stringify(body))
    if (!result.ok) throw new Error(`Runtime ${method} ${path}: ${result.status}`)
    return result.body ? JSON.parse(result.body) : null
  }, { path, method, body })
}

function parseInstallerJson(text) {
  return JSON.parse(text.replace(/^\uFEFF/u, ''))
}

async function startGui(executable, env, userData, launch = electron.launch.bind(electron), observation) {
  const app = await launch({ executablePath: executable, env,
    args: [], timeout: TIMEOUT })
  try {
    const processInfo = observation ? await attachGuiDiagnostics(app, observation.journal, observation.label) : undefined
    assert.equal(resolve(await app.evaluate(({ app }) => app.getPath('userData'))), resolve(userData),
      'GUI must use the same default profile as the installer relaunch')
    const page = await poll(async () => {
      for (const candidate of app.windows()) {
        if (await candidate.evaluate(() => Boolean(window.kunGui?.getAppVersion)).catch(() => false)) return candidate
      }
      return undefined
    }, TIMEOUT, 'GUI workbench bridge')
    observation?.journal.phase('desktop_startup', { label: observation.label })
    let startupFailure
    let lastPhase
    await poll(async () => {
      const state = await page.evaluate(() => window.kunGui.startup.getState())
      if (observation) {
        observation.journal.record.desktopStartup = state
        if (state.phase !== lastPhase) observation.journal.event('desktop_startup_state', { label: observation.label, ...state })
      }
      lastPhase = state.phase
      if (state.phase === 'recovery_required') startupFailure = new Error(`Desktop startup requires recovery: ${state.detail || ''}`)
      return state.phase === 'ready'
    }, TIMEOUT, 'desktop startup readiness', () => { if (startupFailure) throw startupFailure })
    return { app, page, processInfo }
  } catch (error) {
    let timer
    try {
      await Promise.race([app.close(), new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Launched fixture did not close')), 5000)
      })])
    } catch (cleanupError) {
      if (observation) {
        observation.journal.record.cleanupErrors.push({ name: 'close-startup-fixture', error: cleanupError.message })
        observation.journal.event('cleanup_failed', { error: cleanupError.message })
      }
      await stopInstalledGui(executable).catch(() => undefined)
    } finally { clearTimeout(timer) }
    throw error
  }
}

function createGuiUpgradeEnvironment(environment, paths) {
  const result = createIsolatedEnvironment(environment, paths)
  // Installer relaunches use the account's native credential store. Baseline
  // and inspection launches must use the same policy, especially for DPAPI.
  delete result.KUN_PACKAGED_EXTENSION_DESKTOP_SMOKE
  delete result.KUN_DISABLE_OS_CREDENTIAL_STORE
  return result
}

async function prepareReleasedGuiUpdate(page, version, record) {
  if (version !== '0.3.7') return false
  // The released 0.3.7 flush listener has no drain operations outside Providers.
  // Use its real UI to mount those operations; never patch the binary or forge
  // a successful flush acknowledgement. New versions use the global service.
  await page.getByRole('button', { name: 'Settings', exact: true }).click({ timeout: TIMEOUT })
  await page.locator('[data-settings-category="providers"]').click({ timeout: TIMEOUT })
  await page.getByTestId('provider-workspace-meta').waitFor({ state: 'visible', timeout: TIMEOUT })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  record.legacyUpdatePreparation = { sourceVersion: version, settingsCategory: 'providers' }
  return true
}

async function chat(page, workspace, title) {
  const thread = await request(page, '/v1/threads', 'POST', {
    title, workspace, model: MODEL_NAME, mode: 'agent', approvalPolicy: 'auto', sandboxMode: 'workspace-write'
  })
  const turn = await request(page, `/v1/threads/${thread.id}/turns`, 'POST', {
    prompt: 'Return the upgrade acceptance marker.', model: MODEL_NAME,
    approvalPolicy: 'auto', sandboxMode: 'workspace-write', disableUserInput: true
  })
  return { thread, turn }
}

async function settle(page, saved) {
  return poll(async () => {
    const turn = await request(page, `/v1/threads/${saved.thread.id}/turns/${saved.turn.turnId}`)
    if (turn.status === 'failed' || turn.status === 'cancelled') throw new Error(`Test dialogue ${turn.status}`)
    return turn.status === 'completed' ? turn : undefined
  }, TIMEOUT, 'test dialogue completion')
}

async function scenario(input, name, record, persistReport) {
  record.targetVersion = input.version
  // NSIS resolves its recovery journal through Windows Known Folders, not the
  // child's APPDATA override. Keep both payload and journal beneath the actual
  // disposable account's AppData for the installer's restricted fault injection.
  const temporaryParent = process.platform === 'win32' ? process.env.APPDATA : tmpdir()
  const root = await mkdtemp(join(temporaryParent, `kun-gui-upgrade-${name}-`))
  const journal = createScenarioJournal(record, root, persistReport)
  const installControl = createInstallRequestControl(journal)
  const pollInstalling = (operation, timeout, description) => poll(operation, timeout, description, installControl.check)
  journal.phase('setup')
  // The real updater relaunches without custom CLI arguments. Use the clean
  // CI account's default profile, never a --user-data-dir-only test profile.
  const home = homedir()
  const appData = process.platform === 'win32' ? process.env.APPDATA : join(home, 'Library', 'Application Support')
  const userData = join(appData, 'Kun')
  const installerRecovery = join(appData, 'KunInstallerRecovery')
  const workspace = join(root, 'workspace')
  const dataDir = join(root, 'runtime-data')
  const controlDir = join(home, '.kun', 'control')
  const installParent = join(root, 'installed')
  const bundle = join(installParent, 'Kun.app')
  const executable = process.platform === 'win32'
    ? join(installParent, 'Kun', 'Kun.exe') : join(bundle, 'Contents', 'MacOS', 'Kun')
  record.executable = executable
  // Exclusive mkdir fails closed if this account already has any Kun profile.
  // The owned directory is moved into evidence after testing, not deleted.
  await mkdir(userData)
  await writeFile(join(userData, '.upgrade-acceptance-owner'), root)
  await mkdir(join(home, '.kun'), { recursive: true })
  await mkdir(controlDir)
  await writeFile(join(controlDir, '.upgrade-acceptance-owner'), root)
  // NSIS uses a fixed per-account transaction path across installations.
  // Own and preserve it like the profile so subsequent scenarios start clean.
  if (process.platform === 'win32') await claimScenarioDirectory(installerRecovery, root)
  const model = await startModelFixture()
  const environment = createGuiUpgradeEnvironment(process.env, {
    home, appData, localAppData: process.env.LOCALAPPDATA || join(root, 'cache'), temporaryDirectory: root
  })
  Object.assign(environment, {
    KUN_UPDATE_URL: input.feedUrl, KUN_UPDATE_URL_STABLE: input.feedUrl,
    KUN_INSTALLER_DIAGNOSTIC_PATH: join(root, 'installer.log')
  })
  if (process.platform === 'win32') Object.assign(environment, { TEMP: temporaryParent, TMP: temporaryParent })
  await Promise.all([workspace, dataDir, controlDir, installParent].map((path) => mkdir(path, { recursive: true })))
  const settings = buildSmokeSettings({ dataDir, port: 18899, runtimeToken: 'upgrade-fixture-token',
    workspaceRoot: workspace, baseUrl: model.baseUrl, autoStart: true })
  settings.locale = 'en'
  settings.guiUpdate = { channel: 'stable' }
  await writeFile(join(userData, 'kun-settings.json'), JSON.stringify(settings))
  let gui
  let failure
  try {
    journal.phase('baseline_installation')
    if (process.platform === 'win32') await install(input.baseline, installParent, environment)
    else {
      await run('ditto', ['-x', '-k', input.baseline, installParent])
      journal.phase('signature_preflight')
      record.signatures = await verifyMacCandidate(bundle, input.candidate, input.version, root)
      journal.phase('signatures_verified', record.signatures)
    }
    gui = await startGui(executable, environment, userData, undefined, { journal, label: 'baseline' })
    record.baselinePid = gui.processInfo.pid
    record.baselineLauncherPid = gui.app.process().pid
    assert.equal(await gui.page.evaluate(() => window.kunGui.getAppVersion()), '0.3.7')
    journal.phase('baseline_started', gui.processInfo)
    const saved = await chat(gui.page, workspace, `upgrade-history-${name}`)
    await settle(gui.page, saved)
    if (name !== 'manual') {
      journal.phase('legacy_provider_settings')
      await prepareReleasedGuiUpdate(gui.page, '0.3.7', record)
      journal.persist()
    }
    const before = await gui.page.evaluate(() => window.kunGui.getSettings())
    let active
    if (name === 'busy') {
      model.state.mode = 'hang'
      active = await chat(gui.page, workspace, 'active-during-update')
      await poll(async () => (await request(gui.page,
        `/v1/threads/${active.thread.id}/turns/${active.turn.turnId}`)).status === 'running' && model.state.requests >= 2,
      TIMEOUT, 'active model request before upgrade')
    }
    await gui.page.screenshot({ path: join(root, 'before.png') })
    const oldRuntime = parseInstallerJson(await readFile(join(dataDir, 'runtime.json'), 'utf8'))
    const oldPid = record.baselinePid
    const oldManager = await readFile(join(controlDir, 'manager.json'), 'utf8').then(parseInstallerJson).catch(() => null)
    await writeFile(join(root, 'upgrade-source.json'), JSON.stringify({ oldPid, oldRuntime, oldManager, executable }, null, 2))
    if (name === 'manual') {
      journal.phase('manual_installation')
      record.baselineCloseProof = await closeGuiWithExitEvidence(gui, journal.eventPath, TIMEOUT)
      gui = undefined
      await install(input.candidate, installParent, environment)
    } else {
      const checked = await gui.page.evaluate(() => window.kunGui.checkGuiUpdate('stable'))
      assert.equal(checked.ok, true, JSON.stringify(checked))
      assert.equal(checked.latestVersion, input.version)
      assert.equal(checked.hasUpdate, true)
      assert.notEqual(checked.manualOnly, true)
      journal.phase('update_checked', { version: checked.latestVersion, hasUpdate: checked.hasUpdate })
      const downloaded = await gui.page.evaluate(() => window.kunGui.downloadGuiUpdate('stable'))
      assert.equal(downloaded.ok, true, JSON.stringify(downloaded))
      const expectedDigest = await digest(input.candidate)
      const downloadedDigests = await Promise.all(downloaded.paths.map((path) => digest(path)))
      assert.ok(downloadedDigests.includes(expectedDigest), 'GUI downloaded bytes differ from the verified candidate')
      journal.phase('candidate_downloaded', { paths: downloaded.paths, sha512: expectedDigest })
      if (name === 'rollback') {
        await gui.app.evaluate(({ app }) => {
          process.env.KUN_INSTALLER_FAULT_INJECTION = '1'
          process.env.KUN_INSTALLER_FAULT_POINT = 'switch.after_payload_switched'
          return app.getVersion()
        })
      }
      await captureMacProcesses(root, 'before-install')
      await gui.page.exposeFunction('__kunRecordUpgradeResult', installControl.recordResult)
      journal.phase('install_requested', { pid: oldPid, version: '0.3.7', executable })
      await gui.page.evaluate(() => {
        void window.kunGui.installGuiUpdate().then((result) => {
          window.__upgradeResult = result
          return window.__kunRecordUpgradeResult(result)
        }).catch(error => window.__kunRecordUpgradeResult({ ok: false, error: error.message }).catch(() => undefined))
      })
      await pollInstalling(() => !processIsAlive(oldPid), TIMEOUT, 'old GUI exit after update')
      await captureMacProcesses(root, 'after-gui-exit')
      if (process.platform === 'darwin') {
        const exit = await pollInstalling(() => record.baselineLauncherExit, TIMEOUT, 'old GUI exit status')
        assert.equal(exit.pid, oldPid)
        assert.equal(exit.exitCode, 0, 'Old GUI exited abnormally during update handoff')
        assert.equal(exit.signal, null, 'Old GUI was killed during update handoff')
      }
      journal.phase('old_gui_exited', { pid: oldPid, launcherExit: record.baselineLauncherExit,
        nativeExit: journal.readEvents().findLast(event => event.event === 'gui_exited' && event.pid === oldPid) })
      gui = undefined
      if (process.platform === 'win32') {
        journal.phase('installer_result')
        const result = await pollInstalling(async () => {
          const value = parseInstallerJson(await readFile(join(userData, 'pending-update-result.json'), 'utf8'))
          return value.outcome ? value : undefined
        }, 10 * 60_000, 'installer-authored transaction result')
        await writeFile(join(root, 'installer-result.json'), JSON.stringify(result, null, 2))
        if (name === 'rollback') {
          assert.equal(result.code, 'payload_switch_failed')
          assert.equal(result.outcome, 'aborted')
          assert.equal(result.transactionState, 'rolled_back')
          assert.equal(result.rollbackOutcome, 'succeeded')
        } else {
          assert.equal(result.outcome, 'success')
          assert.equal(result.transactionState, 'committed')
        }
      }
      // Observe a real GUI window before the harness is allowed to reopen
      // anything. A background Runtime with the same executable is insufficient.
      if (process.platform === 'win32') {
        journal.phase('automatic_relaunch')
        const relaunched = await pollInstalling(async () => {
          const result = await ps(`$rows=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq ${q(executable)} } | ` +
            'ForEach-Object { $p=Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; ' +
            'if($p -and $p.MainWindowHandle -ne 0){[pscustomobject]@{pid=$p.Id;mainWindowHandle=[long]$p.MainWindowHandle}} }); ' +
            'ConvertTo-Json -Compress -InputObject $rows')
          return parseInstallerJson(result.stdout || '[]').find(entry => entry.pid !== oldPid && entry.mainWindowHandle > 0)
        }, 10 * 60_000, 'installer relaunch with a real GUI window')
        record.automaticRelaunch = { ...relaunched, source: 'CIM/MainWindowHandle', guiWindowObserved: true,
          observedAt: new Date().toISOString(), beforeHarnessLaunch: true }
        journal.phase('new_gui_started', record.automaticRelaunch)
      } else {
        await waitForBundleReplacement(async () => {
          const result = await run('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleShortVersionString', join(bundle, 'Contents', 'Info.plist')])
          return result.stdout.trim()
        }, input.version, pollInstalling, journal)
        journal.phase('replacement_signature_verification')
        record.replacedSignature = await inspectSignedBundle(bundle)
        assert.equal(record.replacedSignature.version, input.version)
        assert.equal(record.replacedSignature.teamId, record.signatures.baseline.teamId)
        assert.equal(record.replacedSignature.bundleId, record.signatures.baseline.bundleId)
        assert.equal(record.replacedSignature.cdHash, record.signatures.candidate.cdHash)
        await waitForMacRelaunch(bundle, executable, oldPid, record.signatures.baseline.bundleId, pollInstalling, journal)
      }
    }
    model.state.mode = 'complete'
    installControl.check()
    record.inspectionStartedAt = new Date().toISOString()
    journal.phase('inspection_started')
    await stopInstalledGui(executable)
    gui = await startGui(executable, environment, userData, undefined, { journal, label: 'inspection' })
    const expectedVersion = name === 'rollback' ? '0.3.7' : input.version
    assert.equal(await gui.page.evaluate(() => window.kunGui.getAppVersion()), expectedVersion)
    const after = await gui.page.evaluate(() => window.kunGui.getSettings())
    assert.equal(after.agents.kun.model, before.agents.kun.model)
    assert.equal(after.agents.kun.baseUrl, before.agents.kun.baseUrl)
    assert.equal(after.agents.kun.apiKey, before.agents.kun.apiKey)
    assert.equal(after.agents.kun.endpointFormat, before.agents.kun.endpointFormat)
    const history = await request(gui.page, `/v1/threads/${saved.thread.id}`)
    assert.equal(history.id ?? history.thread?.id, saved.thread.id)
    await settle(gui.page, saved)
    const next = await chat(gui.page, workspace, 'post-upgrade-chat')
    await settle(gui.page, next)
    assert.ok(model.state.requests >= 2)
    if (active) {
      const turn = await request(gui.page, `/v1/threads/${active.thread.id}/turns/${active.turn.turnId}`)
      assert.notEqual(turn.status, 'running')
    }
    if (process.platform === 'win32') assert.equal(processIsAlive(oldRuntime.pid), false)
    await gui.page.screenshot({ path: join(root, 'after.png') })
    record.version = expectedVersion
    journal.phase('post_upgrade_verified', { version: expectedVersion, pid: gui.processInfo.pid })
    journal.phase('closing_inspection_gui')
    record.inspectionCloseProof = await closeGuiWithExitEvidence(gui, journal.eventPath, TIMEOUT)
    journal.phase('inspection_gui_closed', record.inspectionCloseProof)
    gui = undefined
  } catch (error) {
    failure = error
    journal.fail(error)
    await captureMacUpdateDiagnostics(root, bundle).catch((diagnosticError) => {
      record.diagnosticErrors ??= []
      record.diagnosticErrors.push(diagnosticError.message)
      journal.event('diagnostic_capture_failed', { error: diagnosticError.message })
    })
    await gui?.page.screenshot({ path: join(root, 'failure.png') }).catch(() => undefined)
    await writeFile(join(root, 'failure.txt'), error.stack ?? String(error)).catch(() => undefined)
  } finally {
    await cleanupScenario(journal, [
      // A failed baseline may already have exited and relaunched itself.
      // Stop only this scenario's executable before waiting on Playwright.
      ['stop-installed-gui', () => stopInstalledGui(executable)],
      ['close-gui', async () => {
        if (gui?.processInfo?.pid && processIsAlive(gui.processInfo.pid)) {
          await closeGuiWithExitEvidence(gui, journal.eventPath, TIMEOUT)
        }
      }],
      ['stop-owned-manager', async () => {
        const manager = await readFile(join(controlDir, 'manager.json'), 'utf8').then(parseInstallerJson).catch(() => null)
        if (!manager) return
        assert.equal(resolve(manager.dataDir), resolve(dataDir), 'Manager must belong to this scenario')
        await fetch(`${manager.baseUrl}/v1/manager/shutdown`, {
          method: 'POST', headers: { authorization: `Bearer ${manager.managerToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({ instanceId: manager.instanceId }), signal: AbortSignal.timeout(10_000)
        }).catch(() => undefined)
        await poll(() => !processIsAlive(manager.pid), TIMEOUT, 'isolated manager shutdown')
      }],
      ['stop-recovery-gui', () => stopInstalledGui(executable)],
      ['uninstall-windows-fixture', async () => {
        if (process.platform !== 'win32') return
        const uninstaller = join(installParent, 'Kun', 'Uninstall Kun.exe')
        const copy = join(root, 'uninstall.exe')
        await copyFile(uninstaller, copy)
        await ps(`$p=Start-Process -FilePath ${q(copy)} -ArgumentList @('/S','/currentuser',${q(`_?=${join(installParent, 'Kun')}`)}) -PassThru; ` +
          '$p.WaitForExit(); $p.Refresh(); if ($p.ExitCode -ne 0) { throw "Uninstall failed" }', environment)
      }],
      ['close-model-fixture', () => model.close()],
      ['preserve-owned-installer-recovery', async () => {
        if (process.platform === 'win32') {
          await preserveScenarioDirectory(installerRecovery, root, 'installer-recovery')
        }
      }],
      ['preserve-owned-profile', async () => {
        assert.equal(await readFile(join(userData, '.upgrade-acceptance-owner'), 'utf8'), root,
          'Refusing to move a profile not owned by this acceptance scenario')
        await rename(userData, join(root, 'desktop-profile'))
      }],
      ['preserve-owned-control', async () => {
        assert.equal(await readFile(join(controlDir, '.upgrade-acceptance-owner'), 'utf8'), root,
          'Refusing to move a manager directory not owned by this acceptance scenario')
        await rename(controlDir, join(root, 'control'))
      }]
    ])
    if (!failure && record.cleanupErrors.length) {
      failure = new Error('Scenario cleanup failed')
      journal.phase('cleanup')
      journal.fail(failure)
    }
    if (!failure) record.status = 'passed'
    journal.persist()
    process.stdout.write(`GUI upgrade evidence: ${root}\n`)
  }
  if (failure) throw new Error(`${name}: ${failure.message}; evidence: ${root}`, { cause: failure })
  return record
}

async function main() {
  if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true' || !['win32', 'darwin'].includes(process.platform)) {
    throw new Error('GUI upgrade acceptance requires a disposable Windows/macOS CI account')
  }
  const evidenceParent = process.platform === 'win32' ? process.env.APPDATA : tmpdir()
  await appendFile(process.env.GITHUB_ENV, `GUI_UPGRADE_EVIDENCE=${evidenceParent}\n`)
  if (process.platform === 'win32') await ps(
    "$ErrorActionPreference='Stop'; $existing=@(Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' -ErrorAction SilentlyContinue | Where-Object { $p=Get-ItemProperty $_.PSPath; $p.PSObject.Properties['DisplayName'] -and $p.DisplayName -in @('Kun','DeepSeek GUI') }); if($existing.Count){throw 'Requires a clean CI account with no existing Kun install'}")
  const flags = new Map()
  for (let i = 2; i < process.argv.length; i += 2) flags.set(process.argv[i], process.argv[i + 1])
  const directory = resolve(flags.get('--directory') || 'dist')
  const version = flags.get('--version')
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('--version is required')
  const checkout = await run('git', ['rev-parse', 'HEAD'])
  const harnessCommit = checkout.stdout.trim()
  const source = process.env.GUI_UPGRADE_SOURCE || 'release-candidate'
  assert.ok(['pull-request', 'release-candidate'].includes(source), 'Unknown GUI upgrade candidate source')
  const candidateCommit = source === 'pull-request'
    ? await verifyPrCandidateSource(directory, version, harnessCommit)
    : await verifyCandidateSource(version, process.env.CANDIDATE_TAG || `v${version}`,
      process.env.CANDIDATE_COMMIT || harnessCommit)
  const manifestName = process.platform === 'win32' ? 'latest.yml' : 'latest-mac.yml'
  const { metadata } = await validateFeed(directory, manifestName, version)
  const candidateName = process.platform === 'win32' ? `Kun-${version}-win-x64.exe` : `Kun-${version}-mac-${process.arch}.zip`
  assert.ok(metadata.files.some((file) => file.url === candidateName))
  const downloads = await mkdtemp(join(tmpdir(), 'kun-upgrade-baseline-'))
  const baselineName = process.platform === 'win32' ? 'Kun-0.3.7-win-x64.exe' : `Kun-0.3.7-mac-${process.arch}.zip`
  const report = { version, source, commit: candidateCommit, harnessCommit, platform: process.platform, arch: process.arch,
    artifact: candidateName, sha512: await digest(join(directory, candidateName)), scenarios: [],
    status: 'running', phase: 'baseline_download', cleanupErrors: [] }
  const output = resolve(flags.get('--report') || `gui-upgrade-${process.platform}.json`)
  const persist = () => writeFileSync(output, JSON.stringify(report, null, 2))
  persist()
  let feed
  let failure
  try {
    await run('gh', ['release', 'download', 'v0.3.7', '-R', 'KunAgent/Kun',
      '-p', baselineName, '-p', manifestName, '-D', downloads], { timeout: 10 * 60_000 })
    const baselineMetadata = parse(await readFile(join(downloads, manifestName), 'utf8'))
    const baselineFile = baselineMetadata.files.find((file) => file.url === baselineName)
    assert.ok(baselineFile)
    assert.equal(await digest(join(downloads, baselineName)), baselineFile.sha512)
    report.baseline = { version: '0.3.7', artifact: baselineName, sha512: baselineFile.sha512 }
    report.phase = 'scenarios'
    persist()
    feed = flags.has('--feed-url') ? null : await startCandidateFeed(directory, manifestName, version)
    for (const name of process.platform === 'win32' ? ['normal', 'busy', 'rollback', 'manual'] : ['normal']) {
      await recordScenario(report, name, record => scenario({ version, candidate: join(directory, candidateName),
        baseline: join(downloads, baselineName), feedUrl: flags.get('--feed-url') || feed.url }, name, record, persist), persist)
    }
    report.status = 'passed'
    report.phase = 'completed'
  } catch (error) {
    failure = error
    report.status = 'failed'
    report.error ??= error.message
    report.phase = report.scenarios.at(-1)?.phase || report.phase
  } finally {
    await cleanupScenario({ record: report, event: persist }, [
      ['close-candidate-feed', async () => feed?.close()],
      ['save-baseline-manifest', async () => {
        await copyFile(join(downloads, manifestName), `${output}.previous.yml`).catch(error => {
          if (!failure || error.code !== 'ENOENT') throw error
        })
      }]
    ])
    if (report.cleanupErrors.length) {
      report.status = 'failed'
      failure ??= new Error('Acceptance harness cleanup failed')
      report.error ??= failure.message
    }
    report.completedAt = new Date().toISOString()
    persist()
  }
  if (failure) throw failure
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1 })

module.exports = { startGui, prepareReleasedGuiUpdate, parseInstallerJson, createGuiUpgradeEnvironment }
