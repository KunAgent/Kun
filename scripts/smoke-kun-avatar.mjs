import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, _electron } from 'playwright-core'
import sharp from 'sharp'
import { build, createServer, normalizePath } from 'vite'
import { loadAvatarCatalog } from './kun-avatar-compose-check.mjs'

// Actual avatar components, shared profile store and CSS; only the HTTP/preload
// boundary is replaced. No runtime, external network or user data is touched.
// CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//   node scripts/smoke-kun-avatar.mjs [--electron]
// --electron additionally checks the production fixture in native Electron;
// this component fixture is distinct from a full --workbench-only app smoke.
// --serve keeps the development fixture open for manual inspection.
const repository = fileURLToPath(new URL('../', import.meta.url))
const catalog = await loadAvatarCatalog(repository)
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
      await checkArtPanels(`${mobile ? 'mobile-fallback' : 'desktop'}-${theme}`)
      if (!mobile) await checkOutfitAlignment(theme)
      await editAndSave()
      await show({ mode: mobile ? 'panel' : 'modal' })
      await waitForOptions(30)
      const before = await snapshot()
      await page.getByRole('button', { name: 'Randomize', exact: true }).click()
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      assert.deepEqual((await snapshot()).profile, before.profile, 'cancel must not persist the draft')
    }
    await checkAgentPicker()
    if (!mobile) {
      for (const theme of ['light', 'dark']) for (const cropPage of [0, 1]) {
        await show({ mode: 'small-crops', theme, cropPage })
        await waitForImages('[data-small-crops] img', 15 * 6)
        assert(await page.locator('[data-small-crops]').evaluate((chart) => chart.getBoundingClientRect().bottom <= innerHeight),
          'all 15 comparison rows must fit in each screenshot')
        await capture(`desktop-${theme}-compact-before-after-${cropPage + 1}`)
      }
    }
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
import { renderAvatarComposition } from '/src/renderer/src/components/rooms/room-avatar-composition-canvas'
import { composedAvatarLayers, composedAvatarLayerUrl } from '/src/renderer/src/components/rooms/room-avatar-compositor'
import { composedAvatarCache } from '/src/renderer/src/components/rooms/room-avatar-compositor'
import { acceptRoomUserProfile } from '/src/renderer/src/components/rooms/room-user-profile'
import { KUN_AVATAR_PRESETS, KUN_AVATAR_CATALOG, KUN_AVATAR_ACCESSORY_CATEGORIES,
  createKunWardrobe, normalizeKunAvatarParts } from '/src/shared/rooms-api'
import i18n from '/src/renderer/src/i18n'
let profile = { profile: { avatar: { kind: 'builtin', id: 'coder' } }, revision: 1 }
let agentAvatar = { kind: 'builtin', id: 'reviewer' }
let saves = 0, agentSaves = 0, serial = 0
const calls = []
const wardrobe = { ...createKunWardrobe(1),
  items: Object.fromEntries(KUN_AVATAR_ACCESSORY_CATEGORIES.flatMap((category) =>
    KUN_AVATAR_CATALOG[category].map(({ id }) => [category + '/' + id, 1]))),
  roles: KUN_AVATAR_PRESETS.map(({ id }) => id) }
wardrobe.seen = [...Object.keys(wardrobe.items), ...wardrobe.roles.map((id) => 'card/' + id)]
window.kunGui = { platform: 'win32', runtimeRequest: async (path, method = 'GET', body) => {
  calls.push({ path, method })
  if (path === '/v1/rooms/wardrobe' || path === '/v1/rooms/wardrobe/seen') {
    return { ok: true, status: 200, body: JSON.stringify({ wardrobe, revision: 1 }) }
  }
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
function PreviousCrop({ parts, size }) {
  const [source, setSource] = React.useState()
  React.useEffect(() => {
    let active = true, resource
    const keys = composedAvatarLayers(parts, { size }).map((key) =>
      size > 34 && key.startsWith('headwear/') ? key.replace('.small', '') : key)
    const urls = keys.map((key) => composedAvatarLayerUrl(key, 256))
    renderAvatarComposition(urls, { pixels: size * 2, canvas: 1024, crop: [232, 300, 792, 860], bg: parts.bg })
      .then((result) => { resource = result; if (active) setSource(result.url); else result.dispose() })
    return () => { active = false; resource?.dispose() }
  }, [parts, size])
  return source ? <img src={source} alt="Previous crop" width={size} height={size} style={{ borderRadius: '50%' }} /> : null
}
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
      state.mode === 'small-crops' ? <div data-small-crops style={{ display: 'grid', gridTemplateColumns: '160px repeat(6, 64px)', alignItems: 'center', gap: '8px 10px' }}>
        <strong>Crop comparison</strong>{[24, 34, 48].flatMap((size) => [<small key={size + 'before'}>{size}px old</small>, <small key={size + 'after'}>{size}px B</small>])}
        {KUN_AVATAR_PRESETS.slice((state.cropPage ?? 0) * 15, (state.cropPage ?? 0) * 15 + 15).map((preset) => <React.Fragment key={preset.id}>
          <span>{preset.label.en}</span>{[24, 34, 48].flatMap((size) => [
            <PreviousCrop key={size + 'old'} parts={preset.parts} size={size} />,
            <RoomAvatar key={size + 'new'} avatar={{ kind: 'composed', version: 1, parts: preset.parts }} id={preset.id} label={preset.label.en} size={size} />
          ])}
        </React.Fragment>)}
      </div> : state.mode === 'grid' ? <div data-gallery style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(104px,1fr))', gap: 12 }}>
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
    reviewOutfit: (outfit) => {
      profile = { ...profile, profile: { avatar: { kind: 'composed', version: 1,
        parts: normalizeKunAvatarParts({ outfit, headwear: 'beanie', face: 'happy', bg: state.theme === 'dark' ? '#2c2c2c' : '#f7f5ef' }) } } }
      acceptRoomUserProfile(profile)
      render({ mode: 'modal' })
    },
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
  // Loaded URLs can precede their first compositor paint, especially after a theme switch.
  await page.evaluate(async () => {
    await Promise.all([...document.images].filter((image) => image.complete).map((image) => image.decode().catch(() => {})))
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  const path = join(evidence, name + '.png')
  await page.screenshot({ path, fullPage: true, animations: 'disabled' })
  screenshots.push(path)
  console.log('Captured ' + name)
}
async function assertGeometry(label) {
  const metrics = await page.evaluate(() => {
    const composer = document.querySelector('.rooms-avatar-composer')
    const { x, width } = composer.getBoundingClientRect()
    return { x, width, viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
      buttons: [...composer.querySelectorAll('[role="tab"], .rooms-avatar-composer-option, .rooms-avatar-slot-open')]
        .map((button) => button.getBoundingClientRect().height),
      options: [...composer.querySelectorAll('.rooms-avatar-composer-option')].map((button) => {
        const bounds = button.getBoundingClientRect()
        const art = button.querySelector('.rooms-avatar-option-art').getBoundingClientRect()
        const label = button.querySelector('.rooms-avatar-option-name').getBoundingClientRect()
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
  await page.locator('[data-avatar-tab="preset"]').click()
  await waitForOptions(catalog.KUN_AVATAR_PRESETS.length)
  await page.getByRole('button', { name: 'Coordinator', exact: true }).click()
  await page.locator('[data-avatar-tab="color"]').click()
  await waitForOptions(catalog.KUN_AVATAR_CATALOG.color.length)
  await page.locator('.rooms-avatar-composer-option').nth(1).click()
  await page.locator('[data-avatar-tab="face"]').click()
  await waitForOptions(catalog.KUN_AVATAR_CATALOG.face.length)
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
async function checkArtPanels(label) {
  const before = await snapshot()
  for (const category of catalog.KUN_AVATAR_ACCESSORY_CATEGORIES) {
    await page.locator(`[data-avatar-tab="${category}"]`).click()
    const selector = '.rooms-avatar-composer-option .rooms-avatar-item-art img'
    await waitForImages(selector, catalog.KUN_AVATAR_CATALOG[category].length)
    assert.equal(await page.locator('.rooms-avatar-composer-option[aria-disabled="true"]').count(), 0,
      'the explicit complete wardrobe fixture must own every review item')
    const sources = await page.locator(selector).evaluateAll((images) => images.map((image) => image.currentSrc))
    assert(sources.every((source) => source.includes(`/icon/${category}/`)), 'wardrobe must load independent item art')
    const iconStyle = await page.locator(selector).first().evaluate((image) => ({
      filter: getComputedStyle(image).filter,
      well: getComputedStyle(image.closest('.rooms-avatar-option-art')).backgroundColor
    }))
    assert.equal(iconStyle.filter.includes('drop-shadow'), label.endsWith('-dark'), 'soft icon outline follows the theme')
    assert.notEqual(iconStyle.well, 'rgba(0, 0, 0, 0)', 'inventory icons need an opaque midtone well')
    measurements.push({ label, category, iconStyle })
    if (label.startsWith('desktop') || category === 'outfit') await capture(`${label}-${category}-icons`)
    if (label.startsWith('desktop') && ['headwear', 'outfit'].includes(category)) {
      await page.locator('.rooms-avatar-composer-option').last().scrollIntoViewIfNeeded()
      await capture(`${label}-${category}-icons-bottom`)
    }
  }
  for (const preset of ['Detective', 'Magician']) {
    await page.locator('[data-avatar-tab="preset"]').click()
    await waitForOptions(catalog.KUN_AVATAR_PRESETS.length)
    await page.getByRole('button', { name: preset, exact: true }).click()
    await page.locator('[data-avatar-tab="bg"]').click()
    await page.locator('.rooms-avatar-composer-swatch').nth(label.endsWith('-dark') ? 5 : 0).click()
    await page.mouse.move(4, 4)
    await waitForImages('.rooms-avatar-composer-preview img[data-composed]', 1)
    const filter = await page.locator('.rooms-avatar-composer-preview img[data-composed]').evaluate((image) => getComputedStyle(image).filter)
    assert.equal(filter, 'none', 'the icon outline must never tint stage compositions')
    await capture(`${label}-${preset.toLowerCase()}-stage`)
  }
  await page.locator('[data-avatar-tab="bg"]').click()
  await waitForImages('.rooms-avatar-scene-art', catalog.KUN_AVATAR_SCENES.length)
  await page.getByRole('button', { name: catalog.KUN_AVATAR_SCENES[1].label.en, exact: true }).click()
  await page.mouse.move(4, 4)
  await waitForImages('.rooms-avatar-composer-preview img[data-composed]', 1)
  await capture(`${label}-scene-preview`)
  assert.deepEqual((await snapshot()).profile, before.profile, 'scene try-on must remain local until Save')
}

async function checkOutfitAlignment(theme) {
  const cells = []
  for (const part of catalog.KUN_AVATAR_CATALOG.outfit) {
    await page.evaluate((outfit) => window.avatarFixture.reviewOutfit(outfit), part.id)
    await waitForImages('.rooms-avatar-composer-preview img[data-composed]', 1)
    await page.locator('[data-avatar-tab="outfit"]').click()
    await page.mouse.move(4, 4)
    const image = page.locator('.rooms-avatar-composer-preview img[data-composed]')
    await image.evaluate((element) => element.decode())
    const dimensions = await image.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      return { width: bounds.width, height: bounds.height, naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight }
    })
    assert.equal(dimensions.width, dimensions.height, part.id + ': stage must be square')
    assert.equal(dimensions.naturalWidth, dimensions.naturalHeight, part.id + ': composed image must be square')
    measurements.push({ outfit: part.id, theme, ...dimensions })
    const path = join(evidence, `outfit-${theme}-${part.id}.png`)
    await page.locator('.rooms-avatar-stage-mirror').screenshot({ path, animations: 'disabled' })
    screenshots.push(path)
    cells.push({ path, id: part.id })
    if (part.id === 'black-hoodie') await capture(`desktop-${theme}-black-hoodie-alignment`)
  }
  const overlays = []
  for (const [index, cell] of cells.entries()) {
    const left = index % 6 * 230, top = Math.floor(index / 6) * 254
    overlays.push({ input: await sharp(cell.path).resize(208, 208).png().toBuffer(), left: left + 11, top: top + 8 })
    const text = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="230" height="30">` +
      `<text x="115" y="20" text-anchor="middle" font-family="Arial" font-size="12" fill="${theme === 'dark' ? '#eee' : '#222'}">${cell.id}</text></svg>`)
    overlays.push({ input: text, left, top: top + 220 })
  }
  const path = join(evidence, `outfits-${theme}-all-24.png`)
  await sharp({ create: { width: 1380, height: Math.ceil(cells.length / 6) * 254,
    channels: 4, background: theme === 'dark' ? '#202024' : '#f1f2f5' } }).composite(overlays).png().toFile(path)
  screenshots.push(path)
  console.log(`Captured all ${cells.length} ${theme} outfit stages`)
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
