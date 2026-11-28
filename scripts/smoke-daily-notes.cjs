// Runs the built notes page, sandboxed preloads and remote writer in an isolated profile.
'use strict'
const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { promisify } = require('node:util')
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
    await writeFile(join(renderer, 'index.html'), `<!doctype html><title>Test workbench</title><script>
      window.__kunReceived = []
      window.__kunStartedThreads = []
      window.__kunDockedPayloads = []
      window.__kunOpenedLinks = []
      window.__kunSummaries = {}
      window.kunGui?.dailyNotes?.onCommand((cmd, reply) => {
        if (cmd.kind === 'send-to-kun') {
          window.__kunReceived.push(cmd.request)
          reply({ ok: true, roomId: 'room-kun', messageId: 'msg-1', agentLabel: '小Kun' })
        } else if (cmd.kind === 'start-thread') {
          window.__kunStartedThreads.push(cmd.request)
          reply({ ok: true, threadId: 'thr-direct-1', title: 'KunRepo' })
        } else if (cmd.kind === 'list-targets') {
          reply({
            activeWorkspaceRoot: '/workspace/KunRepo',
            projects: [{ root: '/workspace/KunRepo', label: 'KunRepo' }],
            threads: [{ id: 'thr-existing', title: '性能优化排查', workspaceRoot: '/workspace/KunRepo', workspaceLabel: 'KunRepo', status: 'running' }]
          })
        } else if (cmd.kind === 'dock-in-workbench') {
          window.__kunDockedPayloads.push(cmd.payload || {})
          reply(true)
        } else if (cmd.kind === 'open-link') {
          window.__kunOpenedLinks.push(cmd.url)
          reply(true)
        } else if (cmd.kind === 'watch-links') {
          const out = {}
          for (const url of cmd.urls) {
            out[url] = window.__kunSummaries[url] || (url.includes('dispatch/')
              ? { url, tone: 'running', statusText: '运行中 · Kun', detail: '正在执行测试' }
              : { url, tone: 'running', statusText: '小Kun处理中' })
          }
          reply(out)
        }
      })
    </script>`)
    await writeFile(join(fixture, 'package.json'), JSON.stringify({ name: 'kun-note-test', main: 'main.cjs' }))
    await writeFile(join(notes, '2020-02-29.md'), '- [ ] Earlier task\n')
    await build({ stdin: { resolveDir: root, contents: `
      const { app, BrowserWindow } = require('electron')
      const { join } = require('node:path')
      const { registerDailyNotesIpc } = require('./src/main/daily-notes/window')
      const { DailyNotesStore } = require('./src/main/daily-notes/store')
      const originalSave = DailyNotesStore.prototype.save
      DailyNotesStore.prototype.save = async function (...args) {
        const pause = globalThis.nextDesktopNoteSave
        globalThis.nextDesktopNoteSave = undefined
        await pause
        return originalSave.apply(this, args)
      }
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
    const selectedDay = page => page.locator('.daily-notes').getAttribute('data-selected-day')
    const pickQuickDate = async (page, targetDay) => {
      await page.locator('.note-title-button').click()
      await page.getByRole('dialog', { name: '选择笔记日期' }).waitFor()
      await page.locator(`[data-quick-day="${targetDay}"]`).click()
      await page.waitForFunction(expected => document.querySelector('.daily-notes')?.dataset.selectedDay === expected, targetDay)
    }

    let page = await open()
    const day = await selectedDay(page)
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

    // Date-picker popover: jump to saved historical date and back to today.
    await pickQuickDate(page, '2020-02-29')
    await page.getByRole('checkbox', { name: 'Earlier task' }).check()
    await pickQuickDate(page, day)
    await page.getByRole('checkbox', { name: '跟进反馈', checked: true }).waitFor()
    assert.equal(await readFile(todayFile, 'utf8'), '用户反馈\n- [x] 跟进反馈')
    assert.equal(await readFile(join(notes, '2020-02-29.md'), 'utf8'), '- [x] Earlier task\n')

    // Four-quadrant view: classify, drag, inline-add, and hand a task to Xiao Kun.
    await page.getByRole('button', { name: '四象限' }).click()
    await page.getByRole('button', { name: '跟进反馈 → 重要且紧急' }).click()
    await page.locator('[data-quadrant="1"] [data-task-line="1"]').dragTo(page.locator('[data-quadrant="3"]'))
    await page.getByRole('button', { name: '重要不紧急: 添加', exact: true }).click()
    await page.getByRole('textbox', { name: '重要不紧急: 添加待办', exact: true }).fill('整理设计稿')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Escape')

    // Hand task over to Xiao Kun -> upgrades to kun://dispatch -> live completion -> 1-click check.
    await page.getByRole('button', { name: '整理设计稿: 交给小Kun' }).click()
    await page.getByRole('button', { name: /小Kun处理中/ }).waitFor()
    const sentItems = await owner.evaluate(() => window.__kunReceived)
    assert.equal(sentItems.length, 1)
    assert.equal(sentItems[0].items[0].text, '整理设计稿')
    await owner.evaluate(async targetDay => {
      await window.kunGui.dailyNotes.bindDispatchLink({
        day: targetDay,
        taskText: '整理设计稿',
        previousUrl: 'kun://room/room-kun?message=msg-1',
        roomId: 'room-kun',
        linkId: 'wbl-42',
        label: '小Kun'
      })
      const completedSummary = {
        url: 'kun://dispatch/room-kun/wbl-42',
        tone: 'completed',
        statusText: '已完成',
        detail: '回归测试全部通过',
        canMarkDone: true
      }
      window.__kunSummaries[completedSummary.url] = completedSummary
      window.kunGui.dailyNotes.publishLinkSummaries({
        [completedSummary.url]: completedSummary
      })
    }, day)
    await page.getByRole('button', { name: /已完成 — 回归测试全部通过/ }).click()
    assert.deepEqual(await owner.evaluate(() => window.__kunOpenedLinks), ['kun://dispatch/room-kun/wbl-42'])
    await page.getByRole('button', { name: '整理设计稿: 勾选待办完成' }).click()
    await page.getByRole('checkbox', { name: '整理设计稿', checked: true }).waitFor()

    // Workbench reverse appendTask hot-syncs into the open Daily Notes window.
    await owner.evaluate(async targetDay => {
      await window.kunGui.dailyNotes.appendTask({
        day: targetDay,
        text: '来自会话的待办',
        quadrant: 1,
        linkLabel: '会话',
        linkUrl: 'kun://thread/thr-99'
      })
    }, day)
    await page.getByRole('checkbox', { name: '来自会话的待办' }).waitFor()

    // Calendar month view: inspect bars, check task in day pane, and jump back to page editor.
    await page.getByRole('button', { name: '月历' }).click()
    assert.equal(await page.locator('.note-month-cell').count(), 42)
    await page.getByRole('checkbox', { name: '来自会话的待办' }).check()
    await page.getByRole('button', { name: '打开页面' }).click()
    await page.getByRole('textbox', { name: '每日待办与笔记' }).waitFor()
    await page.getByRole('button', { name: '紧急不重要', exact: true }).waitFor()
    await page.getByRole('button', { name: '重要不紧急', exact: true }).waitFor()

    const geometry = await application.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/daily-notes.html'))
      win.setSize(392, 512)
      return win.getBounds()
    })
    await page.getByRole('textbox').press('ControlOrMeta+End')
    await page.keyboard.insertText('\n备注！')
    await close(page)
    assert.equal(await readFile(todayFile, 'utf8'), [
      '用户反馈',
      '- [x] 跟进反馈 !3',
      '- [x] 整理设计稿 [小Kun](kun://dispatch/room-kun/wbl-42) !2',
      '- [x] 来自会话的待办 [会话](kun://thread/thr-99) !1',
      '备注！'
    ].join('\n'))
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

    // Keep a deliberately selected historical page in place across midnight, then test rollover!
    await pickQuickDate(page, '2020-02-29')
    await page.getByRole('checkbox', { name: 'Earlier task' }).waitFor()
    const tomorrow = new Date(day + 'T12:00:00')
    tomorrow.setDate(tomorrow.getDate() + 1)
    await page.clock.setFixedTime(tomorrow)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    assert.equal(await selectedDay(page), '2020-02-29')
    await page.getByRole('button', { name: '回到今天' }).click()
    await page.waitForFunction(previous => {
      const current = document.querySelector('.daily-notes')?.dataset.selectedDay
      return Boolean(current && current !== '2020-02-29' && current !== previous)
    }, day)
    const nextDay = await selectedDay(page)
    assert.notEqual(nextDay, day)
    await page.getByRole('textbox').fill('- [ ] 跨日顺延待办 !1')
    const following = new Date(tomorrow)
    following.setDate(following.getDate() + 1)
    await page.clock.setFixedTime(following)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForFunction(previous => document.querySelector('.daily-notes')?.dataset.selectedDay !== previous, nextDay)
    assert.equal(await readFile(join(notes, nextDay + '.md'), 'utf8'), '- [ ] 跨日顺延待办 !1')

    // Rollover banner carries unfinished tasks from nextDay into following day.
    await page.getByRole('button', { name: '顺延到今天' }).click()
    await page.getByRole('checkbox', { name: '跨日顺延待办' }).waitFor()
    assert.equal(await readFile(join(notes, nextDay + '.md'), 'utf8'), '')

    // Continuous day stream renders non-empty historical day (`day`) right below today.
    await page.locator(`[data-stream-day="${day}"]`).waitFor()

    // Focus View (drill-down): zoom into task, write sub-notes, start direct session, and return via breadcrumb.
    await page.getByRole('button', { name: '跨日顺延待办: 下钻聚焦此待办' }).click()
    await page.locator('.note-page.is-focus-view').waitFor()
    await page.getByRole('textbox', { name: '每日待办与笔记' }).focus()
    await page.keyboard.insertText('- 根源分析说明')
    await page.getByRole('button', { name: '跨日顺延待办: 直接启动会话' }).click()
    await page.getByRole('dialog', { name: '从待办直接启动会话' }).waitFor()
    await page.getByRole('button', { name: '启动会话', exact: true }).click()
    await page.getByRole('button', { name: /小Kun处理中|KunRepo/ }).waitFor()
    const started = await owner.evaluate(() => window.__kunStartedThreads)
    assert.equal(started.length, 1)
    assert.match(started[0].prompt, /根源分析说明/)
    await page.locator('.note-crumb-back').click()
    await page.locator('.note-bullet-dot.is-ringed').first().waitFor()

    // Dock-to-workbench closes the floating window and forwards the active day to the main workbench.
    const followingDay = await selectedDay(page)
    const closedOnDock = page.waitForEvent('close')
    await page.getByRole('button', { name: '停靠到主窗口侧边' }).click()
    await closedOnDock
    const dockedPayloads = await owner.evaluate(() => window.__kunDockedPayloads)
    assert.equal(dockedPayloads[0]?.day, followingDay)
    const wbRead = await owner.evaluate(targetDay => window.kunGui.dailyNotes.read(targetDay), followingDay)
    assert.match(wbRead.markdown, /kun:\/\/thread\/thr-direct-1/)
    assert.match(wbRead.markdown, / {2}- 根源分析说明/)

    // Reopen standalone window for final flush-on-quit check.
    page = await open()
    await pickQuickDate(page, day)
    await page.getByRole('checkbox', { name: '跟进反馈' }).waitFor()

    // Pause the desktop autosave while the real Kun remote service writes in another process.
    await application.evaluate(() => {
      globalThis.nextDesktopNoteSave = new Promise(resolve => { globalThis.resumeDesktopNoteSave = resolve })
    })
    const stale = await page.evaluate(targetDay => window.kunDailyNotes.read(targetDay), day)
    await page.getByRole('textbox').press('ControlOrMeta+End')
    await page.keyboard.insertText('\n本地草稿')
    await page.getByText('正在保存…', { exact: true }).waitFor()
    const remoteWriter = pathToFileURL(join(root, 'kun', 'dist', 'remote', 'daily-notes', 'service.js')).href
    await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', `
      const [moduleUrl, dailyNotesDir, day, revision] = process.argv.slice(1)
      const { RemoteDailyNotes } = await import(moduleUrl)
      const remote = new RemoteDailyNotes({ dailyNotesDir, threadService: { getMetadata: async () => null } })
      const page = await remote.get(day)
      const task = page.tasks.find(task => task.title === '跟进反馈')
      if (!task?.done) throw new Error('Expected a completed task')
      const params = { day, line: task.line, expectedRevision: revision, done: false }
      const method = 'daily.notes.update'
      await remote.preflight(method, params)
      const result = await remote.dispatch({ call: { method, requestId: 'remote-check' } }, params)
      if (result.page.tasks.find(candidate => candidate.line === task.line)?.done !== false) {
        throw new Error('Remote update did not persist')
      }
    `, remoteWriter, notes, day, stale.revision], { timeout: 10_000 })
    await application.evaluate(() => globalThis.resumeDesktopNoteSave())
    await page.getByRole('alert').filter({ hasText: '草稿仍保留' }).waitFor()
    assert.match(await page.getByRole('textbox').textContent(), /本地草稿/)
    assert.match(await readFile(todayFile, 'utf8'), /- \[ \] 跟进反馈/)

    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.__copiedDraft = text } } })
    })
    await page.getByRole('button', { name: '复制草稿并载入最新版' }).click()
    await page.getByRole('checkbox', { name: '跟进反馈', checked: false }).waitFor()
    assert.match(await page.evaluate(() => window.__copiedDraft), /本地草稿/)

    await page.getByRole('textbox').press('ControlOrMeta+End')
    await page.keyboard.insertText('保存')
    await application.close()
    application = null
    assert.match(await readFile(todayFile, 'utf8'), /保存$/)
    console.log('Daily notes passed: singleton, IME, checkbox, date-picker, stream, focus-drilldown, direct-session, dock-bridge, quadrants, calendar, Kun handoff, live link sync, reverse append, rollover, midnight, close, geometry, pin, cross-process save conflicts, draft recovery and quit.')
  } finally {
    if (application) {
      await application.evaluate(({ app }) => app.exit()).catch(() => undefined)
      await application.close().catch(() => undefined)
    }
    await rm(fixture, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
