import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright-core'
import { createServer } from 'vite'

// Native Electron check of replying to a selected passage: a real mouse drag
// over the production timeline under the shell's body zoom, the selection
// toolbar, the composer quote, the side-conversation draft and the jump back
// from a sent quote. Synthetic host data only; no runtime or user profile.
const require = createRequire(import.meta.url)
const repository = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(join(repository, 'node_modules/.kun-message-quote-'))
const evidence = resolve(process.env.KUN_MESSAGE_QUOTE_EVIDENCE || 'dist/message-quote')
const UI_SCALE = 0.82
const errors = []
let server, application, page, fatal
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,">
<style>html,body{height:100%;margin:0;overflow:hidden}
#root{height:calc(100vh / var(--ds-ui-scale, 1))}
.fixture-shell{height:100%;display:flex;background:var(--ds-bg-main);color:var(--ds-text)}
.fixture-stage{display:flex;flex:1;min-width:0;min-height:0;flex-direction:column}
.fixture-side{width:420px;flex:none;display:flex;border-left:1px solid var(--ds-border-muted)}
</style></head><body><div id="root"></div>
<script type="module" src="/scripts/fixtures/message-quote.tsx"></script></body></html>`

const PASSAGE = '远程 Agent 的派发依赖多宿主调度'
const SECOND = '继续复用现有的 store 和 IPC 通道'

try {
  await mkdir(evidence, { recursive: true })
  server = await createServer({
    configFile: false, root: repository, cacheDir: join(temporary, 'vite-cache'),
    // Scan the fixture up front so a late dependency never reloads the page mid-run.
    esbuild: { jsx: 'automatic' }, optimizeDeps: { entries: ['scripts/fixtures/message-quote.tsx'] },
    css: { postcss: repository },
    resolve: { dedupe: ['react', 'react-dom'], alias: {
      '@renderer': resolve(repository, 'src/renderer/src'), '@shared': resolve(repository, 'src/shared'),
      '@kun/provider-catalog': resolve(repository, 'packages/provider-catalog/src/index.ts'),
      '@kun/extension-api': resolve(repository, 'packages/extension-api/src/index.ts'),
      '@kun/extension-react': resolve(repository, 'packages/extension-react/src/index.ts')
    } },
    server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/*'] } },
    plugins: [{ name: 'message-quote-fixture', configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?')[0] !== '/__message_quote') return next()
        response.setHeader('Content-Type', 'text/html')
        response.end(await vite.transformIndexHtml('/__message_quote', html))
      })
    } }]
  })
  await server.listen()
  const origin = new URL(server.resolvedUrls.local[0]).origin
  const main = join(temporary, 'main.cjs')
  await writeFile(main, `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(join(temporary, 'profile'))});
app.whenReady().then(()=>{const win=new BrowserWindow({width:1280,height:820,show:true,
webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});win.loadURL('about:blank')});
app.on('window-all-closed',()=>app.quit());`)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  application = await _electron.launch({ executablePath: require('electron'), args: [main], env, timeout: 60_000 })
  page = await application.firstWindow({ timeout: 60_000 })
  page.on('pageerror', error => errors.push(error.stack || error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.context().route('**/*', route => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort('blockedbyclient'))
  page.setDefaultTimeout(15_000)
  await page.goto(origin + '/__message_quote', { timeout: 60_000 })
  await page.waitForFunction(() => window.messageQuoteFixture?.ready, null, { timeout: 60_000 })
  await page.evaluate(scale => document.documentElement.style.setProperty('--ds-ui-scale', String(scale)), UI_SCALE)
  await page.locator('[data-timeline-block-id="assistant-plan"]').waitFor()
  const settle = () => page.evaluate(() => new Promise(done =>
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 200)))))
  await settle()

  // Visual (zoomed) client rects of a passage inside one message.
  const passageRects = needle => page.evaluate(({ needle }) => {
    const root = document.querySelector('[data-timeline-block-id="assistant-plan"]')
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = node.data.indexOf(needle)
      if (index < 0) continue
      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + needle.length)
      return [...range.getClientRects()].map(({ left, top, right, bottom, width, height }) =>
        ({ left, top, right, bottom, width, height }))
    }
    return null
  }, { needle })
  const dragSelect = async needle => {
    const rects = await passageRects(needle)
    assert.ok(rects?.length, `passage not rendered: ${needle}`)
    const first = rects[0], last = rects.at(-1)
    await page.mouse.move(first.left + 1, first.top + first.height / 2)
    await page.mouse.down()
    await page.mouse.move(last.right - 1, last.top + last.height / 2, { steps: 12 })
    await page.mouse.up()
    await settle()
    return rects
  }
  const toolbar = page.locator('[data-message-selection-toolbar="main"]')

  // 1. Drag-select a passage: the toolbar appears centered above its first line.
  const rects = await dragSelect(PASSAGE)
  assert.equal(await page.evaluate(() => window.getSelection()?.toString()), PASSAGE)
  await toolbar.waitFor({ state: 'visible' })
  const box = await toolbar.boundingBox()
  assert.ok(box, 'toolbar has a box')
  const line = rects[0]
  assert.ok(box.y + box.height <= line.top + 0.5, `toolbar sits above the selection: ${JSON.stringify({ box, line })}`)
  assert.ok(line.top - (box.y + box.height) < 16, 'toolbar hugs the selection')
  assert.ok(Math.abs(box.x + box.width / 2 - (line.left + line.width / 2)) < 3, 'toolbar is centered on the line')
  assert.deepEqual(await toolbar.locator('button').allInnerTexts(), ['开始分支对话', '回复'])
  await page.screenshot({ path: join(evidence, '1-selection-toolbar.png') })

  // 2. Reply: the quote lands in the main composer and the selection clears.
  await toolbar.locator('[data-message-quote-action="reply"]').click()
  const chip = page.locator('[data-primary-floating-composer] [data-message-quote-chip]')
  await chip.waitFor()
  assert.match(await chip.innerText(), new RegExp(`回复 Kun[\\s\\S]*${PASSAGE}`))
  assert.equal(await toolbar.count(), 0, 'toolbar closes after replying')
  assert.equal(await page.evaluate(() => window.getSelection()?.isCollapsed), true)
  const placeholder = await page.locator('[data-primary-floating-composer] .ds-composer-textarea').getAttribute('placeholder')
  assert.equal(placeholder, '回复这段内容…')
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('ds-composer-textarea')), true,
    'composer takes focus')
  await page.screenshot({ path: join(evidence, '2-reply-quote.png') })

  // 3. Start a side conversation: the draft panel opens with the quote.
  await dragSelect(SECOND)
  await toolbar.waitFor({ state: 'visible' })
  await toolbar.locator('[data-message-quote-action="side"]').click()
  await page.waitForFunction(() => window.messageQuoteFixture.sidePanelOpen)
  const sideChip = page.locator('.ds-side-chat [data-message-quote-chip]')
  await sideChip.waitFor()
  assert.match(await sideChip.innerText(), new RegExp(SECOND.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.equal(await page.locator('.ds-side-chat .ds-composer-textarea').getAttribute('placeholder'), '就这段内容提问…')
  assert.equal(await chip.count(), 1, 'the main composer quote is untouched')
  await settle()
  await page.screenshot({ path: join(evidence, '3-side-draft.png') })

  // 4. A sent quote jumps back to its source and flashes the passage.
  await page.locator('[data-sent-message-quotes] button').first().click()
  assert.equal(await page.evaluate(() => CSS.highlights.has('kun-message-quote-source')), true)
  await settle()
  await page.screenshot({ path: join(evidence, '4-jump-to-source.png') })

  // 5. Dark theme keeps the toolbar legible.
  await page.evaluate(() => window.messageQuoteFixture.theme('dark'))
  await dragSelect(PASSAGE)
  await toolbar.waitFor({ state: 'visible' })
  const colors = await toolbar.evaluate(element => {
    const button = element.querySelector('button')
    return { background: getComputedStyle(element).backgroundColor, text: getComputedStyle(button).color }
  })
  assert.notEqual(colors.background, colors.text)
  await page.screenshot({ path: join(evidence, '5-dark-toolbar.png') })

  assert.deepEqual(errors, [])
  console.log(`message quote smoke passed; evidence in ${evidence}`)
} catch (error) {
  fatal = error
  if (page) await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => undefined)
} finally {
  await application?.close().catch(() => undefined)
  await server?.close().catch(() => undefined)
  await rm(temporary, { recursive: true, force: true }).catch(() => undefined)
}
if (fatal) {
  console.error(fatal)
  if (errors.length) console.error(errors.join('\n'))
  process.exit(1)
}
