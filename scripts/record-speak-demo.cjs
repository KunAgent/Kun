'use strict'

/**
 * Records a walkthrough of the local Speak provider in the running application.
 *
 * Drives the real Electron app with Playwright, captions each step on screen,
 * and writes an MP4. Pass --assets <dir> with the Kokoro weights so the demo
 * runs offline.
 */
const { spawn, execFileSync } = require('node:child_process')
const { copyFileSync, createWriteStream, existsSync, readdirSync } = require('node:fs')
const { mkdir, mkdtemp, symlink, writeFile } = require('node:fs/promises')
const { createConnection, createServer } = require('node:net')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { _electron } = require('playwright-core')

const {
  createIsolatedEnvironment,
  desktopSmokeSettings,
  desktopSmokeWorkspaceParent,
  desktopUserDataCandidates,
  platformDesktopArguments
} = require('./smoke-packaged-extension-desktop.cjs')
const { developmentRendererEnvironment } = require('./development-renderer-environment.cjs')
const { findWorkbenchWindow } = require('./smoke-packaged-video-editor-desktop.cjs')

function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolvePort(port))
    })
  })
}

async function waitForPortOpen(port, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`Renderer exited early with code ${child.exitCode}`)
    }
    const open = await new Promise((r) => {
      const socket = createConnection({ host: '127.0.0.1', port })
      socket.once('connect', () => { socket.destroy(); r(true) })
      socket.once('error', () => { socket.destroy(); r(false) })
    })
    if (open) return
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`Renderer port ${port} never opened`)
}

const REPO = resolve(join(__dirname, '..'))
const VIEWPORT = { width: 1280, height: 860 }
const MODEL_ID = 'kokoro-82m-int8'
const MODEL_FILE = 'model_quantized.onnx'
const VOICE_ID = 'af_heart'

function arg(flag, fallback) {
  const index = process.argv.indexOf(flag)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const assetDir = resolve(arg('--assets', ''))
  if (!assetDir || !existsSync(join(assetDir, MODEL_FILE))) {
    throw new Error(`--assets must hold ${MODEL_FILE} and ${VOICE_ID}.bin`)
  }
  const outDir = resolve(arg('--out', join(REPO, 'dist', 'speak-demo')))
  await mkdir(outDir, { recursive: true })
  const videoDir = join(outDir, 'raw')
  await mkdir(videoDir, { recursive: true })

  const root = await mkdtemp(join(tmpdir(), 'kun-speak-demo-'))
  const home = join(root, 'home')
  const profile = join(home, '.kun', 'data')
  const userData = join(root, 'electron-user-data')
  const appData = join(root, 'app-data')
  const localAppData = join(root, 'local-app-data')
  const temporaryDirectory = join(root, 'tmp')
  const workspaceParent = desktopSmokeWorkspaceParent(REPO)
  await mkdir(workspaceParent, { recursive: true })
  const workspaceRoot = await mkdtemp(join(workspaceParent, 'demo-'))
  const runtimePort = await availablePort()
  let rendererPort = await availablePort()
  while (rendererPort === runtimePort) rendererPort = await availablePort()

  for (const dir of [profile, userData, appData, localAppData, temporaryDirectory]) {
    await mkdir(dir, { recursive: true })
  }

  // Link the weights into the isolated profile so nothing downloads.
  const kokoro = join(userData, 'models', 'speech', 'kokoro')
  await mkdir(join(kokoro, MODEL_ID), { recursive: true })
  await mkdir(join(kokoro, 'voices'), { recursive: true })
  await symlink(join(assetDir, MODEL_FILE), join(kokoro, MODEL_ID, MODEL_FILE))
  await symlink(join(assetDir, `${VOICE_ID}.bin`), join(kokoro, 'voices', `${VOICE_ID}.bin`))

  const settings = {
    ...desktopSmokeSettings(runtimePort, workspaceRoot, profile),
    locale: 'en',
    theme: 'light',
    uiFontScale: 1
  }
  const serialized = `${JSON.stringify(settings, null, 2)}\n`
  await Promise.all(
    desktopUserDataCandidates({ platform: process.platform, home, appData, explicitUserData: userData })
      .map(async (directory) => {
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'kun-settings.json'), serialized)
      })
  )

  const environment = developmentRendererEnvironment(
    createIsolatedEnvironment(process.env, { home, appData, localAppData, temporaryDirectory }),
    { rendererPort, temporaryRoot: root }
  )
  environment.NODE_ENV = 'development'

  const renderer = spawn(
    process.execPath,
    [join(REPO, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--config', join(REPO, 'scripts', 'vite-development-renderer.config.mjs'),
      '--logLevel', 'warn'],
    { cwd: REPO, env: environment, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  await waitForPortOpen(rendererPort, 120_000, renderer)

  const app = await _electron.launch({
    executablePath: require('electron'),
    args: [
      `--user-data-dir=${userData}`, '--no-first-run', '--disable-background-networking',
      '--disable-component-update', '--disable-default-apps',
      ...platformDesktopArguments(process.platform), REPO
    ],
    cwd: REPO,
    env: environment,
    chromiumSandbox: true,
    timeout: 120_000,
    recordVideo: { dir: videoDir, size: VIEWPORT }
  })

  const log = createWriteStream(join(outDir, 'main.log'))
  app.process().stderr?.pipe(log)
  app.process().stdout?.pipe(log)

  const page = await findWorkbenchWindow(app, 120_000)
  page.setDefaultTimeout(60_000)
  await page.waitForLoadState('domcontentloaded')
  await page.setViewportSize(VIEWPORT)

  const marks = []
  const recordingStartedAt = Date.now()

  /** Paint a caption over the window so the video explains itself. */
  async function caption(step, title, detail, holdMs = 2600) {
    await page.evaluate(({ step, title, detail }) => {
      let host = document.getElementById('speak-demo-caption')
      if (!host) {
        host = document.createElement('div')
        host.id = 'speak-demo-caption'
        Object.assign(host.style, {
          position: 'fixed', left: '0', right: '0', bottom: '0', zIndex: '2147483647',
          padding: '14px 22px', boxSizing: 'border-box',
          background: 'linear-gradient(to top, rgba(12,14,20,0.94), rgba(12,14,20,0.82))',
          color: '#f6f7fb', font: '500 15px/1.45 -apple-system, system-ui, sans-serif',
          display: 'flex', alignItems: 'baseline', gap: '12px',
          pointerEvents: 'none', transition: 'opacity 160ms'
        })
        document.body.append(host)
      }
      host.innerHTML = ''
      const badge = document.createElement('span')
      badge.textContent = step
      Object.assign(badge.style, {
        flex: '0 0 auto', padding: '2px 9px', borderRadius: '999px',
        background: '#5b8cff', color: '#fff', font: '600 12px/1.6 ui-monospace, monospace'
      })
      const text = document.createElement('span')
      const strong = document.createElement('strong')
      strong.textContent = title
      strong.style.fontWeight = '650'
      text.append(strong)
      if (detail) {
        const rest = document.createElement('span')
        rest.textContent = `  ${detail}`
        rest.style.opacity = '0.78'
        text.append(rest)
      }
      host.append(badge, text)
    }, { step, title, detail })
    marks.push({ step, title, at: Date.now() - recordingStartedAt })
    await wait(holdMs)
  }

  async function openSpeechSettings() {
    await page.evaluate(async () => {
      const store = await import('/src/store/chat-store.ts')
      store.useChatStore.getState().openSettings('mediaGeneration')
    })
    await page.locator('#media-generation-settings-tab-speech').click()
    await page.locator('#media-generation-settings-panel-speech').waitFor()
  }

  const result = { marks, steps: [] }
  let capturedWav = null
  try {
    await wait(1200)
    await caption('Speak', 'Local, on-device speech for assistant answers',
      'Kokoro runs on your machine. Nothing leaves it.', 3200)

    // ---------------------------------------------------------------- settings
    await openSpeechSettings()
    await caption('1/11', 'Media → Speech generation → Local provider',
      'It sits beside the remote provider, and works whether or not that tool is on.', 3600)

    const panel = page.locator('#media-generation-settings-panel-speech')
    await caption('2/11', '28 English voices, grouped by accent',
      'Only English ships: the bundled phonemizer carries English data alone.', 1200)
    const accent = page.getByLabel('Accent')
    await accent.selectOption('en-gb')
    await wait(1500)
    const voice = page.getByLabel('Voice', { exact: true })
    const british = await voice.locator('option').count()
    await voice.selectOption('bf_emma')
    await wait(1800)
    await accent.selectOption('all')
    await voice.selectOption('af_heart')
    await wait(1400)

    await caption('3/11', 'Playback rate, 0.5x to 2x',
      'The summary line above tracks the model, the voice and the rate.', 1000)
    const speed = page.getByLabel('Speed')
    await speed.fill('1.45')
    await wait(1600)
    await page.getByRole('button', { name: 'Reset' }).click()
    await wait(1400)

    await caption('4/11', 'Try it — hear the voice before you commit',
      'Synthesizes a sample line with the current voice and rate.', 900)
    await page.getByRole('button', { name: 'Play' }).click()
    await wait(6500)

    await caption('5/11', 'Three weight tiers, verified by SHA-256',
      'fp16 is recommended here: the quantized graph is the slower one on Apple Silicon.', 900)
    await panel.locator('[data-speak-model="kokoro-82m-fp16"]').scrollIntoViewIfNeeded()
    await wait(3800)
    const recommended = await panel.locator('[data-speak-model-recommended="true"]').getAttribute('data-speak-model')

    await caption('6/11', 'Keep generated tracks',
      'Off by default. Turning it on stores each answer so it can be replayed and saved.', 900)
    const keep = page.getByLabel('Keep generated tracks')
    await keep.scrollIntoViewIfNeeded()
    await wait(900)
    if ((await keep.getAttribute('aria-checked')) !== 'true') await keep.click()
    await wait(2600)

    // ------------------------------------------------------------------- chat
    await page.evaluate(async () => {
      const store = await import('/src/store/chat-store.ts')
      store.useChatStore.getState().closeSettings()
      const fixture = await import('/src/components/chat/AssistantSpeakSmokeFixture.tsx')
      fixture.mountAssistantSpeakSmokeFixture()
    })
    const stage = page.locator('[data-testid="assistant-speak-smoke-stage"]')
    await stage.waitFor()
    await stage.locator('pre').waitFor()
    await stage.hover()
    await caption('7/11', 'A Speak action under every answer',
      'Hidden until the bridge and the settings toggle are both confirmed.', 3000)

    const speak = page.locator('button[data-speak-state]')
    await speak.waitFor()
    const startedAt = Date.now()
    await speak.click()
    await caption('8/11', 'A spinner while the first chunk is produced',
      'The opening chunk is kept short so speech starts in seconds, not fifteen.', 600)
    await page.waitForFunction(() => (
      document.querySelector('button[data-speak-state]')?.getAttribute('data-speak-state') === 'speaking'
    ), undefined, { timeout: 60_000 })
    const firstAudioMs = Date.now() - startedAt
    const speakStartedAt = Date.now() - recordingStartedAt

    await caption('9/11', 'Speaking — the icon becomes stop, with chunk progress',
      `First audio after ${(firstAudioMs / 1000).toFixed(1)}s. The app stays responsive throughout.`, 5200)

    const download = page.locator('button[data-speak-track-state]')
    await download.waitFor({ timeout: 60_000 })
    await stage.hover()
    await caption('10/11', 'Download audio appears once the recording exists',
      'It saves the file already produced, as a 24 kHz WAV.', 4200)
    // Copy the recording out now: the demo clears the store at the end, and
    // this file becomes the video's audio track.
    const tracksDir = join(kokoro, 'tracks')
    const stored = existsSync(tracksDir)
      ? readdirSync(tracksDir).filter((name) => name.endsWith('.wav')).map((name) => join(tracksDir, name))
      : []
    if (stored[0]) {
      capturedWav = join(outDir, 'speech.wav')
      copyFileSync(stored[0], capturedWav)
    }

    // Stop, then speak again to show the stored recording replay instantly.
    await page.evaluate(async () => {
      const controller = await import('/src/components/chat/speak-controller.ts')
      controller.stopSpeaking()
    })
    await page.waitForFunction(() => (
      document.querySelector('button[data-speak-state]')?.getAttribute('data-speak-state') === 'idle'
    ), undefined, { timeout: 30_000 })
    await stage.hover()
    await wait(700)

    const before = await page.evaluate(async () => {
      const fixture = await import('/src/components/chat/AssistantSpeakSmokeFixture.tsx')
      return fixture.readAssistantSpeakSmokeState().storedPlaybacks
    })
    const replayStartedAt = Date.now()
    await speak.click()
    await page.waitForFunction(async (baseline) => {
      const fixture = await import('/src/components/chat/AssistantSpeakSmokeFixture.tsx')
      return fixture.readAssistantSpeakSmokeState().storedPlaybacks > baseline
    }, before, { timeout: 30_000 })
    const replayMs = Date.now() - replayStartedAt
    await caption('11/11', 'Speaking it again replays the stored file',
      `${replayMs} ms instead of ${(firstAudioMs / 1000).toFixed(1)}s — no synthesis at all.`, 4600)
    await page.evaluate(async () => {
      const controller = await import('/src/components/chat/speak-controller.ts')
      controller.stopSpeaking()
    })
    await wait(600)

    // ------------------------------------------------------- persistence
    // The fixture replaces the application shell, so the window is reloaded
    // rather than navigated back - which also shows the recording surviving a
    // restart rather than living in memory.
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await wait(2500)
    await caption('Persisted', 'Reloaded the application from scratch',
      'The recording lives on disk, not in memory.', 3000)

    await page.evaluate(async () => {
      const fixture = await import('/src/components/chat/AssistantSpeakSmokeFixture.tsx')
      fixture.mountAssistantSpeakSmokeFixture()
    })
    await stage.waitFor()
    await stage.locator('pre').waitFor()
    await stage.hover()
    await wait(900)
    const afterReload = Date.now()
    await speak.click()
    await page.waitForFunction(async () => {
      const fixture = await import('/src/components/chat/AssistantSpeakSmokeFixture.tsx')
      return fixture.readAssistantSpeakSmokeState().storedPlaybacks > 0
    }, undefined, { timeout: 30_000 })
    const afterReloadMs = Date.now() - afterReload
    await caption('Persisted', 'Speak still plays it back immediately',
      `${afterReloadMs} ms, with no model run at all.`, 4200)
    await page.evaluate(async () => {
      const controller = await import('/src/components/chat/speak-controller.ts')
      controller.stopSpeaking()
    })
    await wait(600)

    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await wait(2200)
    await openSpeechSettings()
    await page.getByLabel('Keep generated tracks').scrollIntoViewIfNeeded()
    await caption('Storage', 'Stored recordings are listed, with a way to clear them',
      'Kept under your Kun data directory as WAV files.', 4200)
    await page.getByRole('button', { name: 'Clear' }).click()
    await wait(2800)

    await caption('Speak', 'Local provider — off the Main thread, recordings kept on disk',
      'Kokoro 82M · 28 English voices · 0.5x-2x · instant replay · WAV download', 4000)

    result.steps.push({
      britishVoices: british,
      recommendedTier: recommended,
      firstAudioMs,
      replayMs,
      afterReloadMs,
      speakStartedAt
    })
  } finally {
    const video = page.video()
    await app.close().catch(() => undefined)
    if (renderer.pid) {
      try {
        process.platform === 'win32' ? renderer.kill() : process.kill(-renderer.pid, 'SIGTERM')
      } catch {
        renderer.kill('SIGTERM')
      }
    }
    const webm = video ? await video.path().catch(() => null) : null
    result.webm = webm
    result.tracksDir = kokoro
    await writeFile(join(outDir, 'demo.json'), `${JSON.stringify(result, null, 2)}\n`)
    if (webm && existsSync(webm)) {
      const mp4 = join(outDir, 'kun-speak-feature.mp4')
      const wav = capturedWav && existsSync(capturedWav) ? capturedWav : null
      const offset = Math.max(0, result.steps[0]?.speakStartedAt ?? 0)
      const args = wav
        ? ['-y', '-i', webm, '-i', wav,
          '-filter_complex', `[1:a]adelay=${offset}|${offset}[a]`,
          '-map', '0:v', '-map', '[a]',
          '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', mp4]
        : ['-y', '-i', webm,
          '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart', mp4]
      execFileSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
      console.log(`[speak-demo] video: ${mp4}${wav ? ' (with synthesized audio)' : ' (no audio track)'}`)
    } else {
      console.log('[speak-demo] no video was captured')
    }
    console.log(`[speak-demo] details: ${join(outDir, 'demo.json')}`)
  }
}

main().catch((error) => {
  console.error(`[speak-demo] FAIL: ${error?.stack ?? error}`)
  process.exitCode = 1
})
