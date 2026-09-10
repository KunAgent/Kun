#!/usr/bin/env node
'use strict'

const assert = require('node:assert/strict')
const { mkdtemp, mkdir, copyFile, writeFile, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { build } = require('esbuild')
const { _electron } = require('playwright-core')
const { createIsolatedEnvironment } = require('./smoke-packaged-extension-desktop-runtime.cjs')

async function main() {
  const root = resolve(__dirname, '..')
  const temporary = await mkdtemp(join(tmpdir(), 'kun-mini-window-'))
  const userData = join(temporary, 'user-data')
  const paths = {
    home: join(temporary, 'home'), appData: join(temporary, 'app-data'),
    localAppData: join(temporary, 'local-app-data'), temporaryDirectory: join(temporary, 'tmp')
  }
  const evidence = resolve(process.env.KUN_MINI_SMOKE_EVIDENCE || join(root, 'dist', 'mini-window-smoke'))
  let application
  try {
    await Promise.all([mkdir(userData), mkdir(evidence, { recursive: true }),
      ...Object.values(paths).map((path) => mkdir(path))])
    await Promise.all(['result.json', 'failure.txt', 'failure.png'].map((name) =>
      rm(join(evidence, name), { force: true })))
    await build({
      entryPoints: [join(__dirname, 'mini-window-fixture/main.ts')], bundle: true,
      platform: 'node', format: 'cjs', external: ['electron'], outfile: join(temporary, 'main.cjs')
    })
    await build({
      entryPoints: [join(__dirname, 'mini-window-fixture/renderer.tsx')], bundle: true,
      platform: 'browser', format: 'iife', jsx: 'automatic', outfile: join(temporary, 'renderer.js')
    })
    await copyFile(join(__dirname, 'mini-window-fixture/preload.cjs'), join(temporary, 'preload.cjs'))
    await writeFile(join(temporary, 'index.html'), `<!doctype html><html><head>
      <meta charset="UTF-8"><link rel="stylesheet" href="renderer.css">
      <style>
        :root { --ds-bg-main:#fff; --ds-text:#20242d; --ds-text-muted:#687083;
          --ds-border-muted:#ddd; --ds-surface-card:#fff; --ds-surface-hover:#eef1f6; --ds-accent:#5b78ff }
        * { box-sizing:border-box } html,body,#root { height:100%;margin:0;font:14px system-ui }
        .fixture-app { display:flex;height:100%;flex-direction:column }
        .fixture-workbench { display:flex;flex:1;min-height:0 }
        .fixture-sidebar { flex-shrink:0;width:250px;background:#f5f6f8 }
        main { display:flex;flex:1;min-width:0;min-height:0;flex-direction:column;padding:8px;gap:8px }
        .fixture-history { flex:1;min-height:0;overflow:auto }
        textarea { min-height:64px;resize:none } button { min-height:28px;cursor:pointer }
        output { min-height:20px }
      </style></head><body><div id="root"></div><script src="renderer.js"></script></body></html>`)
    const environment = { ...createIsolatedEnvironment(process.env, paths),
      KUN_MINI_SMOKE_USER_DATA: userData, KUN_MINI_SMOKE_APP_DATA: paths.appData }
    application = await _electron.launch({
      executablePath: require('electron'), args: [join(temporary, 'main.cjs')],
      env: environment, timeout: 30_000
    })
    const page = await application.firstWindow()
    page.setDefaultTimeout(10_000)
    await page.getByRole('button', { name: 'Toggle mini' }).waitFor()
    const original = await page.evaluate(() => window.kunGui.getTestState())
    const waitState = (mini, maximized = false) => page.waitForFunction(async ({ mini, maximized, original }) => {
      const state = await window.kunGui.getTestState()
      return state.mini === mini && state.maximized === maximized &&
        (document.documentElement.dataset.kunMini === 'on') === mini &&
        (!mini || maximized || state.bounds.width <= 380) &&
        (mini || maximized || (state.bounds.width === original.width && state.bounds.height === original.height))
    }, { mini, maximized, original: original.bounds })

    await page.getByRole('button', { name: 'Toggle mini' }).click()
    await waitState(true)
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25))
    await page.locator('[data-workbench-left-sidebar]').waitFor({ state: 'hidden' })
    await page.locator('[data-workbench-right-panel]').waitFor({ state: 'hidden' })
    await page.getByRole('textbox', { name: 'Message' }).click()
    await page.keyboard.type('Mini window input works')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    assert.equal(await page.locator('output').innerText(), 'Mini window input works')
    await page.getByTestId('history').hover()
    await page.mouse.wheel(0, 600)
    await page.waitForFunction(() => document.querySelector('[data-testid="history"]').scrollTop > 0)
    await page.screenshot({ path: join(evidence, 'mini-window.png') })
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1))
    await page.getByRole('button', { name: 'Restore window' }).click()
    await waitState(false)
    const restored = await page.evaluate(() => window.kunGui.getTestState())
    assert.deepEqual(restored.bounds, original.bounds)
    assert.deepEqual(restored.minimumSize, original.minimumSize)
    assert.equal(restored.alwaysOnTop, original.alwaysOnTop)
    await page.locator('[data-workbench-left-sidebar]').waitFor({ state: 'visible' })

    await page.getByRole('button', { name: 'Toggle mini' }).click()
    await waitState(true)
    await page.evaluate(() => window.kunGui.runDesktopCommand('maximize'))
    await waitState(true, true)
    await page.getByRole('button', { name: 'Restore window' }).click()
    await waitState(false)
    assert.deepEqual((await page.evaluate(() => window.kunGui.getTestState())).bounds, original.bounds)

    await page.evaluate(() => window.kunGui.runDesktopCommand('maximize'))
    await waitState(false, true)
    await page.getByRole('button', { name: 'Toggle mini' }).click()
    await waitState(true)
    await page.getByRole('button', { name: 'Restore window' }).click()
    await waitState(false, true)
    const result = { status: 'passed', platform: process.platform, original, restored,
      checks: ['typing', 'clicking', 'scrolling', 'zoom-125-percent', 'sidebar-layout',
        'restore', 'maximize-while-mini', 'maximized-transition'] }
    await writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2) + '\n')
    console.log(JSON.stringify(result))
  } catch (error) {
    await writeFile(join(evidence, 'failure.txt'), String(error)).catch(() => undefined)
    await writeFile(join(evidence, 'result.json'), JSON.stringify({
      status: 'failed', platform: process.platform, error: String(error)
    }, null, 2)).catch(() => undefined)
    if (application) {
      const page = application.windows()[0]
      await page?.screenshot({ path: join(evidence, 'failure.png') }).catch(() => undefined)
    }
    throw error
  } finally {
    if (application) await application.close()
    await rm(temporary, { recursive: true, force: true })
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
