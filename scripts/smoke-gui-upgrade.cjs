'use strict'

// Executes released GUI binaries. Run only on disposable native CI accounts.
const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { mkdir, mkdtemp, readFile, writeFile, copyFile, appendFile, rename } = require('node:fs/promises')
const { tmpdir, homedir } = require('node:os')
const { join, resolve } = require('node:path')
const { _electron: electron } = require('playwright-core')
const { parse } = require('yaml')
const { digest, startCandidateFeed, validateFeed } = require('./gui-upgrade-feed.cjs')
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

async function signedTeam(bundle) {
  await run('codesign', ['--verify', '--deep', '--strict', bundle])
  const details = await run('codesign', ['--display', '--verbose=4', bundle])
  const identity = details.stdout + details.stderr
  assert.match(identity, /Authority=Developer ID Application:/, 'ad-hoc packages cannot pass automatic update acceptance')
  const team = identity.match(/TeamIdentifier=([A-Z0-9]{10})\b/)
  assert.ok(team, 'Missing Developer ID team')
  return team[1]
}

async function request(page, path, method = 'GET', body) {
  return page.evaluate(async ({ path, method, body }) => {
    const result = await window.kunGui.runtimeRequest(path, method, body === undefined ? undefined : JSON.stringify(body))
    if (!result.ok) throw new Error(`Runtime ${method} ${path}: ${result.status}`)
    return result.body ? JSON.parse(result.body) : null
  }, { path, method, body })
}

async function startGui(executable, env, userData, launch = electron.launch.bind(electron)) {
  const app = await launch({ executablePath: executable, env,
    args: [], timeout: TIMEOUT })
  try {
    assert.equal(resolve(await app.evaluate(({ app }) => app.getPath('userData'))), resolve(userData),
      'GUI must use the same default profile as the installer relaunch')
  } catch (error) {
    await app.close()
    throw error
  }
  const page = await poll(async () => {
    for (const candidate of app.windows()) {
      if (await candidate.evaluate(() => Boolean(window.kunGui?.getAppVersion)).catch(() => false)) return candidate
    }
    return undefined
  }, TIMEOUT, 'GUI workbench bridge')
  return { app, page }
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

async function scenario(input, name) {
  // NSIS resolves its recovery journal through Windows Known Folders, not the
  // child's APPDATA override. Keep both payload and journal beneath the actual
  // disposable account's AppData for the installer's restricted fault injection.
  const temporaryParent = process.platform === 'win32' ? process.env.APPDATA : tmpdir()
  const root = await mkdtemp(join(temporaryParent, `kun-gui-upgrade-${name}-`))
  // The real updater relaunches without custom CLI arguments. Use the clean
  // CI account's default profile, never a --user-data-dir-only test profile.
  const home = homedir()
  const appData = process.platform === 'win32' ? process.env.APPDATA : join(home, 'Library', 'Application Support')
  const userData = join(appData, 'Kun')
  const workspace = join(root, 'workspace')
  const dataDir = join(root, 'runtime-data')
  const controlDir = join(home, '.kun', 'control')
  const installParent = join(root, 'installed')
  const bundle = join(installParent, 'Kun.app')
  const executable = process.platform === 'win32'
    ? join(installParent, 'Kun', 'Kun.exe') : join(bundle, 'Contents', 'MacOS', 'Kun')
  // Exclusive mkdir fails closed if this account already has any Kun profile.
  // The owned directory is moved into evidence after testing, not deleted.
  await mkdir(userData)
  await writeFile(join(userData, '.upgrade-acceptance-owner'), root)
  await mkdir(join(home, '.kun'), { recursive: true })
  await mkdir(controlDir)
  await writeFile(join(controlDir, '.upgrade-acceptance-owner'), root)
  const model = await startModelFixture()
  const environment = createIsolatedEnvironment(process.env, {
    home, appData, localAppData: process.env.LOCALAPPDATA || join(root, 'cache'), temporaryDirectory: root
  })
  delete environment.KUN_PACKAGED_EXTENSION_DESKTOP_SMOKE
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
  let baselineTeam
  try {
    if (process.platform === 'win32') await install(input.baseline, installParent, environment)
    else {
      await run('ditto', ['-x', '-k', input.baseline, installParent])
      baselineTeam = await signedTeam(bundle)
    }
    gui = await startGui(executable, environment, userData)
    assert.equal(await gui.page.evaluate(() => window.kunGui.getAppVersion()), '0.3.7')
    const saved = await chat(gui.page, workspace, `upgrade-history-${name}`)
    await settle(gui.page, saved)
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
    const oldRuntime = JSON.parse(await readFile(join(dataDir, 'runtime.json'), 'utf8'))
    const oldPid = gui.app.process().pid
    if (name === 'manual') {
      await gui.app.close()
      gui = undefined
      await install(input.candidate, installParent, environment)
    } else {
      const checked = await gui.page.evaluate(() => window.kunGui.checkGuiUpdate('stable'))
      assert.equal(checked.ok, true, JSON.stringify(checked))
      assert.equal(checked.latestVersion, input.version)
      assert.equal(checked.hasUpdate, true)
      assert.notEqual(checked.manualOnly, true)
      const downloaded = await gui.page.evaluate(() => window.kunGui.downloadGuiUpdate('stable'))
      assert.equal(downloaded.ok, true, JSON.stringify(downloaded))
      const expectedDigest = await digest(input.candidate)
      const downloadedDigests = await Promise.all(downloaded.paths.map((path) => digest(path)))
      assert.ok(downloadedDigests.includes(expectedDigest), 'GUI downloaded bytes differ from the verified candidate')
      if (name === 'rollback') {
        await gui.app.evaluate(({ app }) => {
          process.env.KUN_INSTALLER_FAULT_INJECTION = '1'
          process.env.KUN_INSTALLER_FAULT_POINT = 'switch.after_payload_switched'
          return app.getVersion()
        })
      }
      await gui.page.evaluate(() => {
        void window.kunGui.installGuiUpdate().then((result) => { window.__upgradeResult = result })
      })
      await poll(() => !processIsAlive(oldPid), TIMEOUT, 'old GUI exit after update')
      gui = undefined
      if (process.platform === 'win32') {
        const result = await poll(async () => {
          const value = JSON.parse(await readFile(join(userData, 'pending-update-result.json'), 'utf8'))
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
      // Wait for the installer to relaunch the real installed app before the
      // harness reopens it with inspection enabled for data/UI assertions.
      if (process.platform === 'win32') {
        await poll(async () => {
          const result = await ps(`@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq ${q(executable)} }).Count`)
          return Number(result.stdout.trim()) > 0
        }, 10 * 60_000, 'installer relaunch')
      } else {
        await poll(async () => {
          const result = await run('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleShortVersionString', join(bundle, 'Contents', 'Info.plist')])
          return result.stdout.trim() === input.version
        }, 10 * 60_000, 'signed macOS application replacement')
      }
    }
    model.state.mode = 'complete'
    if (process.platform === 'darwin') assert.equal(await signedTeam(bundle), baselineTeam)
    await stopInstalledGui(executable)
    gui = await startGui(executable, environment, userData)
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
    await gui.app.close()
    gui = undefined
    return { name, status: 'passed', version: expectedVersion, evidence: root }
  } catch (error) {
    await gui?.page.screenshot({ path: join(root, 'failure.png') }).catch(() => undefined)
    await writeFile(join(root, 'failure.txt'), error.stack ?? String(error))
    throw new Error(`${name}: ${error.message}; evidence: ${root}`)
  } finally {
    await gui?.app.close().catch(() => undefined)
    await stopInstalledGui(executable).catch(() => undefined)
    const managerPath = join(controlDir, 'manager.json')
    const manager = await readFile(managerPath, 'utf8').then(JSON.parse).catch(() => null)
    if (manager) {
      assert.equal(resolve(manager.dataDir), resolve(dataDir), 'Manager must belong to this scenario')
      await fetch(`${manager.baseUrl}/v1/manager/shutdown`, {
        method: 'POST', headers: { authorization: `Bearer ${manager.managerToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ instanceId: manager.instanceId }), signal: AbortSignal.timeout(10_000)
      }).catch(() => undefined)
      await poll(() => !processIsAlive(manager.pid), TIMEOUT, 'isolated manager shutdown')
    }
    if (process.platform === 'win32') {
      const uninstaller = join(installParent, 'Kun', 'Uninstall Kun.exe')
      const copy = join(root, 'uninstall.exe')
      try {
        await copyFile(uninstaller, copy)
        await ps(`$p=Start-Process -FilePath ${q(copy)} -ArgumentList @('/S','/currentuser',${q(`_?=${join(installParent, 'Kun')}`)}) -PassThru; ` +
          '$p.WaitForExit(); $p.Refresh(); if ($p.ExitCode -ne 0) { throw "Uninstall failed" }', environment)
      } catch (error) {
        await writeFile(join(root, 'cleanup-error.txt'), error.stack ?? String(error))
        process.exitCode = 1
      }
    }
    await model.close()
    assert.equal(await readFile(join(userData, '.upgrade-acceptance-owner'), 'utf8'), root,
      'Refusing to move a profile not owned by this acceptance scenario')
    await rename(userData, join(root, 'desktop-profile'))
    assert.equal(await readFile(join(controlDir, '.upgrade-acceptance-owner'), 'utf8'), root,
      'Refusing to move a manager directory not owned by this acceptance scenario')
    await rename(controlDir, join(root, 'control'))
    // Keep the isolated profile and installer diagnostics for CI artifact collection.
    process.stdout.write(`GUI upgrade evidence: ${root}\n`)
  }
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
  const manifestName = process.platform === 'win32' ? 'latest.yml' : 'latest-mac.yml'
  const { metadata } = await validateFeed(directory, manifestName, version)
  const candidateName = process.platform === 'win32' ? `Kun-${version}-win-x64.exe` : `Kun-${version}-mac-${process.arch}.zip`
  assert.ok(metadata.files.some((file) => file.url === candidateName))
  const downloads = await mkdtemp(join(tmpdir(), 'kun-upgrade-baseline-'))
  const baselineName = process.platform === 'win32' ? 'Kun-0.3.7-win-x64.exe' : `Kun-0.3.7-mac-${process.arch}.zip`
  await run('gh', ['release', 'download', 'v0.3.7', '-R', 'KunAgent/Kun',
    '-p', baselineName, '-p', manifestName, '-D', downloads], { timeout: 10 * 60_000 })
  const baselineMetadata = parse(await readFile(join(downloads, manifestName), 'utf8'))
  const baselineFile = baselineMetadata.files.find((file) => file.url === baselineName)
  assert.ok(baselineFile)
  assert.equal(await digest(join(downloads, baselineName)), baselineFile.sha512)
  const feed = flags.has('--feed-url') ? null : await startCandidateFeed(directory, manifestName, version)
  const checkout = await run('git', ['rev-parse', 'HEAD'])
  const report = { version, commit: checkout.stdout.trim(), platform: process.platform, arch: process.arch,
    artifact: candidateName, sha512: await digest(join(directory, candidateName)), scenarios: [] }
  try {
    for (const name of process.platform === 'win32' ? ['normal', 'busy', 'rollback', 'manual'] : ['normal']) {
      report.scenarios.push(await scenario({ version, candidate: join(directory, candidateName),
        baseline: join(downloads, baselineName), feedUrl: flags.get('--feed-url') || feed.url }, name))
    }
    report.status = 'passed'
  } finally {
    await feed?.close()
    const output = resolve(flags.get('--report') || `gui-upgrade-${process.platform}.json`)
    await writeFile(output, JSON.stringify(report, null, 2))
    await copyFile(join(downloads, manifestName), `${output}.previous.yml`)
  }
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1 })

module.exports = { startGui }
