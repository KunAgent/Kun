// Runs the built notes page and both sandboxed preloads in an isolated Electron profile.
'use strict'
const assert = require('node:assert/strict')
const { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { build } = require('esbuild')
const { _electron } = require('playwright-core')
const { scrubDesktopEnvironment } = require('./smoke-packaged-extension-desktop-runtime.cjs')

async function main() {
  const root = resolve(__dirname, '..')
  const fixture = await mkdtemp(join(tmpdir(), 'kun-note-window-'))
  const renderer = join(fixture, 'out', 'renderer')
  const profile = join(fixture, 'profile')
  const notes = join(profile, 'daily-notes')
  let application
  try {
    await mkdir(renderer, { recursive: true })
    await mkdir(notes, { recursive: true })
    await symlink(join(root, 'out', 'preload'), join(fixture, 'out', 'preload'), 'junction')
    await symlink(join(root, 'out', 'renderer', 'assets'), join(renderer, 'assets'), 'junction')
    await copyFile(join(root, 'out', 'renderer', 'daily-notes.html'), join(renderer, 'daily-notes.html'))
    await writeFile(join(renderer, 'index.html'), '<!doctype html><title>Test workbench</title>')
    await writeFile(join(fixture, 'package.json'), JSON.stringify({ name: 'kun-note-test', main: 'main.cjs' }))
    await writeFile(join(notes, '2020-02-29.md'), '- [ ] Earlier task\n')
    await build({ stdin: { resolveDir: root, contents: `
      const { app, BrowserWindow } = require('electron')
      const { join } = require('node:path')
      const { registerDailyNotesIpc } = require('./src/main/daily-notes/window')
      app.setPath('userData', join(app.getAppPath(), 'profile'))
      app.whenReady().then(async () => {
        const out = join(app.getAppPath(), 'out')
        const owner = new BrowserWindow({ show: false, webPreferences: {
          preload: join(out, 'preload', 'index.cjs'), sandbox: true, contextIsolation: true
        } })
        registerDailyNotesIpc({ getMainWindow: () => owner, getAppearance: () => ({ locale: 'zh', theme: 'light' }) })
        await owner.loadFile(join(out, 'renderer', 'index.html'))
      })
    ` }, platform: 'node', format: 'cjs', bundle: true, external: ['electron'], outfile: join(fixture, 'main.cjs') })
    application = await _electron.launch({
      executablePath: require('electron'), args: [fixture], env: scrubDesktopEnvironment(process.env)
    })
    const owner = await application.firstWindow()
    const open = async () => {
      const waiting = application.waitForEvent('window')
      await owner.evaluate(() => window.kunGui.openDailyNotes())
      const page = await waiting
      page.setDefaultTimeout(8_000)
      await page.getByRole('textbox', { name: '每日待办与笔记' }).waitFor()
      return page
    }
    const close = async page => {
      const closed = page.waitForEvent('close')
      await application.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/daily-notes.html')).close()
      })
      await closed
    }

    let page = await open()
    const day = await page.getByRole('combobox').inputValue()
    const todayFile = join(notes, day + '.md')
    await owner.evaluate(() => window.kunGui.openDailyNotes())
    assert.equal(application.windows().length, 2)
    assert.equal(await page.evaluate(() => typeof window.kunGui), 'undefined')
    const pinSupported = await page.evaluate(async () => (await window.kunDailyNotes.context()).canPin)
    if (pinSupported) {
      await page.getByRole('button', { name: '取消窗口置顶' }).click()
      await page.getByRole('button', { name: '窗口置顶', exact: true }).waitFor()
    }
    await page.getByRole('textbox').focus()
    const input = await application.context().newCDPSession(page)
    await input.send('Input.imeSetComposition', { text: '用户', selectionStart: 2, selectionEnd: 2 })
    await input.send('Input.imeSetComposition', { text: '用户反馈', selectionStart: 4, selectionEnd: 4 })
    await input.send('Input.insertText', { text: '用户反馈' })
    await input.detach()
    await page.getByRole('button', { name: '添加待办' }).click()
    await page.keyboard.insertText('跟进反馈')
    await page.getByRole('checkbox', { name: '跟进反馈' }).check()
    await page.getByRole('combobox').selectOption('2020-02-29')
    await page.getByRole('checkbox', { name: 'Earlier task' }).check()
    await page.getByRole('combobox').selectOption(day)
    await page.getByRole('checkbox', { name: '跟进反馈', checked: true }).waitFor()
    assert.equal(await readFile(todayFile, 'utf8'), '用户反馈\n- [x] 跟进反馈')
    assert.equal(await readFile(join(notes, '2020-02-29.md'), 'utf8'), '- [x] Earlier task\n')

    const geometry = await application.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/daily-notes.html'))
      win.setSize(392, 512)
      return win.getBounds()
    })
    await page.getByRole('textbox').press('ControlOrMeta+End')
    await page.keyboard.insertText('！')
    await close(page)
    assert.match(await readFile(todayFile, 'utf8'), /！$/)
    page = await open()
    const restored = await application.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/daily-notes.html'))
      return { bounds: win.getBounds(), pinned: win.isAlwaysOnTop() }
    })
    assert.equal(restored.bounds.width, geometry.width)
    assert.equal(restored.bounds.height, geometry.height)
    if (pinSupported) {
      assert.deepEqual(restored.bounds, geometry)
      assert.equal(restored.pinned, false)
      await page.getByRole('button', { name: '窗口置顶', exact: true }).click()
      await page.getByRole('button', { name: '取消窗口置顶' }).waitFor()
    }
    await application.evaluate(({ BrowserWindow }) => {
      const workbench = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/index.html'))
      workbench.show()
      workbench.focus()
    })
    await owner.waitForFunction(() => document.hasFocus())
    assert.equal(await page.evaluate(() => document.visibilityState), 'visible')

    // Keep a deliberately selected historical page in place across midnight.
    await page.getByRole('combobox').selectOption('2020-02-29')
    await page.getByRole('checkbox', { name: 'Earlier task' }).waitFor()
    const tomorrow = new Date(day + 'T12:00:00')
    tomorrow.setDate(tomorrow.getDate() + 1)
    await page.clock.setFixedTime(tomorrow)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    assert.equal(await page.getByRole('combobox').inputValue(), '2020-02-29')
    const nextDay = await page.locator('option').first().getAttribute('value')
    assert.notEqual(nextDay, day)
    await page.getByRole('combobox').selectOption(nextDay)
    await page.waitForFunction(date => document.querySelector('select').value === date, nextDay)
    await page.getByRole('textbox').fill('新一天')
    const following = new Date(tomorrow)
    following.setDate(following.getDate() + 1)
    await page.clock.setFixedTime(following)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForFunction(date => document.querySelector('select').value !== date, nextDay)
    assert.equal(await readFile(join(notes, nextDay + '.md'), 'utf8'), '新一天')
    await page.getByRole('combobox').selectOption(day)
    await page.getByRole('checkbox', { name: /跟进反馈/ }).waitFor()

    await page.getByRole('textbox').press('ControlOrMeta+End')
    await page.keyboard.insertText('保存')
    await application.close()
    application = null
    assert.match(await readFile(todayFile, 'utf8'), /保存$/)
    console.log('Daily notes passed: singleton, IME composition, checkbox, history, midnight, focus, close, geometry, pin and quit.')
  } finally {
    if (application) await application.close()
    await rm(fixture, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
