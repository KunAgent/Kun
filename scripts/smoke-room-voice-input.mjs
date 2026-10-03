import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright-core'
import { createServer } from 'vite'

// Native Electron real-component regression. Synthetic WebAudio replaces only
// getUserMedia; actual MediaRecorder, WAV encoding, React and editor run unchanged.
const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../', import.meta.url))
const evidence = resolve(process.env.KUN_VOICE_EVIDENCE || 'dist/room-voice-input')
const baseline = process.env.KUN_VOICE_BASELINE_COMPOSER
const expectMissing = process.argv.includes('--expect-missing')
const captureBaseline = process.argv.includes('--capture-baseline')
const isBaseline = expectMissing || captureBaseline
assert.ok(!(expectMissing && captureBaseline), 'choose baseline capture or strict missing-voice reproduction')
assert.ok(!isBaseline || baseline, 'baseline requires the original RoomComposer source')
assert.ok(isBaseline || !baseline, 'current-source verification must not receive a baseline composer')
const temporary = await mkdtemp(join(tmpdir(), 'kun-room-voice-'))
await mkdir(evidence, { recursive: true })
let electron, page, server
let baselineVoiceControlCount = null
const errors = [], measurements = []
try {
  const main = join(temporary, 'main.cjs')
  await writeFile(main, `
const { app, BrowserWindow, session } = require('electron')
app.setPath('userData', ${JSON.stringify(join(temporary, 'user-data'))})
app.setPath('appData', ${JSON.stringify(temporary)})
app.commandLine.appendSwitch('force-device-scale-factor', '1.5')
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  const window = new BrowserWindow({ width: 820, height: 800, show: true,
    webPreferences: { contextIsolation: true, sandbox: true } })
  window.loadURL('about:blank')
})
app.on('window-all-closed', () => app.quit())
`)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  electron = await _electron.launch({ executablePath: require('electron'), args: [main], env, chromiumSandbox: true, timeout: 90_000 })
  page = await electron.firstWindow()
  page.on('pageerror', (error) => { errors.push(error.stack || error.message) })
  server = await createServer({ configFile: false, root, esbuild: { jsx: 'automatic' },
    cacheDir: join(temporary, 'vite'),
    resolve: { alias: { '@renderer': resolve(root, 'src/renderer/src'), '@shared': resolve(root, 'src/shared') } },
    server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'room-voice-fixture', enforce: 'pre',
      async transform(_code, id) {
        if (isBaseline && id.endsWith('/rooms/RoomComposer.tsx')) return readFile(baseline, 'utf8')
      },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (!request.url?.startsWith('/__room_voice')) return next()
          response.setHeader('Content-Type', 'text/html')
          response.end(await vite.transformIndexHtml('/__room_voice', '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/src/renderer/src/components/rooms/RoomVoiceInputSmokeFixture.tsx"></script></body></html>'))
        })
      }
    }] })
  await server.listen()
  await page.goto(`${server.resolvedUrls.local[0]}__room_voice`, { timeout: 90_000 })
  await page.locator('.rooms-rich-input').waitFor({ timeout: 90_000 })
  if (isBaseline) {
    await page.waitForTimeout(500)
    baselineVoiceControlCount = await page.locator('.rooms-composer-voice').count()
    if (expectMissing) assert.equal(baselineVoiceControlCount, 0)
    await screenshot(baselineVoiceControlCount ? 'before-with-voice' : 'before-missing-voice')
    console.log(`CAPTURE: original personal Agent composer has ${baselineVoiceControlCount} voice control(s) with speech enabled`)
  } else {
    await page.getByRole('button', { name: 'Voice input', exact: true }).waitFor()
    for (const language of ['en', 'zh']) {
      await page.evaluate(language => window.roomVoiceFixture.language(language), language)
      for (const width of [360, 420, 640, 760, 820, 1100]) {
        await resize(width)
        const geometry = await page.locator('.rooms-composer').evaluate(element => {
          const bounds = element.getBoundingClientRect()
          const buttons = [...element.querySelectorAll('.rooms-composer-voice, .rooms-composer-send')].map(button => {
            const rect = button.getBoundingClientRect()
            const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
            return { label: button.getAttribute('aria-label'), x: rect.x, right: rect.right,
              y: rect.y, width: rect.width, height: rect.height, hit: hit === button || button.contains(hit) }
          })
          return { width: innerWidth, dpr: devicePixelRatio, scrollWidth: document.documentElement.scrollWidth,
            composerRight: bounds.right, buttons }
        })
        measurements.push({ language, ...geometry })
        assert.equal(geometry.dpr, 1.5)
        assert.ok(geometry.scrollWidth <= width + 1, 'no page horizontal overflow')
        for (const button of geometry.buttons) {
          assert.ok(button.label && button.width >= 30 && button.height >= 30 && button.hit, 'visible, named, hit-testable controls')
          assert.ok(button.x >= 0 && button.right <= width + 1, 'control must remain within viewport')
        }
        assert.ok(Math.abs(geometry.buttons[0].y - geometry.buttons[1].y) <= 2, 'mic and send stay on the same row')
        await screenshot(`enabled-${language}-${width}`)
      }
    }
    await page.evaluate(() => window.roomVoiceFixture.language('en'))
    await resize(640)
    const editor = page.locator('.rooms-rich-input')
    const mic = () => page.getByRole('button', { name: 'Voice input', exact: true })
    const stop = () => page.getByRole('button', { name: 'Stop recording', exact: true })
    const cancel = () => page.getByRole('button', { name: 'Cancel voice input', exact: true })
    await editor.fill('Typed draft')
    await page.evaluate(() => window.roomVoiceFixture.setEnabled(false))
    await page.locator('.rooms-composer-voice').waitFor({ state: 'detached' })
    await screenshot('settings-disabled')
    await page.evaluate(() => window.roomVoiceFixture.setEnabled(true))
    await mic().click()
    await stop().waitFor()
    await editor.press('End'); await editor.pressSequentially(' while recording')
    await screenshot('recording')
    await page.waitForTimeout(650)
    await page.evaluate(() => window.roomVoiceFixture.delay(true))
    await stop().click()
    await page.getByRole('button', { name: 'Transcribing…', exact: true }).waitFor()
    await screenshot('transcribing')
    await page.waitForFunction(() => window.roomVoiceFixture.calls.transcribed === 1)
    await page.evaluate(() => window.roomVoiceFixture.resolve('Recorded offline fixture text'))
    await page.waitForFunction(() => document.querySelector('.rooms-rich-input').textContent.includes('Recorded offline fixture text'))
    assert.equal(await editor.innerText(), 'Typed draft while recording Recorded offline fixture text')
    assert.equal(await page.evaluate(() => window.roomVoiceFixture.calls.sent.length), 0, 'never auto-send')
    await screenshot('transcript-inserted')
    await page.reload(); await mic().waitFor()
    assert.match(await editor.innerText(), /Typed draft while recording Recorded offline fixture text/, 'persisted draft survives reload')
    await page.evaluate(() => window.roomVoiceFixture.deny(true))
    await mic().click()
    await page.getByRole('alert').filter({ hasText: 'Microphone access was denied' }).waitFor()
    await screenshot('permission-denied-fixture')
    await page.getByRole('button', { name: 'Dismiss error' }).click()
    await page.evaluate(() => window.roomVoiceFixture.deny(false))
    const beforeCancel = await page.evaluate(() => window.roomVoiceFixture.calls.transcribed)
    await mic().click(); await stop().waitFor(); await cancel().click()
    assert.equal(await page.evaluate(() => window.roomVoiceFixture.calls.transcribed), beforeCancel)
    await page.evaluate(() => window.roomVoiceFixture.delay(true))
    await mic().click(); await stop().waitFor(); await page.waitForTimeout(650); await stop().click()
    await page.waitForFunction(() => window.roomVoiceFixture.calls.transcribed > 0)
    await page.evaluate(() => window.roomVoiceFixture.switchRoom('voice-room-two'))
    await mic().waitFor(); await editor.fill('Second room draft')
    await page.evaluate(() => window.roomVoiceFixture.resolve('Must never enter the second room'))
    await page.waitForTimeout(100)
    assert.equal(await editor.innerText(), 'Second room draft')
    await screenshot('room-switch-late-result-discarded')
    await page.evaluate(() => { window.roomVoiceFixture.delay(false); window.roomVoiceFixture.fail(true) })
    await mic().click(); await stop().waitFor(); await page.waitForTimeout(650); await stop().click()
    await page.getByRole('alert').filter({ hasText: 'Offline transcription failure fixture' }).waitFor()
    await screenshot('transcription-error-fixture')
    await page.getByRole('button', { name: 'Dismiss error' }).click()
    await page.evaluate(() => window.roomVoiceFixture.fail(false))
    // Keyboard and explicit send remain intact after voice failure/retry.
    await editor.fill('Explicit send only'); await editor.press('Enter')
    await page.waitForFunction(() => window.roomVoiceFixture.calls.sent.length === 1)
    assert.equal(await page.evaluate(() => window.roomVoiceFixture.calls.sent[0].body), 'Explicit send only')
    assert.equal(await page.evaluate(() => window.roomVoiceFixture.calls.captures - window.roomVoiceFixture.calls.stopped), 1,
      'all successful synthetic streams stop; the one denied request has no stream')
    console.log('PASS: real native composer settings, scaled layouts, recording, stop, draft insertion, permission error, cancel, room race and explicit send')
  }
  assert.deepEqual(errors, [], 'no renderer errors')
} catch (error) {
  if (page && !page.isClosed()) {
    await screenshot('failure').catch(() => undefined)
    await writeFile(join(evidence, 'failure.html'), await page.content()).catch(() => undefined)
  }
  throw error
} finally {
  await writeFile(join(evidence, 'report.json'), JSON.stringify({
    fixture: 'Native Electron production Rooms composer with synthetic audio and offline transcription; no physical mic or real Whisper validation',
    baseline: isBaseline, baselineVoiceControlCount, measurements, errors
  }, null, 2))
  await electron?.close(); await server?.close()
  await rm(temporary, { recursive: true, force: true })
}
async function screenshot(name) { await page.screenshot({ path: join(evidence, `${name}.png`) }) }
async function resize(width) {
  await electron.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 800), width)
  await page.waitForFunction(width => innerWidth === width, width)
}
