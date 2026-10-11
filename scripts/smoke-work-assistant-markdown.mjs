import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron, chromium } from 'playwright-core'
import { createServer } from 'vite'
import { countWorkAssistantCjkGlyphs } from './work-assistant-markdown-fonts.mjs'

// Native Electron is authoritative. --browser and --serve are supplementary
// diagnostics and can never produce a passing native report.
const require = createRequire(import.meta.url)
const repository = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(join(repository, 'node_modules/.kun-work-markdown-'))
const evidence = resolve(process.env.KUN_WORK_MARKDOWN_EVIDENCE || 'dist/work-assistant-markdown')
const native = !process.argv.includes('--browser')
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim()
const dirty = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim().split('\n').filter(Boolean)
const checks = [], failures = [], errors = [], externalRequests = [], metrics = [], screenshots = []
let server, application, browser, page, origin, fatal, nativeVersions
await mkdir(evidence, { recursive: true })
// Preserve a truthful report even if the native executable crashes before the
// Playwright launch promise settles (including rejected native namespaces).
process.on('uncaughtExceptionMonitor', error => {
  writeFileSync(join(evidence, 'report.json'), JSON.stringify({
    status: 'failed', engine: native ? 'native-electron' : 'browser-diagnostic',
    commitSha: sha, dirtyTrackedFiles: dirty, checks, failures, errors, externalRequests,
    screenshots, fatal: error.stack || String(error)
  }, null, 2))
})
const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,">
<style>
/* Fixture framing only. Assistant, timeline, tokens and prose use real CSS. */
html,body,#root{height:100%;margin:0;overflow:hidden;-webkit-app-region:no-drag}
.markdown-fixture-shell{height:100%;min-width:0;display:flex;flex-direction:column;background:var(--ds-bg-main)}
.markdown-fixture-label{padding:12px 16px;flex:none;border-bottom:1px solid var(--ds-border);color:var(--ds-text-muted);font:12px/1.5 sans-serif}
.markdown-fixture-label strong,.markdown-fixture-label span{display:block}
.markdown-fixture-shell>.write-assistant-panel,.markdown-fixture-code{flex:1;min-height:0;width:100%;display:flex;flex-direction:column}
</style></head><body><div id="root"></div>
<script type="module" src="/scripts/fixtures/work-assistant-markdown.tsx"></script></body></html>`
try {
  server = await createServer({
    configFile: false, root: repository, cacheDir: join(temporary, 'vite-cache'),
    esbuild: { jsx: 'automatic' }, optimizeDeps: { entries: [] }, css: { postcss: repository },
    resolve: { alias: {
      '@renderer': resolve(repository, 'src/renderer/src'),
      '@shared': resolve(repository, 'src/shared'),
      '@kun/provider-catalog': resolve(repository, 'packages/provider-catalog/src/index.ts'),
      '@kun/extension-api': resolve(repository, 'packages/extension-api/src/index.ts'),
      '@kun/extension-react': resolve(repository, 'packages/extension-react/src/index.ts')
    } },
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 'work-assistant-markdown-fixture', configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?')[0] !== '/__work_markdown') return next()
        response.setHeader('Content-Type', 'text/html')
        response.end(await vite.transformIndexHtml('/__work_markdown', html))
      })
    } }]
  })
  await server.listen()
  origin = new URL(server.resolvedUrls.local[0]).origin
  if (process.argv.includes('--serve')) {
    console.log(origin + '/__work_markdown')
    await new Promise(() => {})
  }
  if (native) {
    const main = join(temporary, 'main.cjs')
    await writeFile(main, `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(join(temporary, 'profile'))});
globalThis.fixtureNavigations=[];
app.on('web-contents-created',(_event,contents)=>{
  contents.setWindowOpenHandler(({url})=>{globalThis.fixtureNavigations.push(url);return {action:'deny'}});
  contents.on('will-navigate',(event,url)=>{if(!url.startsWith(${JSON.stringify(origin + '/')})){event.preventDefault();globalThis.fixtureNavigations.push(url)}});
});
app.whenReady().then(()=>{const win=new BrowserWindow({width:680,height:1100,show:true,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});win.loadURL('about:blank')});
app.on('window-all-closed',()=>app.quit());`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    application = await _electron.launch({ executablePath: require('electron'),
      args: [main], env, timeout: 90_000 })
    nativeVersions = await application.evaluate(() => ({ electron: process.versions.electron, chrome: process.versions.chrome }))
    page = await application.firstWindow({ timeout: 90_000 })
  } else {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium',
      headless: true, chromiumSandbox: true })
    page = await browser.newPage({ viewport: { width: 680, height: 1100 } })
  }
  await page.context().route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin === origin) return route.continue()
    externalRequests.push({ url: url.href, resourceType: route.request().resourceType() })
    return route.abort('blockedbyclient')
  })
  page.setDefaultTimeout(30_000)
  page.on('pageerror', error => errors.push(error.stack || error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(origin + '/__work_markdown', { timeout: 90_000 })
  await ready()

  for (const theme of ['light', 'dark']) {
    for (const width of [680, 360]) {
      const label = `${theme}-${width}`
      await resize(width)
      await page.evaluate(theme => window.workMarkdownFixture.setTheme(theme), theme)
      await scenario('before')
      await check(`historical plain-text regression reproduced (${label})`, async () => {
        const answer = page.locator('[data-timeline-block-id="fixture-answer"] .ds-chat-answer')
        assert.ok((await answer.innerText()).startsWith('# Evidence summary'))
        assert.equal(await answer.locator('h1,table,.katex,pre').count(), 0)
        await screenshot(`${label}-before-literal-markdown`, 'top')
      })
      await scenario('paper')
      await check(`full Work panel renders GFM and local math (${label})`, async () => {
        assert.equal(await page.locator('.write-assistant-panel .ds-passive-markdown').count(), 1)
        const result = await inspect(label)
        await screenshot(`${label}-after-paper-markdown`, 'top')
        await screenshot(`${label}-after-paper-math-code`, 'bottom')
        validate(result)
      })
    }
  }
  await check('light and dark use distinct production foreground and surface colors', async () => {
    const light = metrics.find(entry => entry.label === 'light-680')
    const dark = metrics.find(entry => entry.label === 'dark-680')
    assert.ok(light && dark, 'light/dark layout measurements must be retained even when font validation fails')
    assert.notEqual(light.color, dark.color)
    assert.notEqual(light.background, dark.background)
  })
  await resize(680)
  await page.evaluate(() => window.workMarkdownFixture.setTheme('light'))
  await check('running item updates stay formatted and passive until final completion', async () => {
    for (const text of [
      '# Partial answer\n\n**Stream',
      '# Partial answer\n\n![unfinished](https://attacker.invalid/',
      '# Partial answer\n\n$$\\frac{',
      '# Partial answer\n\n![complete](https://attacker.invalid/complete)\n\n**Updated**'
    ]) {
      await page.evaluate(text => window.workMarkdownFixture.stream(text), text)
      await page.locator('.ds-passive-markdown h1').waitFor()
      await settled()
      await assertPassive()
      const state = await page.evaluate(() => window.workMarkdownFixture.snapshot())
      assert.equal(state.item.status, 'running')
      assert.equal(state.block.renderMode, 'safe-markdown')
    }
    await screenshot('streaming-partial-paper', 'top')
    // Reopen the serialized running item while it still has its rendering policy.
    await page.evaluate(() => window.workMarkdownFixture.save())
    await page.reload()
    await ready()
    assert.equal((await page.evaluate(() => window.workMarkdownFixture.snapshot())).item.status, 'running')
    await assertPassive()
    await page.evaluate(() => window.workMarkdownFixture.finish())
    await page.locator('.ds-passive-markdown h1').filter({ hasText: 'Evidence summary' }).waitFor()
    const result = await inspect('stream-final')
    await screenshot('streaming-final-paper', 'top')
    validate(result)
  })
  await check('completed item JSON survives simulated reopen via renderer reload without literal Markdown', async () => {
    const saved = await page.evaluate(() => window.workMarkdownFixture.save())
    await page.reload()
    await ready()
    assert.deepEqual((await page.evaluate(() => window.workMarkdownFixture.snapshot())).item, saved.item)
    const result = await inspect('completed-reopen')
    await screenshot('completed-reopen-paper', 'top')
    validate(result)
  })
  for (const ordinary of ['ordinary-work', 'ordinary-code']) {
    await check(`${ordinary} retains the shared normal Streamdown renderer`, async () => {
      await scenario(ordinary)
      assert.equal(await page.locator('.ds-passive-markdown').count(), 0)
      await page.locator('.ds-chat-answer h1').waitFor()
      assert.ok(await page.locator('.ds-chat-answer table').count() > 0)
      assert.ok(await page.locator('.ds-chat-answer .katex').count() > 0)
      assert.equal(await page.locator('.ds-chat-answer a').filter({ hasText: 'Ordinary reference' }).count(), 1)
      await screenshot(`${ordinary}-shared-streamdown`, 'top')
    })
  }
  await check('hostile paper images, HTML, LaTeX URLs and executable fences stay inert', async () => {
    for (const width of [680, 360]) {
      await resize(width)
      await scenario('hostile')
      const workDetails = page.locator('button[data-work-meta-row="true"][aria-expanded="false"]')
      if (await workDetails.count()) await workDetails.first().click()
      const reasoning = page.getByRole('button', { name: 'Thinking', exact: true })
      if (await reasoning.getAttribute('aria-expanded') === 'false') await reasoning.click()
      await page.locator('.ds-passive-markdown h2').filter({ hasText: 'Untrusted reasoning' }).waitFor()
      await assertPassive()
      assert.equal(await page.locator('.ds-passive-markdown pre code').count(), 3)
      for (const text of ['Remote image label', 'Remote link label', 'File link label', 'Reasoning image label', 'Reasoning link label']) {
        await page.locator('.ds-passive-markdown').getByText(text, { exact: true }).click()
      }
      await settled()
      assert.equal(await page.evaluate(() => window.__markdownXss), 0)
      assert.deepEqual(await page.evaluate(() => window.workMarkdownFixture.calls), [])
      await screenshot(`hostile-inert-${width}`, 'top')
    }
  })
  await check('no attempted remote resources, app actions, popups or uncaught errors', async () => {
    assert.deepEqual(externalRequests, [], 'even a blocked remote resource attempt fails this smoke')
    assert.deepEqual(await page.evaluate(() => window.workMarkdownFixture.calls), [])
    assert.deepEqual(await page.evaluate(() => window.workMarkdownFixture.reads.filter(read => read.method !== 'GET')), [])
    if (application) assert.deepEqual(await application.evaluate(() => globalThis.fixtureNavigations), [])
    assert.deepEqual(errors, [])
  })
  assert.deepEqual(failures, [], 'native Work Markdown smoke failed; inspect report.json')
  console.log(`${native ? 'PASS native Electron' : 'DIAGNOSTIC browser'} Work assistant Markdown: ${checks.length} checks`)
} catch (error) {
  fatal = error.stack || String(error)
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(evidence, 'failure.png'), fullPage: true }).catch(() => undefined)
    await writeFile(join(evidence, 'failure.html'), await page.content()).catch(() => undefined)
  }
  console.error(fatal)
  process.exitCode = 1
} finally {
  await writeFile(join(evidence, 'report.json'), JSON.stringify({
    status: fatal || failures.length ? 'failed' : native ? 'passed' : 'diagnostic-only',
    engine: native ? 'native-electron' : 'browser-diagnostic', nativeVersions, commitSha: sha, dirtyTrackedFiles: dirty,
    fixture: 'Production WriteAssistantPanel -> LazyMessageTimeline -> MessageBubble -> AssistantMarkdown',
    boundary: 'Isolated synthetic preload/runtime services and serialized item fixture; no live model, account, production IPC, or real conversation database.',
    beforeBoundary: 'Same source sent to the retained legacy plain-text renderer, reproducing the previous paper policy; not a separate historical app binary.',
    reopenBoundary: 'Serialized runtime item JSON in isolated localStorage, real mapper/live projection, and renderer reload; backend persistence has separate unit coverage.',
    checks, failures, errors, externalRequests, metrics, screenshots,
    bridgeTraffic: page && !page.isClosed() ? await page.evaluate(() => ({ reads: window.workMarkdownFixture?.reads, calls: window.workMarkdownFixture?.calls })).catch(() => null) : null, fatal
  }, null, 2))
  await application?.close().catch(() => undefined)
  await browser?.close().catch(() => undefined)
  await server?.close()
  await rm(temporary, { recursive: true, force: true })
}

async function check(name, run) {
  try { await run(); checks.push(name); console.log('PASS', name) }
  catch (error) { failures.push({ name, error: error.stack || String(error) }); console.error('FAIL', name, error.message) }
}
async function ready() {
  await page.waitForFunction(() => window.workMarkdownFixture?.ready, undefined, { timeout: 120_000 })
  await page.locator('.ds-passive-markdown h1').waitFor({ timeout: 120_000 })
  await page.evaluate(() => document.fonts.ready)
  await settled()
}
async function scenario(name) {
  await page.evaluate(name => window.workMarkdownFixture.scenario(name), name)
  await page.waitForFunction(name => window.workMarkdownFixture.snapshot().scenario === name, name)
  if (name === 'paper' || name === 'hostile') await page.locator('.ds-passive-markdown h1').waitFor()
  else if (name.startsWith('ordinary')) await page.locator('.ds-chat-answer h1').waitFor()
  await settled()
}
async function resize(width) {
  if (application) await application.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 1100), width)
  await page.setViewportSize({ width, height: 1100 })
  await page.waitForFunction(width => innerWidth === width, width)
}
async function settled() {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.waitForTimeout(200)
}
async function screenshot(name, position) {
  await page.evaluate(position => {
    const candidates = [...document.querySelectorAll('.write-assistant-timeline *, .markdown-fixture-code *')]
    const scroller = candidates.find(node => ['auto', 'scroll'].includes(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 10)
    if (scroller) scroller.scrollTop = position === 'top' ? 0 : scroller.scrollHeight
  }, position)
  await settled()
  const filename = `${native ? 'electron' : 'browser'}-${name}.png`
  await page.screenshot({ path: join(evidence, filename), fullPage: true })
  screenshots.push(filename)
}
async function assertPassive() {
  const active = await page.locator('.ds-passive-markdown').evaluateAll(roots => roots.flatMap(root => [...root.querySelectorAll('*')].flatMap(node => {
    const unsafeTag = ['A', 'IMG', 'IFRAME', 'OBJECT', 'EMBED', 'SCRIPT', 'STYLE', 'LINK', 'BUTTON', 'FORM', 'VIDEO', 'AUDIO', 'SOURCE', 'FOREIGNOBJECT'].includes(node.tagName.toUpperCase())
    const unsafeAttribute = [...node.attributes].some(attribute => /^on|^(href|src|srcset|poster|xlink:href)$/i.test(attribute.name) || /url\s*\(/i.test(attribute.value))
    return unsafeTag || unsafeAttribute || node.classList.contains('math-injected') ? [node.outerHTML] : []
  })))
  assert.deepEqual(active, [])
}
async function inspect(label) {
  await page.evaluate(() => document.fonts.ready)
  const result = await page.locator('.ds-passive-markdown').evaluate((root, label) => {
    const scroll = node => {
      node.scrollLeft = 80
      const entry = { width: node.clientWidth, scrollWidth: node.scrollWidth,
        overflow: getComputedStyle(node).overflowX, scrolled: node.scrollLeft }
      node.scrollLeft = 0
      return entry
    }
    return { label, viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
      panelWidth: document.querySelector('.write-assistant-panel').getBoundingClientRect().width,
      color: getComputedStyle(root).color, background: getComputedStyle(document.querySelector('.write-assistant-panel')).backgroundColor,
      headings: [1, 2, 3, 4, 5, 6].map(level => root.querySelectorAll(`h${level}`).length),
      tableRows: root.querySelectorAll('tbody tr').length,
      nested: root.querySelector('ol ul ul li')?.textContent,
      checkboxes: [...root.querySelectorAll('input[type=checkbox]')].map(node => ({ disabled: node.disabled, checked: node.checked })),
      code: root.querySelector('pre code')?.textContent,
      text: root.textContent,
      fonts: [...document.fonts].filter(font => font.status === 'loaded').map(font => font.family),
      math: [...root.querySelectorAll('.katex')].map(node => ({ font: getComputedStyle(node).fontFamily, height: node.getBoundingClientRect().height })),
      mathml: [...root.querySelectorAll('.katex-mathml')].map(node => ({ position: getComputedStyle(node).position,
        width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height, overflow: getComputedStyle(node).overflow })),
      tables: [...root.querySelectorAll('.ds-passive-markdown-table')].map(scroll),
      codeScroll: [...root.querySelectorAll('pre')].map(scroll),
      mathScroll: [...root.querySelectorAll('.katex-display')].map(scroll)
    }
  }, label)
  if (process.env.KUN_REQUIRE_CJK_FONTS === '1') {
    result.cjk = await inspectCjk(label).catch(error => ({ error: error.stack || String(error) }))
  }
  // Keep measurements before validating: an assertion must not hide raw font
  // evidence, layout data, or the later light/dark comparison.
  metrics.push(result)
  return result
}
function validate(result) {
  if (process.env.KUN_REQUIRE_CJK_FONTS === '1') {
    assert.ok(result.cjk?.count > 0 && result.cjk?.glyphs >= result.cjk.count,
      `native screenshot requires actual Noto, PingFang or Hiragino CJK glyphs, not tofu; ${JSON.stringify(result.cjk)}`)
  }
  assert.ok(result.documentWidth <= result.viewport + 1, 'answer must not widen the page')
  assert.ok(result.panelWidth <= result.viewport + 1, 'sidebar must fit viewport')
  assert.deepEqual(result.headings, [1, 1, 1, 1, 1, 1])
  assert.equal(result.tableRows, 2)
  assert.equal(result.nested, 'Nested detail')
  assert.deepEqual(result.checkboxes, [{ disabled: true, checked: true }, { disabled: true, checked: false }, { disabled: true, checked: true }])
  assert.ok(result.code.includes('<!-- preserved -->'))
  assert.ok(result.text.includes('<!-- literal -->'))
  assert.ok(result.text.includes('Prices remain $5 and $10'))
  assert.equal(result.math.length, 3)
  assert.ok(result.math.every(math => math.font.includes('KaTeX') && math.height > 8))
  assert.ok(result.fonts.some(font => font.includes('KaTeX')))
  assert.ok(result.mathml.every(math => math.position === 'absolute' && math.width <= 2 && math.height <= 2 && math.overflow === 'hidden'))
  for (const [name, entries] of Object.entries({ table: result.tables, code: result.codeScroll, math: result.mathScroll })) {
    const overflowing = entries.filter(entry => entry.scrollWidth > entry.width + 2)
    if (result.viewport === 360) assert.ok(overflowing.length > 0, `${name}: fixture must exercise narrow overflow`)
    assert.ok(overflowing.every(entry => ['auto', 'scroll'].includes(entry.overflow) && entry.scrolled > 0), `${name}: overflow must be reachable`)
  }
}
async function inspectCjk(label) {
  await page.locator('.ds-passive-markdown > p').evaluateAll(nodes => {
    for (const node of nodes) node.removeAttribute('data-cjk-probe')
    const probe = nodes.find(node => /\p{Script=Han}/u.test(node.textContent))
    if (!probe) throw new Error('The paper answer must contain the real CJK probe paragraph')
    probe.setAttribute('data-cjk-probe', 'true')
  })
  const probe = page.locator('[data-cjk-probe]')
  const session = await page.context().newCDPSession(page)
  try {
    await session.send('DOM.enable'); await session.send('CSS.enable')
    const { root } = await session.send('DOM.getDocument')
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-cjk-probe]' })
    assert.ok(nodeId, 'the CJK paragraph must resolve to an actual Chromium DOM node')
    const geometry = () => probe.evaluate(node => {
      const bounds = element => {
        const rect = element.getBoundingClientRect()
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom }
      }
      const style = getComputedStyle(node)
      const ancestors = []
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        const css = getComputedStyle(parent)
        if (css.overflowY !== 'visible' || css.contentVisibility !== 'visible') {
          ancestors.push({ tag: parent.tagName, class: parent.className, rect: bounds(parent),
            overflowY: css.overflowY, contentVisibility: css.contentVisibility, scrollTop: parent.scrollTop })
        }
      }
      return { rect: bounds(node), viewport: { width: innerWidth, height: innerHeight },
        fontFamily: style.fontFamily, fontSize: style.fontSize, color: style.color,
        visibility: style.visibility, opacity: style.opacity, ancestors }
    })
    const before = { ...(await session.send('CSS.getPlatformFontsForNode', { nodeId })), geometry: await geometry() }
    // Platform font usage describes painted glyphs. This paragraph can begin
    // below the scroll viewport, so measure it only after bringing the real
    // element into view and forcing a compositor screenshot. Do not substitute
    // a cloned element or change production fonts/styles to make the test pass.
    await probe.scrollIntoViewIfNeeded()
    await page.evaluate(() => document.fonts.ready)
    await settled()
    const filename = `${native ? 'electron' : 'browser'}-${label}-cjk-font-probe.png`
    await page.screenshot({ path: join(evidence, filename), fullPage: true })
    screenshots.push(filename)
    const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId })
    const text = await probe.innerText()
    const count = [...text.matchAll(/\p{Script=Han}/gu)].length
    const glyphs = countWorkAssistantCjkGlyphs(fonts)
    const result = { text, fonts, count, glyphs, before, geometry: await geometry(), screenshot: filename }
    await writeFile(join(evidence, `cjk-fonts-${label}.json`), JSON.stringify(result, null, 2))
    console.log(`CJK ${label}: ${JSON.stringify({ count, glyphs, fonts })}`)
    return result
  } finally { await session.detach() }
}
