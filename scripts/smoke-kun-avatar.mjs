import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, _electron } from 'playwright-core'
import { build, createServer, normalizePath } from 'vite'

// Actual avatar components, shared profile store and CSS; only the HTTP/preload
// boundary is replaced. No runtime, external network or user data is touched.
// CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//   node scripts/smoke-kun-avatar.mjs [--electron]
// --electron additionally checks the production fixture in native Electron;
// this component fixture is distinct from a full --workbench-only app smoke.
// --serve keeps the development fixture open for manual inspection.
const repository = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'kun-layered-avatar-'))
const evidence = resolve(process.env.KUN_AVATAR_EVIDENCE ?? join(repository, '.cache/kun-avatar-ui'))
const fixtureId = normalizePath(join(repository, '__kun_avatar_fixture.tsx'))
const fixtureUrl = '/__kun_avatar_fixture.tsx'
const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="' + fixtureUrl + '"></script></body></html>'
const errors = [], externalRequests = [], screenshots = [], measurements = []
let server, builtServer, browser, electron, page
await mkdir(evidence, { recursive: true })
try {
  server = await createServer({ ...configuration(), cacheDir: join(temporary, 'vite-cache'),
    // This is a fixed snapshot check: unrelated builds must not reload its
    // browser halfway through a save/cancel or image-failure assertion.
    server: { host: '127.0.0.1', port: 0, watch: null, hmr: false } })
  await server.listen()
  const origin = server.resolvedUrls.local[0]
  if (process.argv.includes('--serve')) {
    console.log(origin + '__avatar')
    await new Promise(() => {})
  }
  browser = await chromium.launch({ headless: true, chromiumSandbox: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: { width: mobile ? 390 : 1280, height: 900 },
      deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile })
    await guardNetwork(context)
    if (mobile) await context.addInitScript(() => {
      Object.defineProperty(window, 'OffscreenCanvas', { configurable: true, value: undefined })
      Object.defineProperty(window, 'createImageBitmap', { configurable: true, value: undefined })
    })
    page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error.stack || error.message))
    await load(origin + '__avatar')
    for (const theme of ['light', 'dark']) {
      await show({ mode: mobile ? 'panel' : 'modal', theme })
      await waitForOptions(30)
      await assertGeometry(mobile ? 'mobile-panel' : 'desktop-dialog')
      await capture(`${mobile ? 'mobile-fallback' : 'desktop'}-${theme}-presets`)
      await editAndSave()
      await show({ mode: mobile ? 'panel' : 'modal' })
      await waitForOptions(30)
      const before = await snapshot()
      await page.getByRole('button', { name: 'Randomize', exact: true }).click()
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      assert.deepEqual((await snapshot()).profile, before.profile, 'cancel must not persist the draft')
    }
    await checkAgentPicker()
    await show({ mode: 'grid', theme: 'light' })
    await waitForImages('[data-gallery] img[data-composed]', 40)
    const geometry = await page.locator('[data-gallery] img[data-composed]').evaluateAll((images) => images.map((image) => ({
      width: image.getBoundingClientRect().width, naturalWidth: image.naturalWidth, transform: getComputedStyle(image).transform
    })))
    assert(geometry.every((image) => image.naturalWidth >= image.width * 2 - 1 && image.transform === 'none'),
      'retina gallery must be dense enough and avoid an extra CSS crop')
    measurements.push({ gallery: mobile ? 'mobile' : 'desktop', images: geometry })
    await capture(`${mobile ? 'mobile' : 'desktop'}-40-avatars`)
    await context.close()
  }
  await assertLayerFailure(origin)
  const builtUrl = await buildFixture()
  const builtContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 })
  await guardNetwork(builtContext)
  page = await builtContext.newPage()
  page.on('pageerror', (error) => errors.push(error.stack || error.message))
  const published = new Set()
  page.on('response', (response) => { if (/\.webp(?:$|\?)/.test(response.url())) published.add(response.url()) })
  await load(builtUrl)
  await show({ mode: 'grid', theme: 'dark' })
  await waitForImages('[data-gallery] img[data-composed]', 40)
  assert(published.size > 30, 'production build must fetch the bundled layer files')
  assert([...published].every((url) => new URL(url).origin === new URL(builtUrl).origin && /\/assets\/.*-[\w-]+\.webp$/.test(url)),
    'production layers must use local Vite hashed URLs')
  await capture('production-built-dark-40-avatars')
  await builtContext.close()
  if (process.argv.includes('--electron')) await electronSmoke(builtUrl)
  assert.deepEqual(errors, [], 'avatar surfaces must render without uncaught browser errors')
  assert.deepEqual(externalRequests, [], 'all avatar imagery and behavior must be local')
  console.log('PASS desktop/mobile editors, save/cancel, agent picker, 40 avatars, load failure and production WebP URLs')
} catch (error) {
  if (page && !page.isClosed()) await capture('failure').catch(() => undefined)
  throw error
} finally {
  await writeFile(join(evidence, 'report.json'), JSON.stringify({ errors, externalRequests, screenshots, measurements }, null, 2))
  await electron?.close()
  await browser?.close()
  await server?.close()
  if (builtServer) await new Promise((resolve) => builtServer.close(resolve))
  await rm(temporary, { recursive: true, force: true })
}

function configuration() {
  return { configFile: false, root: repository, esbuild: { jsx: 'automatic' },
    optimizeDeps: { entries: [], noDiscovery: true, include: [
      'react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client',
      'react-i18next', 'zustand', 'i18next', 'lucide-react', 'zod', 'yaml'
    ] }, css: { postcss: repository },
    resolve: { alias: { '@renderer': resolve(repository, 'src/renderer/src'), '@shared': resolve(repository, 'src/shared') } },
    plugins: [{ name: 'kun-avatar-fixture', enforce: 'pre',
      resolveId(id) { if (id === fixtureUrl || id === fixtureId) return fixtureId },
      load(id) { if (id === fixtureId) return fixtureSource() },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (request.url?.split('?')[0] !== '/__avatar') return next()
          response.setHeader('Content-Type', 'text/html')
          response.end(await vite.transformIndexHtml('/__avatar', html))
        })
      }
    }] }
}

function fixtureSource() {
  return `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import '/src/renderer/src/index.css'
import '/src/renderer/src/styles/base-shell.css'
import { RoomAvatar } from '/src/renderer/src/components/rooms/RoomAvatar'
import { RoomUserAvatarEditor } from '/src/renderer/src/components/rooms/RoomUserAvatarEditor'
import { RoomAvatarPicker } from '/src/renderer/src/components/rooms/RoomAvatarPicker'
import { composedAvatarCache } from '/src/renderer/src/components/rooms/room-avatar-compositor'
import { acceptRoomUserProfile } from '/src/renderer/src/components/rooms/room-user-profile'
import { KUN_AVATAR_PRESETS } from '/src/shared/rooms-api'
import i18n from '/src/renderer/src/i18n'
let profile = { profile: { avatar: { kind: 'builtin', id: 'coder' } }, revision: 1 }
let agentAvatar = { kind: 'builtin', id: 'reviewer' }
let saves = 0, agentSaves = 0, serial = 0
const calls = []
window.kunGui = { platform: 'win32', runtimeRequest: async (path, method = 'GET', body) => {
  calls.push({ path, method })
  if (path !== '/v1/rooms/user-profile') throw new Error('Unexpected fixture request: ' + method + ' ' + path)
  if (method === 'PUT') {
    const input = typeof body === 'string' ? JSON.parse(body) : body
    if (input.expectedRevision !== profile.revision) return { ok: false, status: 409, body: '{}' }
    profile = { profile: { avatar: input.avatar }, revision: profile.revision + 1 }; saves++
  }
  return { ok: true, status: 200, body: JSON.stringify(profile) }
} }
const root = createRoot(document.getElementById('root'))
let state = { mode: 'closed', theme: 'light' }
function render(next) {
  state = { ...state, ...next }
  document.documentElement.dataset.theme = state.theme
  document.body.style.margin = '0'
  document.body.style.background = 'var(--ds-bg-main)'
  document.body.style.color = 'var(--ds-text)'
  const close = () => render({ mode: 'closed' })
  const avatar = (index) => ({ kind: 'composed', version: 1, parts: KUN_AVATAR_PRESETS[index % 30].parts })
  flushSync(() => root.render(<main style={{ padding: 16, minHeight: '100vh', maxWidth: '100vw' }}>
    {state.mode === 'modal' || state.mode === 'panel' ? <RoomUserAvatarEditor key={++serial} onClose={close}
      variant={state.mode === 'panel' ? 'panel' : 'modal'} /> : state.mode === 'agent' ?
      <RoomAvatarPicker id="fixture-agent" label="Fixture Agent" avatar={agentAvatar}
        onChange={(next) => { agentAvatar = next; agentSaves++; render({ mode: 'agent' }) }} /> :
      state.mode === 'grid' ? <div data-gallery style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(104px,1fr))', gap: 12 }}>
        {Array.from({ length: 40 }, (_, index) => <div key={index} style={{ display: 'grid', justifyItems: 'center', gap: 6 }}>
          <RoomAvatar avatar={avatar(index)} id={'gallery-' + index} label={KUN_AVATAR_PRESETS[index % 30].label.en}
            size={[24, 34, 48, 96][index % 4]} />
          <small>{KUN_AVATAR_PRESETS[index % 30].label.en}</small>
        </div>)}
      </div> : state.mode === 'failure' ?
      <div data-failed><RoomAvatar avatar={avatar(1)} id="developer" label="Missing layer" size={96} /></div> :
      <div data-saved><RoomAvatar user id="user" label="Saved avatar" size={96} /></div>}
  </main>))
}
i18n.changeLanguage('en').then(() => {
  acceptRoomUserProfile(profile)
  render({})
  window.avatarFixture = { ready: true, render, clearCache: () => composedAvatarCache.clear(),
    snapshot: () => ({ profile, agentAvatar, saves, agentSaves, calls }) }
})
`
}

async function guardNetwork(context) {
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (['data:', 'blob:'].includes(url.protocol) || url.hostname === '127.0.0.1') return route.continue()
    externalRequests.push(url.href)
    return route.abort('blockedbyclient')
  })
}
async function load(url) {
  page.setDefaultTimeout(60_000)
  await page.goto(url, { timeout: 180_000 })
  await page.waitForFunction(() => window.avatarFixture?.ready, undefined, { timeout: 180_000 })
}
async function show(state) { await page.evaluate((state) => window.avatarFixture.render(state), state) }
async function snapshot() { return page.evaluate(() => window.avatarFixture.snapshot()) }
async function waitForImages(selector, count) {
  await page.waitForFunction(({ selector, count }) => {
    const images = [...document.querySelectorAll(selector)]
    return images.length === count && images.every((image) => image.complete && image.naturalWidth > 0)
  }, { selector, count }, { timeout: 180_000 })
}
async function waitForOptions(count) { await waitForImages('.rooms-avatar-composer-option img[data-composed]', count) }
async function capture(name) {
  const path = join(evidence, name + '.png')
  await page.screenshot({ path, fullPage: true })
  screenshots.push(path)
  console.log('Captured ' + name)
}
async function assertGeometry(label) {
  const metrics = await page.evaluate(() => {
    const composer = document.querySelector('.rooms-avatar-composer')
    const { x, width } = composer.getBoundingClientRect()
    return { x, width, viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
      buttons: [...composer.querySelectorAll('button')].map((button) => button.getBoundingClientRect().height),
      options: [...composer.querySelectorAll('.rooms-avatar-composer-option')].map((button) => {
        const bounds = button.getBoundingClientRect()
        const art = button.querySelector('.rooms-avatar').getBoundingClientRect()
        const label = button.querySelector(':scope > span:last-of-type').getBoundingClientRect()
        return { top: bounds.top, bottom: bounds.bottom, artTop: art.top, artBottom: art.bottom,
          labelTop: label.top, labelBottom: label.bottom }
      }) }
  })
  assert(metrics.x >= -1 && metrics.x + metrics.width <= metrics.viewport + 1, label + ': editor must fit horizontally')
  assert(metrics.documentWidth <= metrics.viewport + 1, label + ': no horizontal scrolling')
  assert(metrics.buttons.every((height) => height >= 44), label + ': avatar controls need a 44px touch target')
  assert(metrics.options.every((option) => option.artTop >= option.top && option.artBottom <= option.labelTop + 1 &&
    option.labelBottom <= option.bottom + 1), label + ': complete artwork and labels must fit inside each option without overlap')
  measurements.push({ label, ...metrics })
}
async function editAndSave() {
  const before = await snapshot()
  await page.getByRole('button', { name: 'Coordinator', exact: true }).click()
  await page.getByRole('combobox', { name: 'Customize avatar', exact: true }).selectOption('color')
  await waitForOptions(4)
  await page.locator('.rooms-avatar-composer-option').nth(1).click()
  await page.getByRole('combobox', { name: 'Customize avatar', exact: true }).selectOption('face')
  await waitForOptions(2)
  await page.locator('.rooms-avatar-composer-option').nth(1).click()
  await waitForImages('.rooms-avatar-composer-preview img[data-composed]', 1)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForSelector('[data-saved] img[data-composed]')
  const after = await snapshot()
  assert.equal(after.saves, before.saves + 1)
  assert.equal(after.profile.profile.avatar.kind, 'composed')
  assert.equal(after.profile.profile.avatar.parts.color, 'teal')
  assert.equal(after.profile.profile.avatar.parts.face, 'happy')
  assert.equal(after.profile.revision, before.profile.revision + 1)
}
async function checkAgentPicker() {
  await show({ mode: 'agent' })
  const initial = await snapshot()
  const trigger = page.getByRole('button', { name: 'Choose avatar', exact: true })
  await trigger.focus()
  await trigger.press('Enter')
  await waitForOptions(30)
  await page.getByRole('button', { name: 'Astronaut', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.deepEqual((await snapshot()).agentAvatar, initial.agentAvatar)
  await trigger.click()
  await waitForOptions(30)
  await page.getByRole('button', { name: 'Astronaut', exact: true }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  assert.equal((await snapshot()).agentSaves, initial.agentSaves + 1)
  assert.equal((await snapshot()).agentAvatar.kind, 'composed')
}
async function assertLayerFailure(origin) {
  const context = await browser.newContext()
  await guardNetwork(context)
  await context.route((url) => url.pathname.endsWith('.webp'), (route) =>
    // Vite's ?import&url asset modules are scripts needed to mount the fixture.
    route.request().resourceType() === 'script' ? route.continue() : route.abort('failed'))
  page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.stack || error.message))
  await load(origin + '__avatar')
  const failed = page.waitForEvent('requestfailed', { predicate: (request) =>
    request.resourceType() !== 'script' && new URL(request.url()).pathname.endsWith('.webp') })
  await show({ mode: 'failure' })
  await failed
  await page.waitForSelector('[data-failed] [data-avatar-id="coder"]')
  assert.equal(await page.locator('[data-failed] img[data-composed]').count(), 0)
  await capture('missing-layer-identity-fallback')
  await context.close()
}
async function buildFixture() {
  const outDir = join(temporary, 'dist')
  const built = await build({ ...configuration(), esbuild: { jsx: 'automatic', jsxDev: false },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') }, base: './', mode: 'production', logLevel: 'warn',
    build: { outDir, emptyOutDir: true, target: ['chrome128', 'safari16'], assetsInlineLimit: 0,
      modulePreload: false, reportCompressedSize: false, rollupOptions: { input: fixtureId } } })
  const output = (Array.isArray(built) ? built : [built]).flatMap((result) => result.output ?? [])
  const entry = output.find((item) => item.type === 'chunk' && item.isEntry)
  assert(entry, 'fixture production entry must exist')
  const css = [...(entry.viteMetadata?.importedCss ?? [])]
  const host = html.replace('<script type="module" src="' + fixtureUrl + '"></script>',
    css.map((file) => '<link rel="stylesheet" href="./' + file + '">').join('') +
    '<script type="module" src="./' + entry.fileName + '"></script>')
  await writeFile(join(outDir, 'index.html'), host)
  builtServer = createHttpServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)
      const path = resolve(outDir, '.' + (pathname === '/' ? '/index.html' : pathname))
      assert(path.startsWith(outDir + sep))
      const content = await readFile(path)
      response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
        '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' })[extname(path)] || 'application/octet-stream')
      response.end(content)
    } catch { response.statusCode = 404; response.end('Not found') }
  })
  await new Promise((resolve) => builtServer.listen(0, '127.0.0.1', resolve))
  return 'http://127.0.0.1:' + builtServer.address().port + '/'
}
async function electronSmoke(url) {
  const main = join(temporary, 'electron-fixture.cjs')
  await writeFile(main, `const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(join(temporary, 'electron-user-data'))});
app.whenReady().then(() => { const window = new BrowserWindow({ width: 1280, height: 900,
  webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.loadURL(${JSON.stringify(url)}); });`)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  electron = await _electron.launch({ args: [main], cwd: repository, env })
  await guardNetwork(electron.context())
  page = await electron.firstWindow()
  page.on('pageerror', (error) => errors.push(error.stack || error.message))
  await page.waitForFunction(() => window.avatarFixture?.ready)
  await show({ mode: 'modal', theme: 'dark' })
  await waitForOptions(30)
  await capture('electron-built-dark-editor')
  await editAndSave()
  await electron.close()
  electron = undefined
}
