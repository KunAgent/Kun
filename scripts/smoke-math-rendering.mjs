import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { _electron as electron } from 'playwright-core'
import { build } from 'esbuild'
import { createServer, normalizePath } from 'vite'
import { mathCases, mathRenderingFixture, workMathMarkdown } from './math-rendering-ui-fixture.mjs'

// Native Electron is authoritative. --serve exposes the identical fixture for
// supplementary browser diagnosis only; it does not produce a passing report.
const require = createRequire(import.meta.url)
const repository = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(join(repository, 'node_modules/.kun-math-smoke-'))
const evidence = resolve(process.env.KUN_MATH_EVIDENCE || 'dist/math-rendering-smoke')
await mkdir(evidence, { recursive: true })
const fixtureId = normalizePath(join(repository, '__math_rendering_fixture.tsx'))
const fixtureUrl = '/__math_rendering_fixture.tsx'
const exportPath = join(temporary, 'work-export.html')
const fontsPath = join(dirname(require.resolve('katex/dist/katex.min.css')), 'fonts')
const checks = [], failures = [], errors = [], externalRequests = [], metrics = [], interactionTraces = []
let server, application, page, origin, fatal
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="${fixtureUrl}"></script></body></html>`
try {
  server = await createServer({
    configFile: false, root: repository, cacheDir: join(temporary, 'vite-cache'),
    esbuild: { jsx: 'automatic' }, optimizeDeps: { entries: [] }, css: { postcss: repository },
    resolve: { alias: {
      '@renderer': resolve(repository, 'src/renderer/src'),
      '@shared': resolve(repository, 'src/shared'),
      '@kun/provider-catalog': resolve(repository, 'packages/provider-catalog/src/index.ts'),
      '@kun/extension-api': resolve(repository, 'packages/extension-api/src/index.ts')
    } },
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 'math-rendering-fixture', enforce: 'pre',
      resolveId(id) { if (id === fixtureUrl || id === fixtureId) return fixtureId },
      load(id) { if (id === fixtureId) return mathRenderingFixture() },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (request.url?.split('?')[0] !== '/__math') return next()
          response.setHeader('Content-Type', 'text/html')
          response.end(await vite.transformIndexHtml('/__math', html))
        })
      }
    }]
  })
  await server.listen()
  origin = server.resolvedUrls.local[0]
  if (process.argv.includes('--serve')) {
    console.log(origin + '__math')
    await new Promise(() => {})
  }
  // Bundle the actual main-process export service, preserving its Electron,
  // dependency and KaTeX CSS/font resolution. No simulated export stylesheet.
  const exportModule = join(temporary, 'export-service.mjs')
  await build({
    stdin: { contents: "export { buildWriteExportHtmlDocument, buildWriteClipboardHtmlFragment } from './src/main/services/write-export-service.ts'", resolveDir: repository },
    outfile: exportModule, bundle: true, platform: 'node', format: 'esm',
    packages: 'external', target: 'node22', logLevel: 'warning'
  })
  const entry = join(temporary, 'main.cjs')
  await writeFile(entry, `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(join(temporary, 'profile'))});
globalThis.renderMathExport=async(options)=>{
  const module=await import(${JSON.stringify(pathToFileURL(exportModule).href)});
  const html=await module.buildWriteExportHtmlDocument({sourcePath:options.sourcePath,content:options.source,title:'Native math export smoke'});
  const clipboard=await module.buildWriteClipboardHtmlFragment({sourcePath:options.sourcePath,content:options.source});
  await require('node:fs/promises').writeFile(options.exportPath,html);
  return {html,clipboard};
};
app.whenReady().then(()=>{const win=new BrowserWindow({width:1060,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});win.loadURL('about:blank')});
app.on('window-all-closed',()=>app.quit());`)
  application = await electron.launch({ executablePath: require('electron'), args: [entry], timeout: 90_000 })
  const context = application.context()
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    let approvedFile = false
    if (url.protocol === 'file:') {
      const path = fileURLToPath(url), font = relative(fontsPath, path)
      approvedFile = path === exportPath || (!!font && !font.startsWith('..' + sep) && !font.includes(':') && /\.(woff2?|ttf)$/.test(font))
    }
    if (url.origin === new URL(origin).origin || approvedFile) return route.continue()
    externalRequests.push(url.href)
    return route.abort('blockedbyclient')
  })
  page = await application.firstWindow({ timeout: 90_000 })
  page.setDefaultTimeout(20_000)
  page.on('pageerror', error => errors.push(error.stack || error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(origin + '__math', { timeout: 90_000 })
  await page.waitForFunction(() => window.mathFixture?.editorReady(), undefined, { timeout: 90_000 })
  await page.locator('[data-surface="title"] .katex').first().waitFor()
  await page.evaluate(() => document.fonts.ready)

  for (const theme of ['light', 'dark']) {
    for (const width of [1060, 420]) {
      await resize(width)
      await page.evaluate(theme => window.mathFixture.setTheme(theme), theme)
      await settled()
      const label = `${theme}-${width}`
      await check(`styled math, hidden duplicate MathML and contained overflow (${label})`, async () => {
        const result = await inspectSurfaces(label)
        metrics.push(result)
        validateSurfaces(result)
      })
      for (const surface of ['chat', 'title', 'editor', 'preview']) {
        await page.locator(`[data-surface="${surface}"]`).screenshot({ path: join(evidence, `${label}-${surface}.png`) })
      }
    }
  }

  await check('formulas follow the light and dark theme text colors', async () => {
    const light = metrics.find(item => item.label === 'light-1060')
    const dark = metrics.find(item => item.label === 'dark-1060')
    assert.ok(light && dark)
    for (const surface of light.surfaces) {
      const themed = dark.surfaces.find(item => item.name === surface.name)
      assert.notEqual(surface.math[0].color, themed.math[0].color, `${surface.name}: dark mode must change formula text color`)
    }
  })
  await resize(1060)
  await page.evaluate(() => window.mathFixture.setTheme('light'))
  await check('live inline math preview, Cmd/Ctrl+Enter save and Markdown persistence', async () => {
    await clickInlineMath('inline-save')
    const input = page.locator('.write-math-input')
    await input.fill(mathCases.saved)
    await page.waitForFunction(value => document.querySelector('.write-math-preview annotation')?.textContent === value, mathCases.saved)
    assert.equal(await page.locator('.write-math-preview .katex').count(), 1)
    await screenshot('inline-live-preview')
    await input.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
    await input.waitFor({ state: 'detached' })
    const actual = await page.evaluate(() => ({ nodes: window.mathFixture.editorMath(), markdown: window.mathFixture.serialized() }))
    assert.equal(actual.nodes[0].latex, mathCases.saved, 'save must update the actual Tiptap node')
    assert.ok(actual.markdown.includes('$' + mathCases.saved + '$'), 'save must survive the production Markdown serializer')
    assert.equal(await page.locator('[data-surface="editor"] [data-type="inline-math"]').first().getAttribute('data-latex'), mathCases.saved)
  })
  await check('Escape cancels a live inline edit without committing it', async () => {
    const before = await page.evaluate(() => window.mathFixture.serialized())
    await clickInlineMath('inline-cancel')
    const input = page.locator('.write-math-input')
    await input.fill(mathCases.canceled)
    await input.press('Escape')
    await input.waitFor({ state: 'detached' })
    await settled()
    assert.equal(await page.evaluate(() => window.mathFixture.serialized()), before)
    assert.equal(await page.locator('.write-math-overlay').count(), 0)
  })
  await check('block live preview, blur-save and repeated reopen/cancel', async () => {
    const node = page.locator('[data-surface="editor"] [data-type="block-math"]').first()
    await node.click()
    const input = page.locator('.write-math-input')
    await input.fill(mathCases.saved)
    await page.waitForFunction(value => document.querySelector('.write-math-preview annotation')?.textContent === value, mathCases.saved)
    assert.equal(await page.locator('.write-math-preview .katex-display').count(), 1)
    await screenshot('block-live-preview')
    await input.press('Tab')
    await input.waitFor({ state: 'detached' })
    assert.equal(await node.getAttribute('data-latex'), mathCases.saved)
    const before = await page.evaluate(() => window.mathFixture.serialized())
    await node.click()
    assert.equal(await input.inputValue(), mathCases.saved)
    await input.fill(mathCases.canceled)
    await input.press('Escape')
    await input.waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => window.mathFixture.serialized()), before)
  })
  await check('streamed math settles and repeated updates do not leave stale duplicate formulas', async () => {
    await page.evaluate(() => window.mathFixture.render({ streaming: true, chat: 'Computing $$E=' }))
    await page.evaluate(() => window.mathFixture.render({ streaming: true, chat: window.mathFixture.chatSource() }))
    await page.waitForFunction(() => document.querySelector('[data-surface="chat"]')?.textContent?.includes('x24'), undefined, { timeout: 30_000 })
    await page.evaluate(() => window.mathFixture.render({ streaming: false, chat: null }))
    assert.equal(await page.locator('[data-surface="chat"] .katex').count(), 5)
    await page.evaluate(() => window.mathFixture.render({ streaming: false, chat: 'Replacement $$z^2$$ only.' }))
    await page.waitForFunction(() => document.querySelectorAll('[data-surface="chat"] .katex').length === 1)
    assert.ok(!(await page.locator('[data-surface="chat"]').innerText()).includes('Computing'))
    await page.evaluate(() => window.mathFixture.render({ chat: null }))
  })
  await check('hostile LaTeX, raw HTML and malformed formulas remain inert in every consumer', async () => {
    await page.evaluate(() => window.mathFixture.render({ hostile: true }))
    await page.waitForFunction(() => window.mathFixture.editorMath().length > 5)
    await page.waitForTimeout(300)
    await assertInert('[data-surface]')
    assert.deepEqual(await page.evaluate(() => window.mathFixture.calls), [])
    assert.equal(await page.evaluate(() => window.__mathXss), 0)
    for (const surface of ['chat', 'title', 'editor', 'preview']) {
      assert.ok(await page.locator(`[data-surface="${surface}"] .katex-error`).count() > 0, `${surface}: malformed formulas must have a safe readable fallback`)
    }
    await screenshot('hostile-inputs-inert')
  })

  await check('actual Work export document and clipboard use styled safe HTML/MathML', async () => {
    const result = await application.evaluate((_electron, options) => globalThis.renderMathExport(options), {
      exportPath, sourcePath: join(temporary, 'math.md'), source: workMathMarkdown({ hostile: true })
    })
    await writeFile(join(evidence, 'work-export.html'), result.html)
    await writeFile(join(evidence, 'work-clipboard.html'), result.clipboard)
    const clipboard = await page.evaluate(source => {
      const doc = new DOMParser().parseFromString(source, 'text/html')
      return { math: doc.querySelectorAll('math').length, htmlMath: doc.querySelectorAll('[aria-hidden="true"]').length,
        active: doc.querySelectorAll('script,iframe,object,embed,img,[onerror],[onclick],[href^="javascript:"]').length }
    }, result.clipboard)
    assert.ok(clipboard.math >= 4, 'clipboard must retain native MathML')
    assert.equal(clipboard.htmlMath, 0, 'clipboard must not duplicate MathML with HTML spans')
    assert.equal(clipboard.active, 0)
    await page.goto(pathToFileURL(exportPath).href)
    await page.evaluate(() => document.fonts.ready)
    await assertInert('.markdown-body')
    const exported = await page.evaluate(() => {
      const roots = [...document.querySelectorAll('.katex')]
      return { count: roots.length, styled: roots.every(node => getComputedStyle(node).fontFamily.includes('KaTeX')),
        hidden: [...document.querySelectorAll('math')].every(node => {
          const parent = node.parentElement, style = getComputedStyle(parent), rect = parent.getBoundingClientRect()
          return style.display === 'none' || (style.position === 'absolute' && rect.width <= 2 && rect.height <= 2 && style.overflow === 'hidden')
        }), fonts: [...document.fonts].filter(font => font.status === 'loaded').map(font => font.family) }
    })
    metrics.push({ export: exported })
    assert.ok(exported.count >= 4)
    assert.ok(exported.styled, 'export must use its own actual KaTeX stylesheet')
    assert.ok(exported.hidden, 'export must not visibly duplicate native MathML')
    assert.ok(exported.fonts.some(font => font.includes('KaTeX')), 'export must resolve local KaTeX fonts')
    await screenshot('work-export-wide')
    await resize(420)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'long exported formulas must stay inside a narrow viewport')
    const exportScroll = await page.locator('.katex-display').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 2).map(node => { node.scrollLeft = 80; return { overflow: getComputedStyle(node).overflowX, scrolled: node.scrollLeft }; }))
    assert.ok(exportScroll.length > 0, 'long export equation must retain a local scroller')
    assert.ok(exportScroll.every(node => ['auto', 'scroll'].includes(node.overflow) && node.scrolled > 0), 'export overflow must remain reachable')
    await screenshot('work-export-narrow')
  })
  await check('no uncaught rendering errors or unexpected network/resource requests', async () => {
    assert.deepEqual(errors, [])
    assert.deepEqual(externalRequests, [])
  })
  assert.deepEqual(failures, [], 'native math smoke assertions failed; inspect report.json and screenshots')
  console.log('PASS native Electron math rendering:', checks.join('; '))
} catch (error) {
  fatal = error.stack || String(error)
  if (page && !page.isClosed()) {
    await screenshot('failure').catch(() => undefined)
    await writeFile(join(evidence, 'failure.html'), await page.content()).catch(() => undefined)
  }
  throw error
} finally {
  await writeFile(join(evidence, 'report.json'), JSON.stringify({
    platform: process.platform, nativeElectron: !!application, katex: require('katex/package.json').version,
    checks, failures, fatal, errors, externalRequests, metrics, interactionTraces
  }, null, 2))
  await application?.close()
  await server?.close()
  await rm(temporary, { recursive: true, force: true })
}

async function check(name, test) {
  try { await test(); checks.push(name) } catch (error) {
    failures.push({ name, error: error.stack || String(error) })
    console.error('FAIL', name, error)
    await screenshot('failed-check-' + failures.length).catch(() => undefined)
    // Leave the harness usable so independent surfaces still get evidence.
    if (await page.locator('.write-math-input').count()) await page.locator('.write-math-input').press('Escape').catch(() => undefined)
  } finally {
    const trace = await page.evaluate(() => window.__stopMathTrace?.()).catch(() => undefined)
    if (trace) interactionTraces.push(trace)
  }
}
async function clickInlineMath(label) {
  const wrapper = page.locator('[data-surface="editor"] [data-type="inline-math"]').first()
  await wrapper.scrollIntoViewIfNeeded()
  // Inline wrappers may have disjoint line-box quads around accessibility
  // markup. Click the painted glyph as a user would, retaining Playwright's
  // real hit-target checks; never force a click or dispatch a synthetic event.
  const glyph = wrapper.locator('.katex-html .mord').first()
  const geometry = await glyph.evaluate(node => {
    const inspect = element => {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element)
      return { tag: element.tagName, className: element.getAttribute('class'),
        rect: rect.toJSON(), rects: [...element.getClientRects()].map(item => item.toJSON()),
        display: style.display, pointerEvents: style.pointerEvents,
        hits: document.elementsFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
          .slice(0, 5).map(item => ({ tag: item.tagName, className: item.getAttribute('class') })) }
    }
    return { wrapper: inspect(node.closest('[data-type="inline-math"]')), glyph: inspect(node) }
  })
  metrics.push({ clickGeometry: label, ...geometry })
  await traceMathInteraction(label)
  await glyph.click()
}
async function traceMathInteraction(label) {
  await page.evaluate(label => {
    const events = [], started = performance.now()
    const describe = node => node instanceof Element
      ? { tag: node.tagName, className: node.getAttribute('class'), math: node.closest('[data-type]')?.getAttribute('data-type') }
      : { tag: node?.nodeName ?? null }
    const record = (type, event, detail) => {
      if (events.length >= 160) return
      const math = document.querySelector('[data-surface="editor"] [data-type="inline-math"]')
      events.push({ type, milliseconds: Math.round(performance.now() - started),
        target: describe(event?.target), active: describe(document.activeElement),
        documentFocused: document.hasFocus(), selection: window.mathFixture.editorSelection(),
        scroll: { x: scrollX, y: scrollY }, mathRect: math?.getBoundingClientRect().toJSON(),
        overlay: !!document.querySelector('.write-math-overlay'),
        ...(event instanceof MouseEvent ? { x: event.clientX, y: event.clientY, button: event.button } : {}),
        ...(detail ? { detail } : {}) })
    }
    const types = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'focusin', 'focusout', 'selectionchange', 'scroll']
    const listener = event => {
      record(event.type, event)
      if (['mousedown', 'mouseup', 'click'].includes(event.type)) queueMicrotask(() => record(event.type + ':after', event))
    }
    for (const type of types) document.addEventListener(type, listener, true)
    const observer = new MutationObserver(records => {
      for (const mutation of records) {
        for (const [action, nodes] of [['added', mutation.addedNodes], ['removed', mutation.removedNodes]]) {
          for (const node of nodes) {
            if (node instanceof Element && (node.matches('.write-math-overlay') || node.querySelector('.write-math-overlay'))) {
              record('overlay:' + action, null, describe(node))
            }
          }
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    window.__stopMathTrace = () => {
      record('final')
      for (const type of types) document.removeEventListener(type, listener, true)
      observer.disconnect()
      delete window.__stopMathTrace
      return { label, events }
    }
    record('initial')
  }, label)
}
async function resize(width) {
  await application.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900), width)
  await page.setViewportSize({ width, height: 900 })
  await page.waitForFunction(width => innerWidth === width, width)
}
async function settled() {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.waitForTimeout(200)
}
async function screenshot(name) {
  await settled()
  await page.screenshot({ path: join(evidence, name + '.png'), fullPage: true })
}
async function assertInert(selector) {
  const active = await page.locator(selector).evaluateAll(roots => roots.flatMap(root => [...root.querySelectorAll('*')].flatMap(node => {
    const tags = ['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'IMG', 'LINK', 'STYLE', 'FOREIGNOBJECT']
    const unsafe = tags.includes(node.tagName.toUpperCase()) || [...node.attributes].some(attribute =>
      /^on/i.test(attribute.name) || (['href', 'src', 'xlink:href'].includes(attribute.name) && /^(javascript:|https?:|data:)/i.test(attribute.value)))
    return unsafe || node.classList.contains('math-injected') ? [node.outerHTML] : []
  })))
  assert.deepEqual(active, [], 'untrusted input must not create active HTML or external resource elements')
}
async function inspectSurfaces(label) {
  return page.evaluate(label => ({ label, viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
    fonts: [...document.fonts].filter(font => font.status === 'loaded').map(font => font.family),
    surfaces: [...document.querySelectorAll('[data-surface]')].map(surface => ({
      name: surface.dataset.surface, text: surface.innerText,
      math: [...surface.querySelectorAll('.katex')].map(node => {
        const rect = node.getBoundingClientRect(), style = getComputedStyle(node)
        return { width: rect.width, height: rect.height, font: style.fontFamily, color: style.color }
      }),
      display: surface.querySelectorAll('.katex-display').length,
      hiddenMathml: [...surface.querySelectorAll('math')].map(node => {
        const parent = node.parentElement, style = getComputedStyle(parent), rect = parent.getBoundingClientRect()
        return { width: rect.width, height: rect.height, position: style.position, overflow: style.overflow, display: style.display }
      }),
      overflow: [...surface.querySelectorAll('.katex-display')].filter(node => node.scrollWidth > node.clientWidth + 2).map(node => {
        const style = getComputedStyle(node)
        node.scrollLeft = 80
        const result = { width: node.clientWidth, scrollWidth: node.scrollWidth, overflow: style.overflowX, scrolled: node.scrollLeft }
        node.scrollLeft = 0
        return result
      })
    }))
  }), label)
}
function validateSurfaces(result) {
  assert.ok(result.documentWidth <= result.viewport + 1, 'long math must not widen the page')
  assert.ok(result.fonts.some(font => font.includes('KaTeX')), 'KaTeX font files must load')
  for (const surface of result.surfaces) {
    const title = surface.name === 'title'
    assert.equal(surface.math.length, title ? 2 : 5, `${surface.name}: exact math count`)
    assert.equal(surface.display, title ? 0 : 3, `${surface.name}: inline and display distinction`)
    assert.ok(!/<(?:span|math|script)|class=|xmlns=|katex-html/.test(surface.text), `${surface.name}: no leaked rendered markup`)
    for (const math of surface.math) {
      assert.ok(math.width > 5 && math.height > 8, `${surface.name}: formula must have painted dimensions`)
      assert.ok(math.font.includes('KaTeX'), `${surface.name}: formula must use KaTeX styling`)
      assert.notEqual(math.color, 'rgba(0, 0, 0, 0)')
    }
    for (const math of surface.hiddenMathml) {
      assert.ok(math.display === 'none' || (math.position === 'absolute' && math.width <= 2 && math.height <= 2 && math.overflow === 'hidden'), `${surface.name}: MathML accessibility copy must be visually hidden`)
    }
    if (!title) {
      assert.ok(surface.overflow.length >= 1, `${surface.name}: long formula must have a local scroller`)
      for (const overflow of surface.overflow) {
        assert.ok(['auto', 'scroll'].includes(overflow.overflow), `${surface.name}: overflow must remain reachable`)
        assert.ok(overflow.scrolled > 0, `${surface.name}: long formula must actually scroll`)
      }
    }
  }
}
