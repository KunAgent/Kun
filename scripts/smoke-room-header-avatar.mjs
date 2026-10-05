import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { build, createServer, normalizePath } from 'vite'

// Offline regression of the actual RoomDirectHeader, avatar hooks and CSS.
//   CHROME_PATH=/usr/bin/chromium node scripts/smoke-room-header-avatar.mjs
// Add --serve to inspect the offline fixture in an existing browser, or
// --serve-built to inspect a production build. No browser is launched in either.
// KUN_AVATAR_EVIDENCE retains before/after screenshots and measured geometry.
// Only the preload boundary is faked; no Kun runtime or user data is touched.
const repository = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'kun-header-avatar-'))
const evidence = process.env.KUN_AVATAR_EVIDENCE
const fixtureId = normalizePath(join(repository, '__room_header_avatar_fixture.tsx'))
const fixtureUrl = '/__room_header_avatar_fixture.tsx'
const measurements = []
const errors = []
const assertionErrors = []
const externalRequests = []
const variants = ['builtin', 'missing', 'custom-builtin', 'uploaded', 'broken-upload', 'missing-upload']
const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="' + fixtureUrl + '"></script></body></html>'
let server
let builtServer
let browser
let page
if (evidence) await mkdir(evidence, { recursive: true })
try {
  if (process.argv.includes('--serve-built')) {
    console.log(await buildFixture())
    await new Promise(() => {})
  }
  server = await createServer({ ...configuration(),
    cacheDir: join(temporary, 'vite-cache'), server: { host: '127.0.0.1', port: 0 } })
  await server.listen()
  const origin = server.resolvedUrls.local[0]
  if (process.argv.includes('--serve')) {
    console.log(origin + '__avatar')
    await new Promise(() => {})
  }
  browser = await chromium.launch({ headless: true, chromiumSandbox: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 400 }, deviceScaleFactor: dpr })
    await guardNetwork(context)
    page = await context.newPage()
    page.on('pageerror', error => errors.push(error.stack || error.message))
    await page.goto(origin + '__avatar', { timeout: 90_000 })
    await page.waitForFunction(() => window.avatarFixture?.ready, undefined, { timeout: 90_000 })
    for (const theme of ['light', 'dark']) for (const fontScale of [1, 2]) {
      for (const width of [360, 640, 1280]) for (const embedded of [false, true]) {
        await page.setViewportSize({ width, height: 400 })
        await show({ theme, fontScale, embedded, variant: 'builtin' })
        // Reproduce only the old selector: it also matched the avatar's outer
        // span, converting its flex layout to a zero-intrinsic-size grid.
        const oldRule = await page.addStyleTag({ content:
          '.rooms-workspace[data-rooms-workspace] .direct-chat-title > span { min-width: 0; display: grid; text-align: left; }' })
        const before = await geometry()
        measurements.push({ phase: 'before', theme, fontScale, width, embedded, ...before })
        assert.equal(before.avatar.display, 'grid')
        assert.ok(before.art.width * before.art.height < 1, 'the original selector must reproduce the invisible builtin art')
        if (evidence && dpr === 1 && fontScale === 1 && width === 1280 && embedded) {
          await page.screenshot({ path: join(evidence, `before-${theme}.png`) })
        }
        await oldRule.evaluate(element => element.remove())
        for (const variant of variants) {
          await show({ variant })
          const after = await geometry()
          try { assertFixed(after, { fontScale, dpr, variant }) } catch (error) {
            assertionErrors.push({ theme, fontScale, width, embedded, variant, message: String(error) })
          }
          measurements.push({ phase: 'after', theme, fontScale, width, embedded, variant, ...after })
          if (evidence && dpr === 1 && fontScale === 1 && width === 1280 && embedded && variant === 'builtin') {
            await page.screenshot({ path: join(evidence, `after-${theme}.png`) })
          }
        }
        console.log(`PASS ${theme} ${width}px ${fontScale * 100}% font DPR=${dpr} embedded=${embedded}`)
      }
    }
    await assertNavigationAndImageReplacement()
    await context.close()
  }
  await server.close()
  server = undefined
  await assertBuiltAssets()
  assert.deepEqual(assertionErrors, [], 'every avatar layout must satisfy the geometry and identity contract')
  assert.deepEqual(errors, [], 'real components must render without uncaught browser errors')
  assert.deepEqual(externalRequests, [], 'fixture must remain offline apart from its own local asset server')
  console.log(`Room header avatar: ${measurements.length} layouts, image replacement, navigation and built asset decoding PASS`)
} catch (error) {
  if (evidence && page && !page.isClosed()) {
    await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => undefined)
    await writeFile(join(evidence, 'failure.html'), await page.content()).catch(() => undefined)
  }
  throw error
} finally {
  if (evidence) {
    await writeFile(join(evidence, 'geometry.json'), JSON.stringify(measurements, null, 2))
    await writeFile(join(evidence, 'errors.json'), JSON.stringify({ errors, assertionErrors, externalRequests }, null, 2))
  }
  await browser?.close()
  await server?.close()
  if (builtServer) await new Promise(resolve => builtServer.close(resolve))
  await rm(temporary, { recursive: true, force: true })
}

function configuration() {
  return { configFile: false, root: repository, esbuild: { jsx: 'automatic' },
    optimizeDeps: { entries: [] }, css: { postcss: repository },
    resolve: { alias: { '@renderer': resolve(repository, 'src/renderer/src'), '@shared': resolve(repository, 'src/shared') } },
    plugins: [{ name: 'room-header-avatar-fixture', enforce: 'pre',
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
// RoomSidebar imports polish before RoomsWorkspaceView imports its other room styles.
import '/src/renderer/src/components/rooms/rooms-polish.css'
import { RoomDirectHeader } from '/src/renderer/src/components/rooms/RoomDirectChat'
import { cacheRoomAvatar } from '/src/renderer/src/components/rooms/room-uploaded-avatar'
import { avatarForIdentity } from '/src/renderer/src/components/rooms/room-avatar-catalog'
import '/src/renderer/src/components/rooms/rooms-composer.css'
import '/src/renderer/src/components/rooms/rooms.css'
import '/src/renderer/src/components/rooms/rooms-chat-surface.css'
import i18n from '/src/renderer/src/i18n'
const image = { mimeType: 'image/svg+xml', dataBase64: btoa('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#14b8a6"/><circle cx="32" cy="32" r="17" fill="#fff"/></svg>') }
cacheRoomAvatar('fixture-upload', image)
cacheRoomAvatar('fixture-broken', { mimeType: 'image/png', dataBase64: btoa('broken fixture image') })
let releaseUpload
const calls = { profile: 0, session: 0, requests: [] }
Object.assign(window, { kunGui: {
  platform: 'win32',
  runtimeRequest: async (path, method = 'GET') => {
    calls.requests.push({ path, method })
    if (path.startsWith('/v1/rooms/avatars/fixture-delayed')) {
      return new Promise(resolve => { releaseUpload = () => resolve({ ok: true, status: 200, body: JSON.stringify({ image }) }) })
    }
    if (path.startsWith('/v1/rooms/avatars/')) return { ok: false, status: 404, body: '{}' }
    if (path.includes('/workbench')) return { ok: true, status: 200, body: '{"links":[]}' }
    throw new Error('Unexpected offline fixture request: ' + method + ' ' + path)
  }
} })
const root = createRoot(document.getElementById('root'))
const noop = () => {}
let state = { theme: 'light', fontScale: 1, embedded: true, variant: 'builtin' }
const references = {
  builtin: { kind: 'builtin', id: 'coordinator' },
  missing: null,
  'custom-builtin': { kind: 'builtin', id: 'magician' },
  uploaded: { kind: 'uploaded', attachmentId: 'fixture-upload' },
  'broken-upload': { kind: 'uploaded', attachmentId: 'fixture-broken' },
  'missing-upload': { kind: 'uploaded', attachmentId: 'fixture-missing' },
  'delayed-upload': { kind: 'uploaded', attachmentId: 'fixture-delayed' }
}
function render(next) {
  state = { ...state, ...next }
  document.documentElement.dataset.theme = state.theme
  document.documentElement.style.fontSize = (16 * state.fontScale) + 'px'
  document.body.style.background = 'var(--ds-bg-main)'
  const member = { id: 'fixture-agent', participantAgentId: 'fixture-agent', displayName: 'Kun', avatar: references[state.variant] }
  const room = { id: 'fixture-room', conversationKind: 'user_agent', members: [member], privateWorkspace: '/fixture/project' }
  flushSync(() => root.render(<main className="rooms-workspace" data-rooms-workspace="true" data-private-chat="true"
    data-room-surface={state.embedded ? 'agent-chat' : 'rooms'} style={{ width: '100%', minHeight: '100vh' }}>
    <RoomDirectHeader room={room} models={{ main: { providerId: 'fixture', model: 'offline-model' } }}
      embedded={state.embedded} onToggleLeftSidebar={noop} onSidebar={noop} onSearch={noop}
      onProfile={() => { calls.profile++ }} onModels={noop} onFiles={noop} onReminders={noop}
      onReset={noop} onConnect={noop} onTasks={noop} onSession={() => { calls.session++ }}
      sessionOpen={false} sessionDisabled={false} />
  </main>))
}
i18n.changeLanguage('en').then(() => {
  render({})
  window.avatarFixture = { ready: true, render, calls, fallbackId: avatarForIdentity('fixture-agent').id,
    releaseUpload: () => releaseUpload?.(), uploadPending: () => Boolean(releaseUpload) }
})
`
}

async function guardNetwork(context) {
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (['data:', 'blob:'].includes(url.protocol) || url.hostname === '127.0.0.1') return route.continue()
    externalRequests.push(url.href)
    return route.abort('blockedbyclient')
  })
}
async function show(state) {
  await page.evaluate(state => window.avatarFixture.render(state), state)
  if (state.variant === 'uploaded') {
    await page.waitForFunction(() => {
      const image = document.querySelector('.direct-chat-title img.rooms-avatar-art')
      return image?.complete && image.naturalWidth > 0
    })
  } else if (state.variant) {
    await page.waitForFunction(() => document.querySelector('.direct-chat-title span.rooms-avatar-art'))
  }
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}
async function geometry() {
  return page.evaluate(async () => {
    const bounds = element => {
      const { x, y, width, height, right, bottom } = element.getBoundingClientRect()
      return { x, y, width, height, right, bottom }
    }
    const avatar = document.querySelector('.direct-chat-title > .rooms-avatar')
    const art = avatar.querySelector('.rooms-avatar-art')
    const style = getComputedStyle(art)
    const src = art instanceof HTMLImageElement ? art.currentSrc : style.backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1]
    const image = new Image()
    image.src = src || ''
    try { await image.decode() } catch (error) {
      const response = src ? await fetch(src).catch(() => undefined) : undefined
      const bytes = response ? new Uint8Array(await response.arrayBuffer()) : undefined
      throw new Error(JSON.stringify({ message: String(error), src, backgroundImage: style.backgroundImage,
        inlineBackground: art.style.backgroundImage, status: response?.status,
        contentType: response?.headers.get('content-type'), bytes: bytes?.length,
        prefix: bytes ? Array.from(bytes.slice(0, 32)) : undefined }))
    }
    return { dpr: devicePixelRatio, avatar: { ...bounds(avatar), display: getComputedStyle(avatar).display,
      label: avatar.getAttribute('aria-label') }, art: { ...bounds(art), tag: art.tagName,
      portrait: art.getAttribute('data-avatar-id'), src, backgroundSize: style.backgroundSize,
      naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight },
      expectedFallback: window.avatarFixture.fallbackId }
  })
}
function assertFixed(actual, { fontScale, dpr, variant }) {
  const detail = JSON.stringify(actual)
  assert.equal(actual.dpr, dpr)
  // Flex items are blockified: Chromium reports flex for authored inline-flex.
  assert.ok(['flex', 'inline-flex'].includes(actual.avatar.display), detail)
  assert.equal(actual.avatar.label, 'Kun')
  assert.ok(Math.abs(actual.avatar.width - 36 * fontScale) < 1, detail)
  for (const dimension of ['width', 'height']) {
    assert.ok(actual.art[dimension] > 0, detail)
    assert.ok(Math.abs(actual.art[dimension] - actual.avatar[dimension]) < 1, detail)
  }
  assert.ok(Math.abs(actual.art.x - actual.avatar.x) < 1 && Math.abs(actual.art.y - actual.avatar.y) < 1, detail)
  assert.ok(actual.art.naturalWidth > 0 && actual.art.naturalHeight > 0, detail)
  if (variant === 'uploaded') assert.equal(actual.art.tag, 'IMG')
  else {
    assert.equal(actual.art.tag, 'SPAN')
    const expected = variant === 'builtin' ? 'coordinator' : variant === 'custom-builtin' ? 'magician' : actual.expectedFallback
    assert.equal(actual.art.portrait, expected)
  }
}
async function assertNavigationAndImageReplacement() {
  await page.setViewportSize({ width: 1280, height: 400 })
  await show({ theme: 'light', fontScale: 1, embedded: true, variant: 'uploaded' })
  await show({ variant: 'delayed-upload' })
  await page.waitForFunction(() => window.avatarFixture.uploadPending())
  const pending = await geometry()
  assert.equal(pending.art.tag, 'SPAN', 'previous upload must not remain visible for a different attachment')
  assert.equal(pending.art.portrait, pending.expectedFallback)
  await page.evaluate(() => window.avatarFixture.releaseUpload())
  await page.waitForFunction(() => document.querySelector('.direct-chat-title img.rooms-avatar-art')?.naturalWidth > 0)
  await show({ variant: 'custom-builtin' })
  assert.equal((await geometry()).art.portrait, 'magician', 'explicit builtin must replace the uploaded avatar')
  await page.locator('.direct-chat-title').click()
  await page.getByRole('button', { name: 'View Agent session' }).click()
  assert.deepEqual(await page.evaluate(() => [window.avatarFixture.calls.profile, window.avatarFixture.calls.session]), [1, 1])
}
async function buildFixture() {
  const outDir = join(temporary, 'dist')
  // Build the real component as the entry and write its tiny HTML host afterward.
  // An HTML entry on Windows' separate temp drive is not relative to Vite's
  // repository root and can produce invalid ../ asset names.
  const built = await build({ ...configuration(),
    esbuild: { jsx: 'automatic', jsxDev: false },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    base: './', mode: 'production', logLevel: 'warn', build: {
      outDir, emptyOutDir: true, target: 'chrome128', assetsInlineLimit: 0,
      modulePreload: false, reportCompressedSize: false, rollupOptions: { input: fixtureId }
    } })
  const output = (Array.isArray(built) ? built : [built]).flatMap(result => result.output ?? [])
  const entry = output.find(item => item.type === 'chunk' && item.isEntry)
  assert.ok(entry, 'the production fixture must emit its real component entry')
  const css = [...(entry.viteMetadata?.importedCss ?? [])]
  assert.ok(css.length, 'the production fixture must include the real component styles')
  const host = html.replace('<script type="module" src="' + fixtureUrl + '"></script>',
    css.map(file => '<link rel="stylesheet" href="./' + file + '">').join('') +
    '<script type="module" src="./' + entry.fileName + '"></script>')
  await writeFile(join(outDir, 'index.html'), host)
  builtServer = createHttpServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)
      const path = resolve(outDir, '.' + (pathname === '/' ? '/index.html' : pathname))
      assert.ok(path.startsWith(outDir + sep))
      const content = await readFile(path)
      response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' })[extname(path)] || 'application/octet-stream')
      response.end(content)
    } catch { response.statusCode = 404; response.end('Not found') }
  })
  await new Promise(resolve => builtServer.listen(0, '127.0.0.1', resolve))
  return 'http://127.0.0.1:' + builtServer.address().port + '/'
}
async function assertBuiltAssets() {
  const url = await buildFixture()
  const context = await browser.newContext({ viewport: { width: 1280, height: 400 }, deviceScaleFactor: 2 })
  await guardNetwork(context)
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.stack || error.message))
  await page.goto(url)
  await page.waitForFunction(() => window.avatarFixture?.ready)
  await show({ variant: 'builtin', theme: 'dark', fontScale: 2, embedded: true })
  const actual = await geometry()
  assertFixed(actual, { fontScale: 2, dpr: 2, variant: 'builtin' })
  const asset = new URL(actual.art.src)
  assert.match(asset.pathname, /\/assets\/kun-avatar-atlas-[\w-]+\.png$/)
  assert.equal(asset.origin, new URL(url).origin)
  const emitted = await readFile(join(temporary, 'dist', asset.pathname))
  assert.ok(emitted.length > 0, 'the decoded URL must refer to the emitted Vite asset')
  measurements.push({ phase: 'production-build', ...actual, assetBytes: emitted.length })
  if (evidence) await page.screenshot({ path: join(evidence, 'production-built-dark-200pct-dpr2.png') })
  console.log('PASS production Vite hashed avatar asset resolves and decodes')
  await context.close()
}
