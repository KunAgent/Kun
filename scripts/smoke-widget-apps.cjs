#!/usr/bin/env node
'use strict'

// An isolated desktop exercises a real component, package installation, a warm
// launcher activation, and a cold start with the same profile. The model is local.
const assert = require('node:assert/strict')
const { execFile, spawn } = require('node:child_process')
const { promisify } = require('node:util')
const { access, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { _electron } = require('playwright-core')
const desktop = require('./smoke-packaged-extension-desktop-runtime.cjs')
const { makeTreeWritable } = require('./smoke-packaged-extensions.cjs')
const { availablePort, terminateProcessTree } = require('./smoke-packaged-extension-desktop-process.cjs')
const { findWorkbenchWindow } = require('./smoke-packaged-video-editor-desktop.cjs')
const { startAppSurfacesModelFixture } = require('./smoke-development-app-surfaces-model.cjs')

const timeout = 45_000
const repo = resolve(__dirname, '..')
async function until(label, read) {
  const deadline = Date.now() + timeout
  let reason
  while (Date.now() < deadline) {
    try { const value = await read(); if (value) return value } catch (error) { reason = error.message }
    await new Promise(resolve => setTimeout(resolve, 180))
  }
  throw new Error('Timed out waiting for ' + label + (reason ? ': ' + reason : ''))
}

async function run() {
  await access(join(repo, 'out', 'renderer', 'index.html'))
  const root = await realpath(await mkdtemp(join(process.platform === 'darwin' ? '/tmp' : tmpdir(), 'kun-widget-app-smoke-')))
  const paths = { home: join(root, 'test-user'), appData: join(root, 'app-data'),
    localAppData: join(root, 'local-data'), temporaryDirectory: join(root, 'scratch') }
  const profile = join(paths.home, '.kun', 'data')
  const userData = join(root, 'electron-data')
  const workspaceParent = desktop.desktopSmokeWorkspaceParent(repo)
  await mkdir(workspaceParent, { recursive: true })
  const workspace = await mkdtemp(join(workspaceParent, 'widget-app-'))
  const fixture = await startAppSurfacesModelFixture('deepseek-chat')
  const env = desktop.createIsolatedEnvironment(process.env, paths)
  delete env.ELECTRON_RENDERER_URL
  env.NODE_ENV = 'development'
  env.XDG_DATA_HOME = join(root, 'xdg-data')
  let application, child, main, electronOutput = ''
  async function decision(selector, title) {
    const dialog = await until(title, async () => {
      for (const page of application.windows()) {
        if (await page.locator(selector).isVisible().catch(() => false)) return page
      }
    })
    await dialog.locator(selector).click()
  }
  async function launch(...links) {
    application = await _electron.launch({ executablePath: require('electron'),
      args: ['--user-data-dir=' + userData, '--no-first-run', '--disable-component-update',
        '--disable-background-networking', ...desktop.platformDesktopArguments(), repo, ...links],
      cwd: repo, env, chromiumSandbox: true, timeout })
    child = application.process()
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on('data', chunk => { electronOutput = (electronOutput + chunk).slice(-8192) })
    }
    // Cocoa can resolve NSHomeDirectory independently of the child environment.
    await application.evaluate(({ app }, home) => app.setPath('home', home), paths.home)
    main = await findWorkbenchWindow(application, timeout)
    main.setDefaultTimeout(timeout)
  }
  async function quit() {
    if (!application) return
    try {
      // Closing the Playwright connection also releases Electron's Node inspector.
      await desktop.withTimeout(application.close(), 55000, 'quit desktop and disconnect debugger')
      assert.ok(await desktop.waitForPidExit(child.pid, 5000), 'Kun did not exit\n' + electronOutput.slice(-2500))
    }
    finally {
      if (!await desktop.waitForPidExit(child.pid, 2000)) await terminateProcessTree(child, process.platform, { timeoutMs: 10000 })
      desktop.releaseChildProcessHandles(child)
      child = undefined
      application = undefined
    }
  }
  const card = () => main.locator('[data-gen-ui-widget]').first()
  const windowFor = id => until('dedicated app window', () =>
    application.windows().find(page => !page.isClosed() && new URL(page.url()).searchParams.get('widgetApp') === id))
  async function guest(parent, script) {
    const instance = await parent.locator('webview[data-app-sandbox-instance]').first().getAttribute('data-app-sandbox-instance', { timeout: 2500 })
    return application.evaluate(({ webContents }, { instance, script }) => {
      const host = webContents.getAllWebContents().find(view => view.getType() === 'webview' && view.getURL().includes('shell-' + instance))
      return host?.mainFrame.frames[0]?.executeJavaScript(script)
    }, { instance, script })
  }
  async function send(text) {
    await main.locator('.ds-composer-textarea').fill(text)
    await main.locator('.ds-composer-primary-action').click()
  }
  async function save(parent, value) {
    await guest(parent, `(() => { const input=document.querySelector('#amp'); input.value='${value}';
      input.dispatchEvent(new Event('input')); document.querySelector('#amp-save').click(); return true })()`)
    await until('persisted choice', () => guest(parent, "document.querySelector('#amp-status')?.textContent === 'saved'"))
  }
  try {
    await Promise.all([...Object.values(paths), profile, userData, workspace].map(p => mkdir(p, { recursive: true })))
    const settings = { ...desktop.desktopSmokeSettings(await availablePort(), workspace, profile), locale: 'en', initialSetupCompleted: true }
    Object.assign(settings.agents.kun, { baseUrl: fixture.baseUrl, model: 'deepseek-chat', apiKey: 'local-widget-fixture', approvalPolicy: 'auto' })
    settings.schedule = { internal: { port: await availablePort() } }
    for (const dir of desktop.desktopUserDataCandidates({ platform: process.platform, home: paths.home, appData: paths.appData, explicitUserData: userData })) {
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'kun-settings.json'), JSON.stringify(settings))
    }
    await launch()
    const firstPid = child.pid
    await send('[gen-ui-smoke-1] Make an amplitude explorer')
    await until('initial slider', () => guest(card(), "document.querySelector('#amp')?.value === '2'"))
    await save(card(), 4)
    await card().getByRole('button', { name: 'Install as app' }).click()
    await decision('#consent-cancel', 'cancel first install')
    assert.deepEqual(await main.evaluate(() => window.kunGui.widgetApps.list()), [])
    await card().getByRole('button', { name: 'Install as app' }).click()
    await decision('#consent-approve', 'approve first install')
    const installed = await until('installed widget', () => main.evaluate(async () => (await window.kunGui.widgetApps.list())[0]))
    const getSurface = page => page.locator('[data-installed-widget-app]')
    let page = await windowFor(installed.id)
    await until('initial data in installed window', () => guest(getSurface(page), "document.querySelector('#amp')?.value === '4'"))
    assert.equal(await guest(getSurface(page), 'typeof window.kunGui'), 'undefined')
    await save(getSurface(page), 5)
    await send('[gen-ui-smoke-2] Update the controls')
    await until('new revision with saved app state', () => guest(getSurface(page),
      "Boolean(document.querySelector('#revision-two')) && document.querySelector('#amp')?.value === '5'"))
    await guest(getSurface(page), "document.querySelector('#amp-ask').click()")
    await decision('#confirm', 'confirm installed app follow-up')
    await until('follow-up in original conversation', () => main.evaluate(async id => {
      const response = await window.kunGui.runtimeRequest('/v1/threads/' + encodeURIComponent(id), 'GET')
      return JSON.parse(response.body).turns?.some(turn => turn.status === 'completed' &&
        turn.items?.some(item => item.kind === 'user_message' && item.text?.includes('[gen-ui-followup] Explain amplitude 5')))
    }, installed.threadId))
    console.log('PASS install consent, original state, page isolation, revision and conversation follow-up')

    const link = 'kun://apps/' + installed.id
    let launcherDirectory
    let macLauncher
    if (process.platform === 'darwin') {
      const rootDir = join(paths.home, 'Applications')
      const dirs = await readdir(rootDir)
      assert.equal(dirs.length, 1)
      const launchers = join(rootDir, dirs[0])
      launcherDirectory = launchers
      const files = await readdir(launchers)
      assert.equal(files.length, 1)
      const bundle = join(launchers, files[0])
      const executable = join(bundle, 'Contents', 'MacOS', 'launch')
      macLauncher = executable
      const script = await readFile(executable, 'utf8')
      assert.ok(script.includes(link) && script.includes(userData))
      await page.close()
      const environmentKeys = ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TMPDIR', 'XDG_CONFIG_HOME',
        'XDG_CACHE_HOME', 'NODE_ENV', 'KUN_PACKAGED_EXTENSION_DESKTOP_SMOKE', 'KUN_DISABLE_OS_CREDENTIAL_STORE']
      const launcherEnvironment = environmentKeys.flatMap(key => ['--env', key + '=' + env[key]])
      await promisify(execFile)('/usr/bin/open', ['-n', '-W', ...launcherEnvironment, bundle], { env, timeout: 20000 })
      page = await windowFor(installed.id)
      await until('system launcher reopened window', () => guest(getSurface(page), "document.querySelector('#amp')?.value === '5'"))
      await promisify(execFile)(executable, [], { env, timeout: 20000 })
      assert.equal(application.windows().filter(win => win.url().includes(installed.id)).length, 1)
      await guest(getSurface(page), 'window.kun.setWidgetState({modelContent:{amplitude:5},privateContent:{recordNextLaunch:true}})')
      console.log('PASS real macOS launcher and repeated activation')
    }
    await quit()
    await fixture.close()
    if (macLauncher) {
      const cold = spawn(macLauncher, [], { env, stdio: 'ignore' })
      try {
        const stateFile = join(profile, 'extension-data', installed.id, 'state', 'current.json')
        await until('installed macOS launcher restored and saved offline', async () => {
          const state = JSON.parse(await readFile(stateFile, 'utf8')).global['widget-state']
          return state?.privateContent?.reopenedValue === '5'
        })
        assert.equal(JSON.parse(await readFile(join(userData, 'desktop-instance.json'), 'utf8')).pid, cold.pid)
        console.log('PASS cold start from installed macOS executable with the model offline')
      } finally {
        cold.kill('SIGTERM')
        if (!await desktop.waitForPidExit(cold.pid, 30000)) await terminateProcessTree(cold, 'darwin', { timeoutMs: 10000 })
      }
    }
    await launch(link)
    assert.notEqual(child.pid, firstPid)
    page = await windowFor(installed.id)
    await until('cold launch of revised app with its data', () => guest(getSurface(page),
      "Boolean(document.querySelector('#revision-two')) && document.querySelector('#amp')?.value === '5'"))
    await save(getSurface(page), 3)
    const workbench = application.windows().find(candidate => !new URL(candidate.url()).searchParams.has('widgetApp'))
    assert.ok(workbench)
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(win =>
      win.webContents.getURL().includes('index.html') && !win.webContents.getURL().includes('widgetApp=') && win.isVisible())), false)
    await application.evaluate(({ BrowserWindow }) => {
      const owner = BrowserWindow.getAllWindows().find(win => !new URL(win.webContents.getURL()).searchParams.has('widgetApp'))
      owner.show()
      owner.focus()
    })
    await workbench.locator('nav.sidebar-code-nav').getByText('Artifacts', { exact: true }).click()
    const remove = workbench.getByRole('button', { name: /Uninstall.*Amplitude explorer/ })
    await remove.click()
    await decision('#consent-approve', 'confirm uninstall')
    await until('window closed at uninstall', () => page.isClosed())
    assert.deepEqual(await workbench.evaluate(() => window.kunGui.widgetApps.list()), [])
    if (launcherDirectory) assert.deepEqual(await readdir(launcherDirectory), [])
    console.log('PASS cold start, restore and uninstall')
  } catch (error) {
    console.error(error.message, 'Model responses:', fixture.snapshot().observations.map(item => [item.marker, item.response]))
    if (main && !main.isClosed()) console.error((await main.locator('body').innerText({ timeout: 1500 }).catch(() => '')).slice(-1600))
    throw error
  } finally {
    await quit().catch(error => console.error('Desktop cleanup:', error.message))
    await desktop.withTimeout(desktop.stopIsolatedSharedRuntime(repo, profile), 15000, 'stop test runtime')
    await desktop.withTimeout(desktop.stopIsolatedServiceManager(paths.home, profile), 15000, 'stop test manager')
    await fixture.close()
    for (const path of [workspace, root]) {
      await makeTreeWritable(path)
      await rm(path, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 })
    }
  }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
