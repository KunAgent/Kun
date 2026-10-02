import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, _electron } from 'playwright-core'
import { createServer } from 'vite'

// Offline real-component regression; no app build, Kun runtime or credentials.
//   CHROME_PATH=/usr/bin/chromium node scripts/smoke-composer-scaled-controls.mjs
//   node scripts/smoke-composer-scaled-controls.mjs --electron
// KUN_COMPOSER_EVIDENCE retains screenshots and JSON measurements.
// KUN_COMPOSER_BASELINE_CSS optionally names the entire pre-fix stylesheet. It is
// served only with --expect-hidden to verify the old failure before the fixed run.
// Browser DPR emulation is Chromium coverage; --electron can run natively on Windows.
const require = createRequire(import.meta.url)
const repository = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'kun-scaled-composer-'))
const evidence = process.env.KUN_COMPOSER_EVIDENCE
const baselineCss = process.env.KUN_COMPOSER_BASELINE_CSS
const electronMode = process.argv.includes('--electron')
const expectHidden = process.argv.includes('--expect-hidden')
assert.ok(!expectHidden || baselineCss, '--expect-hidden requires KUN_COMPOSER_BASELINE_CSS')
if (evidence) await mkdir(evidence, { recursive: true })
let server
let browser
let electron
let page
const measurements = []
const errors = []
try {
  if (electronMode) {
    const main = join(temporary, 'main.cjs')
    await writeFile(main, `
const { app, BrowserWindow } = require('electron')
app.setPath('userData', ${JSON.stringify(join(temporary, 'user-data'))})
app.setPath('appData', ${JSON.stringify(temporary)})
app.commandLine.appendSwitch('force-device-scale-factor', '1.5')
app.commandLine.appendSwitch('use-fake-device-for-media-stream')
app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 820, height: 900, show: true,
    webPreferences: { contextIsolation: true, sandbox: true } })
  window.loadURL('about:blank')
})
app.on('window-all-closed', () => app.quit())
`)
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    electron = await _electron.launch({ executablePath: require('electron'), args: [main], env, chromiumSandbox: true, timeout: 90_000 })
    page = await electron.firstWindow()
  } else if (!process.argv.includes('--serve')) {
    browser = await chromium.launch({ headless: true,
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
    page = await browser.newPage({ viewport: { width: 820, height: 900 }, deviceScaleFactor: 1.5 })
  }
  page?.on('pageerror', error => {
    const detail = error.stack || error.message
    errors.push(detail)
    console.error(detail)
  })
  const phases = expectHidden ? ['baseline'] : ['fixed']
  for (const phase of phases) {
    server = await fixtureServer(phase)
    await server.listen()
    const url = `${server.resolvedUrls.local[0]}__composer`
    if (process.argv.includes('--serve')) {
      console.log(url)
      await new Promise(() => {})
    }
    // Cold Windows Vite transforms need the same budget as renderer readiness.
    await page.goto(url, { timeout: 90_000 })
    await page.locator('.ds-composer-voice-action').waitFor({ state: 'attached', timeout: 90_000 })
    await page.locator('.ds-composer-prompt-optimize-action').waitFor({ state: 'attached' })
    for (const language of ['en', 'zh']) {
      await page.evaluate(language => window.composerFixture.language(language), language)
      for (const height of [900, 720]) {
        for (const width of [360, 420, 640, 720, 760, 800, 820, 1000]) {
          await resize(width, height)
          const actual = await geometry(page)
          assert.ok(actual.buttons.every(button => button.label), 'all controls need accessible names')
          if (language === 'zh') assert.match(actual.buttons[0].label, /[\u3400-\u9fff]/)
          measurements.push({ phase, language, width, height, ...actual })
          if (evidence) await page.screenshot({ path: join(evidence, `${phase}-${language}-${width}x${height}.png`) })
          if (phase === 'baseline') assertBaseline(actual)
          else assertGeometry(actual)
          console.log(`${phase}: ${language} ${width}x${height} DPR=${actual.dpr} composer content=${actual.contentWidth} PASS`)
        }
      }
    }
    if (phase === 'fixed') await assertInteractions()
    await server.close()
    server = undefined
  }
  assert.deepEqual(errors, [], 'the real composer must render without page errors')
  console.log(expectHidden
    ? `Baseline: ${measurements.length} real-renderer layouts reproduce the CSS visibility policy PASS`
    : `Composer scaled controls: ${measurements.length} real-renderer layouts and settings/optimize/send/recording PASS`)
} catch (error) {
  if (evidence && page && !page.isClosed()) {
    await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => undefined)
    await writeFile(join(evidence, 'failure.html'), await page.content()).catch(() => undefined)
    await writeFile(join(evidence, 'page-errors.json'), JSON.stringify(errors, null, 2))
  }
  throw error
} finally {
  if (evidence) await writeFile(join(evidence, 'geometry.json'), JSON.stringify(measurements, null, 2))
  await electron?.close()
  await browser?.close()
  await server?.close()
  await rm(temporary, { recursive: true, force: true })
}

async function fixtureServer(phase) {
  return createServer({ configFile: false, root: repository,
    esbuild: { jsx: 'automatic' },
    cacheDir: join(temporary, `vite-${phase}`),
    resolve: { alias: { '@renderer': resolve(repository, 'src/renderer/src'), '@shared': resolve(repository, 'src/shared') } },
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 'scaled-composer-fixture', enforce: 'pre',
      async transform(code, id) {
        if (phase !== 'baseline' || !id.endsWith('/styles/base-shell.css')) return
        // PostCSS inlines nested imports without invoking Vite transforms for
        // each leaf. Expand this import-only entry in the original order so the
        // baseline replaces the actual leaf, without moving later imports after
        // CSS rules (invalid @import ordering) or changing the cascade.
        const imports = [...code.matchAll(/@import ['"](.+?)['"];?/g)]
        assert.ok(imports.some(match => match[1] === './base-shell/session-sidebar-shell.css'),
          'base-shell.css must import the composer stylesheet')
        for (const match of imports) {
          const source = match[1] === './base-shell/session-sidebar-shell.css'
            ? baselineCss : resolve(dirname(id), match[1])
          code = code.replace(match[0], await readFile(source, 'utf8'))
        }
        return code
      },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (!request.url?.startsWith('/__composer')) return next()
          response.setHeader('Content-Type', 'text/html')
          response.end(await vite.transformIndexHtml('/__composer', '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/src/renderer/src/components/chat/FloatingComposerScaledControlsSmokeFixture.tsx"></script></body></html>'))
        })
      }
    }]
  })
}

async function resize(width, height) {
  if (electron) {
    await electron.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height)
    }, { width, height })
  } else await page.setViewportSize({ width, height })
  await page.waitForFunction(({ width, height }) => innerWidth === width && innerHeight === height, { width, height })
}

async function geometry(page) {
  return page.evaluate(() => {
    const box = element => {
      const { x, y, width, height, right, bottom } = element.getBoundingClientRect()
      return { x, y, width, height, right, bottom }
    }
    const root = document.querySelector('.ds-floating-composer')
    const rootStyle = getComputedStyle(root)
    const buttonInfo = element => {
      const bounds = box(element)
      const style = getComputedStyle(element)
      const visible = style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 0
      const center = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      return { ...bounds, display: style.display, visible, hittable: visible && element.contains(center),
        label: element.getAttribute('aria-label') }
    }
    const buttons = ['voice', 'prompt-optimize', 'primary'].map(name => {
      const element = document.querySelector(`.ds-composer-${name}-action`)
      return { name, present: !!element, ...(element ? buttonInfo(element) : {}) }
    })
    return { dpr: devicePixelRatio, viewport: { width: innerWidth, height: innerHeight },
      root: box(root), contentWidth: root.clientWidth - parseFloat(rootStyle.paddingLeft) - parseFloat(rootStyle.paddingRight),
      toolbar: box(document.querySelector('.ds-composer-toolbar')), buttons,
      model: box(document.querySelector('.ds-composer-model-picker')),
      overflow: document.documentElement.scrollWidth > innerWidth }
  })
}
function assertBaseline(actual) {
  assert.equal(actual.dpr, 1.5)
  for (const button of actual.buttons.slice(0, 2)) {
    assert.equal(button.present, true, `${button.name} must exist in baseline DOM`)
    assert.equal(button.display === 'none', actual.contentWidth <= 760, JSON.stringify(actual))
  }
}
function assertGeometry(actual) {
  assert.equal(actual.dpr, 1.5)
  assert.equal(actual.overflow, false)
  assert.ok(actual.root.x >= 0 && actual.root.right <= actual.viewport.width + 1, JSON.stringify(actual))
  const visible = [...actual.buttons, { name: 'model', ...actual.model }]
  for (const button of actual.buttons) {
    assert.equal(button.present, true)
    assert.equal(button.visible, true, `${button.name} must be visible`)
    assert.equal(button.hittable, true, `${button.name} must not be clipped or covered`)
    assert.ok(button.width >= 32 && button.height >= 32, JSON.stringify(button))
  }
  for (const control of visible) {
    assert.ok(control.width > 0, JSON.stringify(control))
    assert.ok(control.x >= actual.toolbar.x - 1 && control.right <= actual.toolbar.right + 1, JSON.stringify(actual))
    assert.ok(control.y >= actual.toolbar.y - 1 && control.bottom <= actual.toolbar.bottom + 1, JSON.stringify(actual))
  }
  for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) {
    const a = visible[i], b = visible[j]
    const overlap = Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1
      && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1
    assert.equal(overlap, false, `${a.name} overlaps ${b.name}: ${JSON.stringify(actual)}`)
  }
}

async function assertInteractions() {
  await resize(360, 720)
  await page.evaluate(() => window.composerFixture.language('zh'))
  await page.evaluate(() => window.composerFixture.setEnabled(false))
  await page.locator('.ds-composer-voice-action').waitFor({ state: 'detached' })
  await page.locator('.ds-composer-prompt-optimize-action').waitFor({ state: 'detached' })
  await page.evaluate(() => window.composerFixture.setEnabled(true))
  await page.locator('.ds-composer-voice-action').waitFor({ state: 'visible' })
  await page.locator('.ds-composer-prompt-optimize-action').waitFor({ state: 'visible' })
  assertGeometry(await geometry(page))
  await page.locator('.ds-composer-textarea').fill('Explain the change')
  await page.locator('.ds-composer-prompt-optimize-action').click()
  await page.waitForFunction(() => document.querySelector('.ds-composer-textarea').value === 'Optimized: Explain the change')
  await page.locator('.ds-composer-primary-action').click()
  assert.deepEqual(await page.evaluate(() => window.composerFixture.calls.sent), ['Optimized: Explain the change'])
  assert.deepEqual(await page.evaluate(() => window.composerFixture.calls.optimized), ['Explain the change'])
  await page.locator('.ds-composer-voice-action').click()
  const recording = page.locator('.ds-composer-toolbar-actions')
  await recording.locator('canvas').waitFor({ state: 'visible' })
  const recordingGeometry = await recording.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return [...element.querySelectorAll('button')].map(button => {
      const box = button.getBoundingClientRect()
      // DPR 1.5 can differ by a few floating-point ulps at a shared edge.
      // Match the one-CSS-pixel tolerance of the normal control assertions.
      return { x: box.x, y: box.y, right: box.right, bottom: box.bottom,
        container: { x: bounds.x, y: bounds.y, right: bounds.right, bottom: bounds.bottom },
        width: box.width, height: box.height,
        within: box.left >= bounds.left - 1 && box.right <= bounds.right + 1
          && box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1,
        hittable: button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) }
    })
  })
  if (evidence) {
    await writeFile(join(evidence, 'recording-geometry.json'), JSON.stringify(recordingGeometry, null, 2))
    await page.screenshot({ path: join(evidence, 'fixed-zh-360x720-recording.png') })
  }
  assert.equal(recordingGeometry.length, 2)
  for (const button of recordingGeometry) {
    assert.ok(button.width >= 32 && button.height >= 32 && button.within && button.hittable, JSON.stringify(recordingGeometry))
  }
  assert.ok(recordingGeometry[0].right <= recordingGeometry[1].x + 1, 'recording buttons must not overlap')
  // The production recorder intentionally rejects recordings shorter than 500ms.
  await page.waitForTimeout(650)
  await recording.locator('button').first().click()
  await page.waitForFunction(() => window.composerFixture.calls.transcribed === 1)
  await page.locator('.ds-composer-voice-action').waitFor({ state: 'visible' })
  assert.match(await page.locator('.ds-composer-textarea').inputValue(), /Recorded fixture text$/)
  assertGeometry(await geometry(page))
}
